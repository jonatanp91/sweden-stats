/**
 * Staten – statsbudgetens utfall från Statskontoret (öppna data, CC0).
 * Producerar: skatter-staten-flode (Sankey: skatter och andra inkomster → staten → vidareföring, utgiftsområden, saldo)
 *            skatter-staten-utgifter (tidsserie: utgifter per utgiftsområde i procent av BNP)
 *
 * Bruttoperspektiv (ägarens val): skatterna visas brutto till vänster; det som staten för vidare till kommuner,
 * regioner, pensionssystemet och EU visas som en egen utgiftspost. Budgetsaldot balanserar flödet.
 */
import type { FlowNode } from '../../src/lib/types.ts';
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import {
  ARSUTFALL_PAGE,
  EXPENSE_SPECIAL,
  fetchZipCsv,
  findArsutfallLinks,
  GROUP_NODES,
  GROUP_STATSBUDGET,
  INCOME_ITEMS,
  nodesFor,
  OTHER_UO,
  placeStateItems,
  SALDO_NODES,
  signedStateItems,
  STATSKONTORET_LICENSE,
  toExpenseRows,
  toIncomeRows,
  uoNodeId,
  type ExpenseRow,
} from '../lib/statskontoret.ts';
import { fetchDebtDecember, fetchGdp, fetchMunicipalTaxShare, fetchPopulationRiket, type YearSeries } from '../lib/scb-series.ts';

const TOP_AREAS = 12;
const FIRST_YEAR = 2006;

export const staten: Fetcher = {
  name: 'staten',
  produces: ['skatter-staten-flode', 'skatter-staten-utgifter'],
  async run() {
    const links = await findArsutfallLinks();
    const income = toIncomeRows(await fetchZipCsv(links.inkomster));
    const expense = toExpenseRows(await fetchZipCsv(links.utgifter));
    const share = await fetchMunicipalTaxShare();
    const population = await fetchPopulationRiket();
    const debt = await fetchDebtDecember();
    const gdp = await fetchGdp();

    const incomeYears = new Set(income.map((r) => r.year));
    const years = [...new Set(expense.map((r) => r.year))]
      .filter((y) => incomeYears.has(y) && Number(y) >= FIRST_YEAR)
      .sort();
    const latest = years[years.length - 1]!;

    // De största utgiftsområdena senaste året får egna noder; resten blir "Övriga utgiftsområden"
    const areaTotals = new Map<string, { name: string; total: number }>();
    for (const r of expense) {
      if (r.year !== latest || !r.uo) continue;
      const a = areaTotals.get(r.uo) ?? { name: r.uoName, total: 0 };
      a.total += r.utfall;
      areaTotals.set(r.uo, a);
    }
    const ranked = [...areaTotals.entries()].sort((a, b) => b[1].total - a[1].total);
    const top = ranked.slice(0, TOP_AREAS);
    const rest = ranked.slice(TOP_AREAS);
    const topSet = new Set(top.map(([uo]) => uo));

    const items = [
      ...INCOME_ITEMS,
      ...top.map(([uo, a]) => ({
        id: uoNodeId(uo),
        label: a.name,
        side: 'out' as const,
        parent: GROUP_STATSBUDGET,
        description: `Utgiftsområde ${Number(uo)}`,
      })),
      {
        id: OTHER_UO,
        label: 'Övriga utgiftsområden',
        side: 'out' as const,
        parent: GROUP_STATSBUDGET,
        description: rest.map(([uo, a]) => `${Number(uo)} ${a.name}`).join(', '),
      },
      ...Object.values(EXPENSE_SPECIAL),
    ];
    const allNodes = [...GROUP_NODES, ...items.flatMap(nodesFor), ...SALDO_NODES];
    const sides = new Map<string, 'in' | 'out'>(items.map((i) => [i.id, i.side]));

    const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
    // Kommunalskatt: utbetalt under året (1811, avgående post) jämfört med skatten på årets inkomster (1115)
    const titleSum = (titel: string) => income.filter((r) => r.year === latest && r.titel === titel).reduce((a, r) => a + r.utfall, 0);
    const paidOut = -titleSum('1811');
    const accrued = titleSum('1115');
    if (!(paidOut > 0 && accrued > 0)) throw new Error(`Inkomsttitel 1811/1115 saknas för ${latest}`);
    const mdkr = (v: number) => `${Math.round(v / 1000).toLocaleString('sv-SE')} mdkr`;
    const yearData = years.map((y) => {
      const municipalShare = share.values.get(y);
      if (municipalShare === undefined) throw new Error(`Kommunal skattesats saknas i TAB2015 för ${y}`);
      const { items: signed, saldo, budgetIncome, budgetExpense } = signedStateItems(income, expense, y, topSet, municipalShare);
      const pop = population.values.get(y);
      const debtY = debt.values.get(y);
      const gdpY = gdp.values.get(y);
      const grossTax = INCOME_ITEMS.filter((i) => i.side === 'in' && i.id.startsWith('skatt-')).reduce((a, i) => a + (signed[i.id] ?? 0), 0);
      console.log(`  ${y}: budgetsaldo ${saldo >= 0 ? '+' : ''}${Math.round(saldo / 1000)} mdkr`);
      return {
        year: y,
        values: { SE: placeStateItems(signed, saldo, sides) },
        ...(pop ? { population: { SE: pop } } : {}),
        keyFigures: {
          SE: {
            'skatter-brutto': round(grossTax),
            inkomster: round(budgetIncome),
            utgifter: round(budgetExpense),
            saldo: round(saldo),
            'utgifter-per-inv': pop ? round((budgetExpense * 1e6) / pop) : null,
            statsskuld: debtY ?? null,
            'statsskuld-bnp': debtY && gdpY ? round((debtY / gdpY) * 100, 1) : null,
          },
        },
      };
    });

    // Ta bara med noder som faktiskt används (t.ex. spegelnoder för negativa belopp); gruppnoder behålls
    const used = new Set(yearData.flatMap((y) => Object.keys(y.values.SE)));
    const nodes: FlowNode[] = allNodes.filter((n) => used.has(n.id) || n.role === 'group');
    // Inflöden först (sorterade som i INCOME_ITEMS), utflöden därefter
    nodes.sort((a, b) => (a.side === b.side ? 0 : a.side === 'in' ? -1 : 1));

    const fetchedAt = now();
    return [
      {
        output: 'flow',
        meta: {
          kind: 'flow',
          id: 'skatter-staten-flode',
          title: 'Statens budget: var pengarna kommer ifrån och vart de går',
          description:
            'Alla skatter som staten tar in till vänster. Till höger i två steg: först skatterna som förs vidare och statsbudgetens utgifter, sedan vart pengarna tar vägen – kommuner, regioner, pensionssystemet och EU respektive statens utgiftsområden.',
          category: 'skatter',
          source: {
            org: 'Statskontoret',
            name: 'Statsbudgetens utfall – årsutfall utgifter',
            url: ARSUTFALL_PAGE,
            apiUrl: links.utgifter,
            license: STATSKONTORET_LICENSE,
          },
          extraSources: [
            {
              org: 'Statskontoret',
              name: 'Statsbudgetens utfall – årsutfall inkomster',
              url: ARSUTFALL_PAGE,
              apiUrl: links.inkomster,
              license: STATSKONTORET_LICENSE,
            },
            share.source,
            population.source,
            debt.source,
            gdp.source,
          ],
          fetchedAt,
          notes: [
            'Bruttoperspektiv: skatterna visas som staten tar in dem. En stor del – den kommunala inkomstskatten till kommuner och regioner, avgifterna till pensionssystemet och tullar till EU – förs direkt vidare och visas som "Skatter som förs vidare". Statsbudgetens egna inkomster är summan efter den posten.',
            'Den kommunala inkomstskatten redovisas som en post (inkomsttitel 1811). Uppdelningen på kommuner och regioner följer riksgenomsnittets skattesatser samma år (SCB TAB2015) och är därför en uppskattning.',
            `Kommunalskatten till kommuner och regioner är det staten betalade ut under året (${latest}: ${mdkr(paidOut)}). Den kommunala inkomstskatten på årets inkomster var ${mdkr(accrued)} (inkomsttitel 1115). Skillnaden beror på att utbetalningarna är preliminära – de bygger på en prognos för skatteunderlaget – och att avräkningen mot den slutliga skatten görs två år senare. Kommunernas och regionernas egna bokslut (deras budgetdiagram) ligger nära den faktiska skatten.`,
            '"Statsbudgetens utgifter" omfattar utgiftsområdena, Riksgäldens nettoutlåning och kassamässig korrigering när de är positiva. Avräkningar och stöd via skattekontot hör till inkomstsidan och visas för sig.',
            'Belopp per invånare beräknas med folkmängden i riket den 31 december (SCB TAB4365). Statsskulden avser december respektive år (Riksgälden via SCB TAB6378) och BNP löpande priser (SCB TAB121).',
            'Budgetsaldot = statsbudgetens inkomster minus utgifter (utgiftsområden, Riksgäldens nettoutlåning och kassamässig korrigering). Ålderspensionssystemet ligger vid sidan av statens budget och ingår inte.',
            `De ${TOP_AREAS} största utgiftsområdena ${latest} visas var för sig; övriga är sammanslagna. Statskontorets fil använder dagens indelning av utgiftsområden även för tidigare år.`,
            'Senaste årets inkomster kan vara preliminära och revideras när Statskontoret publicerar definitivt utfall.',
            'Avräkningar i skattesystemet är ett netto av periodiseringar, avräkningar mot kommunsektorn och tillkommande skatter.',
          ],
          unit: 'mnkr',
          entityLabel: 'Enhet',
          entityParam: 'staten',
          entities: [{ code: 'SE', name: 'Staten' }],
          defaultEntity: 'SE',
          years,
          nodes,
          keyFigures: [
            { key: 'skatter-brutto', label: 'Skatteintäkter (brutto)', unit: 'mnkr', decimals: 0 },
            { key: 'inkomster', label: 'Statsbudgetens inkomster', unit: 'mnkr', decimals: 0 },
            { key: 'utgifter', label: 'Statsbudgetens utgifter', unit: 'mnkr', decimals: 0 },
            { key: 'saldo', label: 'Budgetsaldo', unit: 'mnkr', decimals: 0 },
            { key: 'utgifter-per-inv', label: 'Statsbudgetens utgifter per invånare', unit: 'kr', decimals: 0 },
            { key: 'statsskuld', label: 'Statsskuld vid årets slut', unit: 'mnkr', decimals: 0 },
            { key: 'statsskuld-bnp', label: 'Statsskuld i % av BNP', unit: '%', decimals: 1 },
          ],
          dataPath: 'data/skatter-staten-flode',
        },
        years: yearData,
      },
      expenseByArea(expense, years, ranked, gdp, links.utgifter, fetchedAt),
    ];
  },
};

const SERIES_AREAS = 7;

/**
 * Statens utgifter per utgiftsområde över tid i procent av BNP: de största områdena senaste året var för sig,
 * resten som "Övriga utgiftsområden" (max 8 serier). Bara utgiftsområden – inte Riksgäldens nettoutlåning eller
 * kassamässig korrigering.
 */
function expenseByArea(
  expense: ExpenseRow[],
  years: string[],
  ranked: [string, { name: string; total: number }][],
  gdp: YearSeries,
  apiUrl: string,
  fetchedAt: string,
) {
  const top = ranked.slice(0, SERIES_AREAS);
  const topSet = new Set(top.map(([uo]) => uo));
  const OTHER = 'ovriga';
  // år → serie → mnkr
  const sums = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of expense) {
    if (!r.uo || !years.includes(r.year)) continue;
    const key = topSet.has(r.uo) ? r.uo : OTHER;
    const m = sums.get(r.year) ?? new Map<string, number>();
    m.set(key, (m.get(key) ?? 0) + r.utfall);
    sums.set(r.year, m);
    totals.set(r.year, (totals.get(r.year) ?? 0) + r.utfall);
  }
  const usable = years.filter((y) => gdp.values.has(y) && sums.has(y));
  // Summakontroll: serierna ska summera till utgiftsområdenas totala utgifter
  for (const y of usable) {
    const s = [...sums.get(y)!.values()].reduce((a, v) => a + v, 0);
    if (Math.abs(s - totals.get(y)!) > 1) throw new Error(`Utgiftsområden ${y}: ${s} ≠ ${totals.get(y)}`);
  }
  const last = usable[usable.length - 1]!;
  const pctOf = (key: string) =>
    usable.map((t) => ({ t, v: Math.round(((sums.get(t)!.get(key) ?? 0) / gdp.values.get(t)!) * 10000) / 100 }));
  const mdkr = (v: number) => `${Math.round(v / 1000).toLocaleString('sv-SE')} mdkr`;
  const lastPct = (totals.get(last)! / gdp.values.get(last)!) * 100;

  return {
    id: 'skatter-staten-utgifter',
    title: 'Statens utgifter per utgiftsområde över tid',
    description: `Statsbudgetens utgifter per utgiftsområde i procent av BNP sedan ${usable[0]}. De ${SERIES_AREAS} största områdena ${last} visas var för sig.`,
    category: 'skatter',
    unit: '% av BNP',
    frequency: 'year' as const,
    source: {
      org: 'Statskontoret',
      name: 'Statsbudgetens utfall – årsutfall utgifter',
      url: ARSUTFALL_PAGE,
      apiUrl,
      license: STATSKONTORET_LICENSE,
    },
    extraSources: [gdp.source],
    fetchedAt,
    chart: { type: 'stacked-area' as const, yFromZero: true, decimals: 2 },
    notes: [
      `Utgiftsområdenas utgifter ${last}: ${mdkr(totals.get(last)!)} i löpande priser, ${lastPct.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} % av BNP. Procent av BNP gör åren jämförbara trots inflation och ekonomisk tillväxt.`,
      'Bara statsbudgetens utgiftsområden. Riksgäldens nettoutlåning och kassamässig korrigering ingår inte, och inte heller skatter som förs vidare till kommuner, regioner och pensionssystemet (se statens budgetdiagram). Generella statsbidrag till kommuner och regioner ingår (utgiftsområde 25).',
      'Statskontorets fil använder dagens indelning av utgiftsområden även för tidigare år, så serierna är jämförbara över tid.',
      'BNP till marknadspris i löpande priser (SCB TAB121). Senaste årets BNP och utfall kan vara preliminära.',
    ],
    series: [
      ...top.map(([uo, a]) => ({ key: `uo-${uo}`, label: a.name, points: pctOf(uo) })),
      { key: OTHER, label: 'Övriga utgiftsområden', points: pctOf(OTHER) },
    ],
  };
}
