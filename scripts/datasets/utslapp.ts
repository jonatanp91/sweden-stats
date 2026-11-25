/**
 * Utsläpp – SCB TAB4698 "Totala utsläpp och upptag av växthusgaser efter växthusgas och sektor".
 * Datan tas fram av Naturvårdsverket (SMED) för den nationella växthusgasinventeringen.
 * Producerar: utslapp-vaxthusgaser-sektor
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchPxTable, jsonStatToRecords, normalizePeriod, scbProductUrl, SCB_LICENSE } from '../lib/pxweb.ts';

const TABLE = 'TAB4698';
const NATIONAL_TOTAL = '0.1'; // exkl. LULUCF och utrikes transporter = Sveriges territoriella utsläpp

/**
 * Sektorerna slås ihop till högst sju grupper + "Övrigt" så att diagrammet håller sig inom
 * sajtens validerade färgpalett (8 kategoriska färger). Ordningen = staplingsordning nerifrån.
 */
const GROUPS: { key: string; label: string; sectors: string[] }[] = [
  { key: 'transporter', label: 'Inrikes transporter', sectors: ['8.0'] },
  { key: 'industri', label: 'Industri', sectors: ['4.0'] },
  { key: 'jordbruk', label: 'Jordbruk', sectors: ['6.0'] },
  { key: 'el-fjarrvarme', label: 'El och fjärrvärme', sectors: ['3.0'] },
  { key: 'arbetsmaskiner', label: 'Arbetsmaskiner', sectors: ['1.0'] },
  { key: 'uppvarmning', label: 'Uppvärmning av bostäder och lokaler', sectors: ['9.0'] },
  { key: 'ovrigt', label: 'Övrigt (avfall, lösningsmedel m.m.)', sectors: ['2.0', '7.0'] },
];

export const utslapp: Fetcher = {
  name: 'utslapp',
  produces: ['utslapp-vaxthusgaser-sektor'],
  async run() {
    const sectors = [NATIONAL_TOTAL, ...GROUPS.flatMap((g) => g.sectors)];
    const { data, apiUrl } = await fetchPxTable(TABLE, {
      Vaxthusgaser: ['CO2-ekv.'],
      Sektor: sectors,
      ContentsCode: ['0000018Q'],
      Tid: '*',
    });
    const records = jsonStatToRecords(data);
    const years = [...new Set(records.map((r) => r.codes.Tid!))].sort();
    // ".." betyder enligt SCB att värdet är noll → null i JSON-stat; räknas som 0 vid summering.
    const val = (sector: string, year: string) =>
      records.find((r) => r.codes.Sektor === sector && r.codes.Tid === year)?.value ?? 0;
    const groupSum = (g: (typeof GROUPS)[number], y: string) => g.sectors.reduce((a, s) => a + val(s, y), 0);

    // Kontroll: grupperna ska summera till nationell total
    for (const y of years) {
      const sum = GROUPS.reduce((a, g) => a + groupSum(g, y), 0);
      const total = val(NATIONAL_TOTAL, y);
      if (Math.abs(sum - total) > Math.abs(total) * 0.005) {
        throw new Error(`Utsläpp ${y}: sektorsumma ${sum} avviker från total ${total}`);
      }
    }

    return [
      {
        id: 'utslapp-vaxthusgaser-sektor',
        title: 'Sveriges växthusgasutsläpp per sektor',
        description:
          'Territoriella utsläpp av växthusgaser omräknat till koldioxidekvivalenter, exklusive markanvändning (LULUCF) och utrikes transporter.',
        category: 'utslapp',
        unit: 'miljoner ton CO₂-ekv.',
        frequency: 'year',
        source: {
          org: 'SCB',
          producer: 'Naturvårdsverket',
          name: 'Totala utsläpp och upptag av växthusgaser efter växthusgas och sektor',
          url: scbProductUrl(data),
          apiUrl,
          tableId: TABLE,
          license: SCB_LICENSE,
          updated: data.updated,
        },
        fetchedAt: now(),
        chart: { type: 'stacked-bar', yFromZero: true, decimals: 1 },
        notes: [
          'Beräknat av SMED på uppdrag av Naturvårdsverket för den årliga växthusgasinventeringen enligt FN:s klimatkonvention.',
          'Avfall och lösningsmedel/övrig produktanvändning är sammanslagna till "Övrigt".',
          'Sektorerna summerar till SCB:s "Nationell total (exklusive LULUCF, exklusive internationella transporter)".',
        ],
        series: GROUPS.map((g) => ({
          key: g.key,
          label: g.label,
          // kt → miljoner ton
          points: years.map((y) => ({ t: normalizePeriod(y), v: Math.round(groupSum(g, y)) / 1000 })),
        })),
      },
    ];
  },
};
