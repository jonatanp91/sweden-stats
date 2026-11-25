/**
 * Statsskulden – SCB TAB6378 "Statsskulden fördelad på marknader" (OE0202, framtagen av Riksgälden).
 * Producerar:
 *  - skatter-statsskuld   statsskulden per månad i miljarder kr
 *  - skatter-skuld-bnp    statsskulden och Maastrichtskulden (TAB5050) i procent av BNP (TAB121)
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchPxTable, jsonStatToRecords, normalizePeriod, scbProductUrl, SCB_LICENSE } from '../lib/pxweb.ts';
import { fetchDebtDecember, fetchGdp, fetchMaastrichtDebt } from '../lib/scb-series.ts';

const TABLE = 'TAB6378';

export const statsskuld: Fetcher = {
  name: 'statsskuld',
  produces: ['skatter-statsskuld', 'skatter-skuld-bnp'],
  async run() {
    const { data, apiUrl } = await fetchPxTable(TABLE, { Marknad: ['SSTot'], ContentsCode: ['000007J7'], Tid: '*' });
    const unit = Object.values(data.dimension.ContentsCode?.category.unit ?? {})[0]?.base;
    if (unit !== 'mkr') throw new Error(`Oväntad enhet för statsskulden: ${unit}`);
    const points = jsonStatToRecords(data).map((r) => ({
      t: normalizePeriod(r.codes.Tid!),
      // mkr → miljarder kr
      v: r.value === null ? null : Math.round(r.value / 100) / 10,
    }));

    return [
      {
        id: 'skatter-statsskuld',
        title: 'Statsskulden',
        description: 'Statens bruttoskuld i slutet av varje månad sedan 1970, enligt Riksgäldens officiella mått.',
        category: 'skatter',
        unit: 'miljarder kr',
        frequency: 'month',
        source: {
          org: 'SCB',
          producer: 'Riksgälden',
          name: 'Statsskulden fördelad på marknader',
          url: scbProductUrl(data),
          apiUrl,
          tableId: TABLE,
          license: SCB_LICENSE,
          updated: data.updated,
        },
        fetchedAt: now(),
        chart: { type: 'area', yFromZero: true, decimals: 1 },
        notes: [
          'Löpande priser – beloppen är inte justerade för inflation eller ekonomins storlek.',
          'Före november 2001 redovisas statsskulden exklusive inflationskompensation.',
          'Redovisningen ändrades i januari 2012 (bl.a. ingår säkerheter) och i januari 2024 (bankkonton på likviddag). Historiken är reviderad tillbaka till november 2001.',
        ],
        series: [{ key: 'statsskuld', label: 'Statsskuld', points }],
      },
      await debtToGdp(),
    ];
  },
};

/** Skuld i procent av BNP: statsskulden (december) och Maastrichtskulden. */
async function debtToGdp() {
  const debt = await fetchDebtDecember();
  const maastricht = await fetchMaastrichtDebt();
  const gdp = await fetchGdp();

  // Kontroll: BNP i TAB121 ska stämma med nationalräkenskapernas försörjningsbalans (TAB5621)
  const nr = await fetchPxTable('TAB5621', { Anvandningstyp: ['BNPM'], ContentsCode: ['000004BZ'], Tid: '*' });
  let checked = 0;
  for (const r of jsonStatToRecords(nr.data)) {
    const a = gdp.values.get(r.codes.Tid!);
    if (a === undefined || r.value === null) continue;
    checked++;
    if (Math.abs(a - r.value) > r.value * 0.005) {
      console.warn(`  ! BNP ${r.codes.Tid}: TAB121 ${a} mnkr ≠ TAB5621 ${r.value} mnkr`);
    }
  }
  if (checked < 10) throw new Error(`BNP-kontrollen mot TAB5621 omfattade bara ${checked} år`);

  const years = [...gdp.values.keys()].filter((y) => debt.values.has(y) || maastricht.values.has(y)).sort();
  const ratio = (m: Map<string, number>) =>
    years.map((t) => {
      const d = m.get(t);
      const g = gdp.values.get(t);
      return { t, v: d !== undefined && g ? Math.round((d / g) * 1000) / 10 : null };
    });

  return {
    id: 'skatter-skuld-bnp',
    title: 'Skulden i förhållande till BNP',
    description:
      'Statsskulden och den offentliga sektorns samlade skuld (Maastrichtskulden) i procent av BNP. Måttet tar hänsyn till inflation och ekonomins storlek och går därför att jämföra över tid.',
    category: 'skatter',
    unit: '% av BNP',
    frequency: 'year' as const,
    source: maastricht.source,
    extraSources: [debt.source, gdp.source],
    fetchedAt: now(),
    chart: { type: 'line' as const, yFromZero: true, decimals: 1 },
    notes: [
      'Maastrichtskulden är offentlig förvaltnings konsoliderade bruttoskuld (staten, kommuner, regioner och pensionssystemet, efter att skulder mellan dem räknats bort). Det är det officiella måttet för de offentliga finanserna: EU:s gräns är 60 % av BNP och det svenska skuldankaret 35 % (±5 procentenheter).',
      'Statsskulden är Riksgäldens mått på statens skuld vid årets slut (december). Den skiljer sig från Maastrichtskulden bl.a. genom att den inte omfattar kommunsektorn och att statens interna skulder och vissa lån till t.ex. Riksbanken räknas annorlunda.',
      'BNP till marknadspris i löpande priser (SCB:s nationalräkenskaper, via tabellen över skattekvoten som även har senaste året). Senaste årets BNP är preliminärt och revideras.',
      'Före november 2001 redovisas statsskulden exklusive inflationskompensation.',
    ],
    series: [
      { key: 'maastricht', label: 'Maastrichtskuld (offentlig sektor)', points: ratio(maastricht.values) },
      { key: 'statsskuld', label: 'Statsskuld (Riksgälden)', points: ratio(debt.values) },
    ],
  };
}
