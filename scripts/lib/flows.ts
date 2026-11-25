/**
 * Bygger Sankey-flöden (inflöden → enhet → utflöden) ur kommunernas och regionernas resultaträkning.
 *
 * Resultaträkningens identiteter (verifierade mot SCB TAB6777/TAB6784):
 *   030 verksamhetens nettokostnader = 010 intäkter + 022 kostnader (negativ) + avskrivningar (negativ)
 *   035 verksamhetens resultat       = 030 + 040 skatteintäkter + generella statsbidrag och utjämning
 *   080 resultat efter fin. poster   = 035 + 060 finansiella intäkter + 072 finansiella kostnader (negativ)
 *   120 årets resultat               = 080 + extraordinära poster
 * Avskrivningar, statsbidrag/utjämning och extraordinära poster HÄRLEDS ur delsummorna. Då balanserar
 * flödet exakt även de år då en post redovisas på en annan rad (t.ex. 024, 026 eller 053).
 *
 * Verksamhetens kostnader (022) fördelas på verksamhetsområden efter respektive områdes andel av
 * bruttokostnaden i driftredovisningen (TAB4199/TAB4242). Driftredovisningen innehåller interna poster och
 * summerar inte exakt till resultaträkningen – därför används bara andelarna.
 */
import type { FlowNode } from '../../src/lib/types.ts';

/** Resultaträkningsposter, kod → belopp (kostnader negativa, som hos SCB). */
export type IncomeStatement = Record<string, number | null | undefined>;

export interface FlowParts {
  /** Delning av verksamhetens intäkter: nod-id → belopp. Resten blir "övriga verksamhetsintäkter". */
  revenueSplit?: Record<string, number | null | undefined>;
  /** Bruttokostnad per verksamhetsområde: nod-id → belopp (används bara som andelar). */
  costShares?: Record<string, number | null | undefined>;
  /**
   * Om intäktsdelningen är större än resultaträkningens intäkter (olika avgränsning mellan tabellerna):
   * 'throw' (standard) eller 'scale' = skala delningen proportionellt så att den ryms.
   */
  onRevenueOverflow?: 'throw' | 'scale';
  /** Anropas när delningen skalats, för loggning. */
  onScaled?: (factor: number) => void;
}

const v = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export function hasIncomeStatement(rr: IncomeStatement): boolean {
  return ['010', '022', '030', '040', '035', '080', '120'].every((k) => typeof rr[k] === 'number');
}

/**
 * Returnerar nod-id → belopp (positiva tal, i samma enhet som indata delat med `divisor`).
 * Nod-id:n som används utöver revenueSplit/costShares:
 *   in:  skatt, statsbidrag, ovriga-intakter (eller verksamhetens-intakter), fin-in, extra-in, underskott
 *   out: verksamhet (om costShares saknas), avskrivningar, fin-ut, utjamningsavgift, extra-ut, overskott
 */
export function buildFlow(rr: IncomeStatement, parts: FlowParts = {}, divisor = 1): Record<string, number> {
  if (!hasIncomeStatement(rr)) throw new Error('Resultaträkningen saknar obligatoriska poster');
  const income = v(rr['010']);
  const costs = -v(rr['022']);
  const depreciation = -(v(rr['030']) - v(rr['010']) - v(rr['022']));
  const tax = v(rr['040']);
  const general = v(rr['035']) - v(rr['030']) - v(rr['040']);
  const finNet = v(rr['080']) - v(rr['035']);
  // Finansiella intäkter/kostnader brutto om de finns och stämmer med nettot, annars bara nettot
  let finIn = v(rr['060']);
  let finOut = -v(rr['072']);
  if (Math.abs(finIn - finOut - finNet) > Math.max(1, Math.abs(finNet) * 0.001)) {
    finIn = Math.max(finNet, 0);
    finOut = Math.max(-finNet, 0);
  }
  const extra = v(rr['120']) - v(rr['080']);
  const result = v(rr['120']);

  const out: Record<string, number> = {};
  const add = (id: string, amount: number) => {
    if (amount > 0) out[id] = (out[id] ?? 0) + amount;
  };

  // Inflöden
  add('skatt', tax);
  add('statsbidrag', Math.max(general, 0));
  if (parts.revenueSplit) {
    const split = Object.entries(parts.revenueSplit).map(([id, amount]) => [id, Math.max(v(amount), 0)] as const);
    const splitTotal = split.reduce((a, [, x]) => a + x, 0);
    let factor = 1;
    if (splitTotal > income + Math.max(1, income * 0.001)) {
      if (parts.onRevenueOverflow !== 'scale') {
        throw new Error(`Intäktsdelningen (${splitTotal}) överstiger verksamhetens intäkter (${income})`);
      }
      factor = income / splitTotal;
      parts.onScaled?.(factor);
    }
    for (const [id, x] of split) add(id, x * factor);
    add('ovriga-intakter', income - splitTotal * factor);
  } else {
    add('verksamhetens-intakter', income);
  }
  add('fin-in', finIn);
  add('extra-in', Math.max(extra, 0));
  add('underskott', Math.max(-result, 0));

  // Utflöden
  const shares = parts.costShares ? Object.entries(parts.costShares).map(([id, x]) => [id, Math.max(v(x), 0)] as const) : [];
  const shareTotal = shares.reduce((a, [, x]) => a + x, 0);
  if (shareTotal > 0) {
    for (const [id, x] of shares) add(id, (costs * x) / shareTotal);
  } else {
    add('verksamhet', costs);
  }
  add('avskrivningar', depreciation);
  add('fin-ut', finOut);
  add('utjamningsavgift', Math.max(-general, 0));
  add('extra-ut', Math.max(-extra, 0));
  add('overskott', Math.max(result, 0));

  const rounded: Record<string, number> = {};
  for (const [id, amount] of Object.entries(out)) {
    const r = Math.round((amount / divisor) * 10) / 10;
    if (r > 0) rounded[id] = r;
  }
  return rounded;
}

/** Noder som alla flöden byggda med buildFlow kan använda (utöver intäkts- och kostnadsnoder). */
export const COMMON_IN_NODES: FlowNode[] = [
  { id: 'skatt', label: 'Skatteintäkter', side: 'in', description: 'Kommunal- eller regionalskatt från invånarna' },
  {
    id: 'statsbidrag',
    label: 'Statsbidrag och utjämning',
    side: 'in',
    description: 'Generella statsbidrag och netto från det kommunalekonomiska utjämningssystemet',
  },
  { id: 'fin-in', label: 'Finansiella intäkter', side: 'in', description: 'Räntor, utdelningar m.m.' },
  { id: 'extra-in', label: 'Extraordinära intäkter', side: 'in' },
  { id: 'underskott', label: 'Underskott', side: 'in', role: 'balance', description: 'Årets negativa resultat' },
];

export const COMMON_OUT_NODES: FlowNode[] = [
  {
    id: 'verksamhet',
    label: 'Verksamhetens kostnader (ej fördelade)',
    side: 'out',
    description: 'Driftredovisning per verksamhetsområde saknas för detta år',
  },
  { id: 'avskrivningar', label: 'Avskrivningar', side: 'out', description: 'Värdeminskning av anläggningar och inventarier' },
  { id: 'fin-ut', label: 'Finansiella kostnader', side: 'out', description: 'Räntor m.m.' },
  {
    id: 'utjamningsavgift',
    label: 'Avgift till utjämningssystemet',
    side: 'out',
    description: 'Netto inbetalt till det kommunalekonomiska utjämningssystemet',
  },
  { id: 'extra-ut', label: 'Extraordinära kostnader', side: 'out' },
  { id: 'overskott', label: 'Överskott', side: 'out', role: 'balance', description: 'Årets positiva resultat' },
];

/** Nyckeltal ur resultaträkningen (samma som i kommunkartan). Belopp i mnkr, per invånare i kr. */
export interface IncomeStatementFigures {
  kostnader: number | null;
  'kostnad-per-inv': number | null;
  skatteintakter: number | null;
  'skatt-per-inv': number | null;
  statsbidrag: number | null;
  'statsbidrag-per-inv': number | null;
  resultat: number | null;
  'resultat-per-inv': number | null;
  folkmangd: number | null;
}

/**
 * Räknar nyckeltal ur en resultaträkning. `krPerUnit` = antal kronor per enhet i indata
 * (1 000 för SCB:s kommuntabell i tkr, 1 000 000 för regiontabellen i mnkr).
 * Totala kostnader = verksamhetens kostnader + avskrivningar + finansiella kostnader.
 */
export function incomeStatementFigures(
  rr: IncomeStatement,
  population: number | null | undefined,
  krPerUnit: number,
): IncomeStatementFigures {
  const complete = hasIncomeStatement(rr);
  const pop = population ?? null;
  const mnkr = (x: number | null) => (x === null ? null : Math.round((x * krPerUnit) / 1e5) / 10);
  const perInv = (x: number | null) => (x === null || !pop ? null : Math.round((x * krPerUnit) / pop));
  const totalCost = complete
    ? -v(rr['022']) - (v(rr['030']) - v(rr['010']) - v(rr['022'])) - v(rr['072'])
    : null;
  const tax = complete ? v(rr['040']) : null;
  const general = complete ? v(rr['035']) - v(rr['030']) - v(rr['040']) : null;
  const result = complete ? v(rr['120']) : null;
  return {
    kostnader: mnkr(totalCost),
    'kostnad-per-inv': perInv(totalCost),
    skatteintakter: mnkr(tax),
    'skatt-per-inv': perInv(tax),
    statsbidrag: mnkr(general),
    'statsbidrag-per-inv': perInv(general),
    resultat: mnkr(result),
    'resultat-per-inv': perInv(result),
    folkmangd: pop,
  };
}

/** Definitioner för nyckeltalen ovan (+ skattesatser) i flödesdataset. */
export const INCOME_STATEMENT_KEY_FIGURES = [
  { key: 'kostnader', label: 'Totala kostnader', unit: 'mnkr', decimals: 0 },
  { key: 'kostnad-per-inv', label: 'Kostnader per invånare', unit: 'kr', decimals: 0 },
  { key: 'skatteintakter', label: 'Skatteintäkter', unit: 'mnkr', decimals: 0 },
  { key: 'skatt-per-inv', label: 'Skatteintäkter per invånare', unit: 'kr', decimals: 0 },
  { key: 'statsbidrag', label: 'Statsbidrag och utjämning (netto)', unit: 'mnkr', decimals: 0 },
  { key: 'statsbidrag-per-inv', label: 'Statsbidrag och utjämning per invånare', unit: 'kr', decimals: 0 },
  { key: 'resultat', label: 'Årets resultat', unit: 'mnkr', decimals: 0 },
  { key: 'resultat-per-inv', label: 'Årets resultat per invånare', unit: 'kr', decimals: 0 },
  { key: 'folkmangd', label: 'Folkmängd', unit: 'inv.', decimals: 0 },
];
