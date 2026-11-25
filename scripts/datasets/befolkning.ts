/**
 * Befolkning – SCB TAB4365 "Befolkningsutvecklingen i riket efter kön. År 1749–".
 * Producerar: befolkning-folkmangd, befolkning-forandringar
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchPxTable, jsonStatToRecords, normalizePeriod, scbProductUrl, SCB_LICENSE } from '../lib/pxweb.ts';

const TABLE = 'TAB4365';

const CHANGES: Record<string, string> = {
  '0000001H': 'Födda',
  '0000001F': 'Döda',
  '000000LX': 'Invandringar',
  '0000001G': 'Utvandringar',
};

export const befolkning: Fetcher = {
  name: 'befolkning',
  produces: ['befolkning-folkmangd', 'befolkning-forandringar'],
  async run() {
    const { data, apiUrl } = await fetchPxTable(TABLE, {
      Kon: ['1+2'],
      ContentsCode: ['000000LV', ...Object.keys(CHANGES)],
      Tid: '*',
    });
    const records = jsonStatToRecords(data);
    const seriesFor = (code: string) =>
      records
        .filter((r) => r.codes.ContentsCode === code)
        .map((r) => ({ t: normalizePeriod(r.codes.Tid!), v: r.value }));

    const source = {
      org: 'SCB',
      name: 'Befolkningsutvecklingen i riket efter kön. År 1749–',
      url: scbProductUrl(data),
      apiUrl,
      tableId: TABLE,
      license: SCB_LICENSE,
      updated: data.updated,
    };
    const fetchedAt = now();

    return [
      {
        id: 'befolkning-folkmangd',
        title: 'Folkmängd i Sverige',
        description: 'Antal invånare i Sverige den 31 december varje år, sedan 1749.',
        category: 'befolkning',
        unit: 'personer',
        frequency: 'year',
        source,
        fetchedAt,
        chart: { type: 'area', yFromZero: true },
        notes: ['Folkmängd avser den 31 december respektive år.'],
        series: [{ key: 'folkmangd', label: 'Folkmängd', points: seriesFor('000000LV') }],
      },
      {
        id: 'befolkning-forandringar',
        title: 'Födda, döda, invandrade och utvandrade',
        description: 'Antal personer per år. Skillnaden mellan flödena förklarar hur folkmängden förändras.',
        category: 'befolkning',
        unit: 'personer',
        frequency: 'year',
        source,
        fetchedAt,
        chart: { type: 'line', yFromZero: true },
        notes: ['År utan uppgift i SCB:s tabell visas som luckor.'],
        series: Object.entries(CHANGES).map(([code, label]) => ({ key: code, label, points: seriesFor(code) })),
      },
    ];
  },
};
