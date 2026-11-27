/**
 * Statskontoret – statsbudgetens utfall som öppna data (CC0).
 * Sida: https://www.statskontoret.se/analys-och-statistik/oppna-data/arsutfall/
 *
 * Filerna är zip-arkiv med en semikolonseparerad CSV (UTF-8 med BOM, decimalkomma, belopp i mnkr).
 * Filnamn och status (preliminär/definitiv) ändras vid varje publicering, så länkarna läses från sidan.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { FlowNode } from '../../src/lib/types.ts';
import { fetchWithRetry } from './http.ts';

export const STATSKONTORET = 'https://www.statskontoret.se';
export const ARSUTFALL_PAGE = `${STATSKONTORET}/analys-och-statistik/oppna-data/arsutfall/`;
export const STATSKONTORET_LICENSE = 'CC0 1.0 (Statskontorets öppna data)';

/** Läser årsutfallssidan och returnerar de senaste zip-länkarna för inkomster och utgifter. */
export async function findArsutfallLinks(): Promise<{ inkomster: string; utgifter: string }> {
  const html = await (await fetchWithRetry(ARSUTFALL_PAGE)).text();
  const links = [...html.matchAll(/href="(\/OpenDataArsUtfallPage\/GetFile\?[^"]+)"/g)].map((m) =>
    STATSKONTORET + m[1]!.replace(/&amp;/g, '&'),
  );
  const pick = (type: string) => {
    const zips = links.filter((l) => l.includes(`documentType=${type}`) && l.includes('fileType=Zip'));
    // Sidan listar publiceringarna i ordning – den sista är den senaste (t.ex. "andra preliminära")
    const last = zips[zips.length - 1];
    if (!last) throw new Error(`Hittade ingen zip-länk för ${type} på ${ARSUTFALL_PAGE}`);
    return last;
  };
  return { inkomster: pick('Inkomst'), utgifter: pick('Utgift') };
}

/** Tolkar semikolonseparerad CSV (med stöd för citattecken) till objekt per rad. */
export function parseSemicolonCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ';') {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]!);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

/** "1234,56" → 1234.56; tom sträng → 0. */
export const parseDecimal = (s: string | undefined): number => {
  if (!s) return 0;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n)) throw new Error(`Ogiltigt tal: "${s}"`);
  return n;
};

export async function fetchZipCsv(url: string): Promise<Record<string, string>[]> {
  const res = await fetchWithRetry(url);
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  const csv = Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.csv'));
  if (!csv) throw new Error(`Ingen CSV i ${url}`);
  return parseSemicolonCsv(strFromU8(csv[1]));
}

export interface IncomeRow {
  typ: string;
  huvudgrupp: string;
  titel: string;
  year: string;
  utfall: number;
}
export interface ExpenseRow {
  uo: string;
  uoName: string;
  year: string;
  utfall: number;
}

export const toIncomeRows = (rows: Record<string, string>[]): IncomeRow[] =>
  rows.map((r) => ({
    typ: r['Inkomsttyp']!,
    huvudgrupp: r['Inkomsthuvudgrupp']!,
    titel: r['Inkomsttitel'] ?? '',
    year: r['År']!,
    utfall: parseDecimal(r['Utfall']),
  }));

export const toExpenseRows = (rows: Record<string, string>[]): ExpenseRow[] =>
  rows.map((r) => ({ uo: r['Utgiftsområde']!, uoName: r['Utgiftsområdesnamn']!, year: r['År']!, utfall: parseDecimal(r['Utfall']) }));

/** Poster i statens flöde. `side` = normal sida; negativa belopp flyttas till motsatt sida (id + "-motsatt"). */
export interface StateItem {
  id: string;
  label: string;
  side: 'in' | 'out';
  description?: string;
  /** Etikett om beloppet blir negativt och posten flyttas till motsatt sida. */
  flippedLabel?: string;
  /** Gruppnod (mellansteg) som posten ingår i när beloppet är positivt. */
  parent?: string;
}

/** Mellansteg i statens flöde. */
export const GROUP_VIDAREFORING = 'g-vidareforing';
export const GROUP_STATSBUDGET = 'g-statsbudget';
export const GROUP_NODES: FlowNode[] = [
  {
    id: GROUP_VIDAREFORING,
    label: 'Skatter som förs vidare',
    side: 'out',
    role: 'group',
    description: 'Skatter som staten tar in men för vidare till kommuner, regioner, pensionssystemet och EU (avgående poster 1700/1800)',
  },
  {
    id: GROUP_STATSBUDGET,
    label: 'Statsbudgetens utgifter',
    side: 'out',
    role: 'group',
    description: 'Utgiftsområden, Riksgäldens nettoutlåning och kassamässig korrigering – det som i vardagligt tal kallas statsbudgeten',
  },
];

export const INCOME_ITEMS: StateItem[] = [
  { id: 'skatt-arbete-direkt', label: 'Inkomstskatter m.m.', side: 'in', description: 'Direkta skatter på arbete: statlig och kommunal inkomstskatt, allmän pensionsavgift, netto efter skattereduktioner' },
  { id: 'skatt-arbete-indirekt', label: 'Arbetsgivaravgifter m.m.', side: 'in', description: 'Indirekta skatter på arbete: arbetsgivaravgifter, egenavgifter, särskild löneskatt' },
  { id: 'skatt-konsumtion', label: 'Moms och punktskatter', side: 'in', description: 'Skatt på konsumtion och insatsvaror: mervärdesskatt, energi- och koldioxidskatt, alkohol, tobak m.m.' },
  { id: 'skatt-kapital', label: 'Skatt på kapital', side: 'in', description: 'Bolagsskatt, kapitalinkomstskatt, fastighetsavgift, avkastningsskatt m.m.' },
  { id: 'skatt-ovriga', label: 'Övriga skatter', side: 'in', description: 'Skatt på import (tullar) samt restförda och övriga skatter' },
  { id: 'statens-verksamhet', label: 'Inkomster av statens verksamhet', side: 'in', description: 'Aktieutdelningar från statliga bolag, offentligrättsliga avgifter, räntor, böter m.m.' },
  { id: 'eu-bidrag', label: 'Bidrag från EU', side: 'in', description: 'Jordbruksfonder, regional- och socialfonder, återhämtningsfaciliteten m.m.' },
  { id: 'ovriga-inkomster', label: 'Övriga inkomster', side: 'in', description: 'Försåld egendom, återbetalda lån, statliga pensionsavgifter (kalkylmässiga inkomster)' },
  {
    id: 'vf-kommuner',
    label: 'Kommunalskatt till kommunerna',
    side: 'out',
    parent: GROUP_VIDAREFORING,
    description: 'Den kommunala inkomstskattens kommundel som staten betalat ut under året – preliminärt belopp efter prognos plus avräkning för tidigare år (inkomsttitel 1811, fördelad efter riksgenomsnittets skattesatser)',
  },
  {
    id: 'vf-regioner',
    label: 'Kommunalskatt till regionerna',
    side: 'out',
    parent: GROUP_VIDAREFORING,
    description: 'Den kommunala inkomstskattens regiondel som staten betalat ut under året – preliminärt belopp efter prognos plus avräkning för tidigare år (inkomsttitel 1811, fördelad efter riksgenomsnittets skattesatser)',
  },
  {
    id: 'vf-pension',
    label: 'Avgifter till pensionssystemet',
    side: 'out',
    parent: GROUP_VIDAREFORING,
    description: 'Ålderspensionsavgifter och allmän pensionsavgift till AP-fonderna och premiepensionen (inkomsttitel 1812/1813)',
  },
  {
    id: 'vf-eu',
    label: 'Tullar och avgifter till EU',
    side: 'out',
    parent: GROUP_VIDAREFORING,
    description: 'Tullar och andra skatter som tillfaller EU (inkomsttitel 1711)',
  },
  {
    id: 'avrakningar',
    label: 'Avräkningar i skattesystemet',
    side: 'out',
    description: 'Periodiseringar, avräkningar och tillkommande skatter i anslutning till skattesystemet (netto)',
    flippedLabel: 'Avräkningar i skattesystemet (netto in)',
  },
  {
    id: 'krediteringar',
    label: 'Stöd som betalas via skattekontot',
    side: 'out',
    description: 'Utgifter som redovisas som krediteringar på skattekontot, t.ex. anställningsstöd (inkomsttyp 8000)',
    flippedLabel: 'Stöd via skattekontot (netto in)',
  },
];

/** Tillfällig post för inkomsttitel 1811 innan den delas mellan kommuner och regioner. */
const VF_KOMMUNAL = 'vf-kommunal';

/** Inkomstpost för en rad: per huvudgrupp för skatter (typ 1000), per typ för övriga. */
export function incomeItemFor(r: IncomeRow): string | null {
  if (r.typ === '1000') {
    const map: Record<string, string> = {
      '1100': 'skatt-arbete-direkt',
      '1200': 'skatt-arbete-indirekt',
      '1300': 'skatt-kapital',
      '1400': 'skatt-konsumtion',
      '1500': 'skatt-ovriga',
      '1600': 'skatt-ovriga',
      '1700': 'vf-eu',
      '1900': 'avrakningar',
    };
    if (r.huvudgrupp === '1800') {
      // 1811 kommunala skatter delas mellan kommuner och regioner i signedStateItems
      const titles: Record<string, string> = { '1811': VF_KOMMUNAL, '1812': 'vf-pension', '1813': 'vf-pension' };
      const t = titles[r.titel];
      if (!t) throw new Error(`Okänd inkomsttitel ${r.titel} under avgående poster 1800 (${r.year})`);
      return t;
    }
    const id = map[r.huvudgrupp];
    if (!id) throw new Error(`Okänd skattehuvudgrupp ${r.huvudgrupp} (${r.year})`);
    return id;
  }
  const byType: Record<string, string> = {
    '2000': 'statens-verksamhet',
    '3000': 'ovriga-inkomster',
    '4000': 'ovriga-inkomster',
    '5000': 'ovriga-inkomster',
    '6000': 'eu-bidrag',
    '7000': 'avrakningar',
    '8000': 'krediteringar',
  };
  const id = byType[r.typ];
  if (!id) throw new Error(`Okänd inkomsttyp ${r.typ} (${r.year})`);
  return id;
}

/** Utgiftsrader utan utgiftsområde som ingår i budgetsaldot. */
export const EXPENSE_SPECIAL: Record<string, StateItem> = {
  'Riksgäldskontorets nettoutlåning': {
    id: 'rgk-nettoutlaning',
    label: 'Riksgäldens nettoutlåning',
    side: 'out',
    parent: GROUP_STATSBUDGET,
    description: 'Riksgäldskontorets utlåning till myndigheter och statliga bolag, netto',
    flippedLabel: 'Riksgäldens nettoutlåning (återbetalt netto)',
  },
  'Kassamässig korrigering': {
    id: 'kassamassig',
    label: 'Kassamässig korrigering',
    side: 'out',
    parent: GROUP_STATSBUDGET,
    description: 'Skillnad mellan anslagsavräknade och kassamässiga utgifter',
    flippedLabel: 'Kassamässig korrigering (netto in)',
  },
};
/** Utgiftsrader som INTE ingår i budgetsaldot. */
export const EXPENSE_IGNORED = new Set([
  'Utgiftstak',
  'Marginal till utgiftstaket',
  'Ålderspensionssystemet vid sidan av statens budget',
  'Förändring av anslagsbehållningar',
]);

export const uoNodeId = (uo: string) => `uo-${uo}`;
export const OTHER_UO = 'uo-ovriga';

/**
 * Bygger statens flöde för ett år. Returnerar belopp med tecken per post (positivt = postens normala sida),
 * statsbudgetens inkomster och utgifter samt budgetsaldot (inkomster − utgifter).
 * `municipalShare` = kommunernas andel av den kommunala skattesatsen (resten går till regionerna).
 */
export function signedStateItems(
  income: IncomeRow[],
  expense: ExpenseRow[],
  year: string,
  topAreas: Set<string>,
  municipalShare: number,
): { items: Record<string, number>; saldo: number; budgetIncome: number; budgetExpense: number } {
  if (!(municipalShare > 0 && municipalShare < 1)) throw new Error(`Ogiltig kommunandel ${municipalShare} (${year})`);
  const items: Record<string, number> = {};
  const add = (id: string, v: number) => (items[id] = (items[id] ?? 0) + v);
  let budgetIncome = 0;
  let budgetExpense = 0;

  for (const r of income) {
    if (r.year !== year) continue;
    const id = incomeItemFor(r)!;
    budgetIncome += r.utfall;
    if (id === VF_KOMMUNAL) {
      // Avgående post (negativ inkomst) → positivt utflöde, delat mellan kommuner och regioner
      add('vf-kommuner', -r.utfall * municipalShare);
      add('vf-regioner', -r.utfall * (1 - municipalShare));
      continue;
    }
    const item = INCOME_ITEMS.find((i) => i.id === id)!;
    // Avdrag (negativa inkomster) som hör till en utflödespost lagras med positivt tecken på utflödessidan
    add(id, item.side === 'in' ? r.utfall : -r.utfall);
  }
  for (const r of expense) {
    if (r.year !== year) continue;
    if (r.uo) {
      add(topAreas.has(r.uo) ? uoNodeId(r.uo) : OTHER_UO, r.utfall);
      budgetExpense += r.utfall;
    } else if (EXPENSE_SPECIAL[r.uoName]) {
      add(EXPENSE_SPECIAL[r.uoName]!.id, r.utfall);
      budgetExpense += r.utfall;
    } else if (!EXPENSE_IGNORED.has(r.uoName)) {
      throw new Error(`Okänd utgiftsrad "${r.uoName}" (${year})`);
    }
  }
  return { items, saldo: budgetIncome - budgetExpense, budgetIncome, budgetExpense };
}

/** Lägger poster på rätt sida (negativa flyttas) och lägger till saldonoden. Alla belopp positiva. */
export function placeStateItems(items: Record<string, number>, saldo: number, sides: Map<string, 'in' | 'out'>) {
  const values: Record<string, number> = {};
  const round = (v: number) => Math.round(v * 10) / 10;
  for (const [id, v] of Object.entries(items)) {
    if (!sides.has(id)) throw new Error(`Okänd post ${id}`);
    const r = round(Math.abs(v));
    if (r === 0) continue;
    values[v >= 0 ? id : `${id}-motsatt`] = r;
  }
  if (saldo > 0) values['budgetoverskott'] = round(saldo);
  else if (saldo < 0) values['budgetunderskott'] = round(-saldo);
  return values;
}

export const SALDO_NODES: FlowNode[] = [
  { id: 'budgetunderskott', label: 'Budgetunderskott (lånat)', side: 'in', role: 'balance', description: 'Statsbudgetens underskott – finansieras med upplåning via Riksgälden' },
  { id: 'budgetoverskott', label: 'Budgetöverskott', side: 'out', role: 'balance', description: 'Statsbudgetens överskott – används för att amortera statsskulden' },
];

/** Nod för en post, och dess spegelnod för negativa belopp. */
export function nodesFor(item: StateItem): FlowNode[] {
  const base: FlowNode = { id: item.id, label: item.label, side: item.side, description: item.description, parent: item.parent };
  const flipped: FlowNode = {
    id: `${item.id}-motsatt`,
    label: item.flippedLabel ?? `${item.label} (netto ${item.side === 'in' ? 'ut' : 'in'})`,
    side: item.side === 'in' ? 'out' : 'in',
    description: item.description,
  };
  return [base, flipped];
}
