/**
 * El – SCB TAB5644 "Elproduktion efter produktionsslag. Månad 2017M01–" (EN0108, Energimyndigheten/SCB).
 * Producerar: el-produktion-kraftslag (helår), el-produktion-manad (månad)
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchPxTable, jsonStatToRecords, normalizePeriod, scbProductUrl, SCB_LICENSE } from '../lib/pxweb.ts';

const TABLE = 'TAB5644';

/** Ordning = staplingsordning nerifrån (största först). */
const TYPES: { code: string; label: string }[] = [
  { code: 'Vattenkraft', label: 'Vattenkraft' },
  { code: 'Karnkraft', label: 'Kärnkraft' },
  { code: 'Vindkraft', label: 'Vindkraft' },
  { code: 'VarmekrF', label: 'Värmekraft, förnybar' },
  { code: 'VarmekrEjF', label: 'Värmekraft, ej förnybar' },
  { code: 'Solkraft', label: 'Solkraft' },
];

export const el: Fetcher = {
  name: 'el',
  produces: ['el-produktion-kraftslag', 'el-produktion-manad'],
  async run() {
    const { data, apiUrl } = await fetchPxTable(TABLE, {
      Produktionsslag: ['Total', ...TYPES.map((t) => t.code)],
      ContentsCode: ['000004DF'],
      Tid: '*',
    });
    const records = jsonStatToRecords(data);
    const months = [...new Set(records.map((r) => r.codes.Tid!))].sort();
    const val = (type: string, m: string) =>
      records.find((r) => r.codes.Produktionsslag === type && r.codes.Tid === m)?.value ?? null;

    // Helår: endast år där alla 12 månader finns
    const byYear = new Map<string, string[]>();
    for (const m of months) {
      const y = m.slice(0, 4);
      byYear.set(y, [...(byYear.get(y) ?? []), m]);
    }
    const fullYears = [...byYear.entries()].filter(([, ms]) => ms.length === 12).map(([y]) => y);
    const yearSum = (type: string, y: string) => byYear.get(y)!.reduce((a, m) => a + (val(type, m) ?? 0), 0);

    for (const y of fullYears) {
      const sum = TYPES.reduce((a, t) => a + yearSum(t.code, y), 0);
      const total = yearSum('Total', y);
      if (Math.abs(sum - total) > total * 0.01) {
        throw new Error(`Elproduktion ${y}: summa ${sum} GWh avviker från total ${total} GWh`);
      }
    }

    const source = {
      org: 'SCB',
      producer: 'Energimyndigheten',
      name: 'Elproduktion efter produktionsslag. Månad 2017M01–',
      url: scbProductUrl(data),
      apiUrl,
      tableId: TABLE,
      license: SCB_LICENSE,
      updated: data.updated,
    };
    const fetchedAt = now();

    return [
      {
        id: 'el-produktion-kraftslag',
        title: 'Elproduktion per kraftslag',
        description: 'Sveriges nettoproduktion av el per år, fördelad på kraftslag.',
        category: 'el',
        unit: 'TWh',
        frequency: 'year',
        source,
        fetchedAt,
        chart: { type: 'stacked-bar', yFromZero: true, decimals: 1 },
        notes: [
          'Helårssummor av SCB:s månadsstatistik; innevarande år visas först när alla tolv månader finns.',
          'Vattenkraft inkluderar pumpkraft. Värmekraft omfattar kraftvärme, industriellt mottryck och kondenskraft.',
        ],
        series: TYPES.map((t) => ({
          key: t.code,
          label: t.label,
          points: fullYears.map((y) => ({ t: y, v: Math.round(yearSum(t.code, y) * 10) / 10000 })),
        })),
      },
      {
        id: 'el-produktion-manad',
        title: 'Elproduktion per månad',
        description: 'Månatlig nettoproduktion av el per kraftslag. Här syns årstidsvariationen tydligt.',
        category: 'el',
        unit: 'GWh',
        frequency: 'month',
        source,
        fetchedAt,
        chart: { type: 'stacked-area', yFromZero: true },
        notes: ['De senaste månaderna kan vara preliminära och revideras av SCB.'],
        series: TYPES.map((t) => ({
          key: t.code,
          label: t.label,
          points: months.map((m) => ({ t: normalizePeriod(m), v: val(t.code, m) })),
        })),
      },
    ];
  },
};
