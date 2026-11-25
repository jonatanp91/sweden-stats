/**
 * Klimat – SMHI metobs, parameter 22 (lufttemperatur, månadsmedel), station 53430 Lund.
 * Lund har en av Sveriges längsta sammanhängande temperaturserier (från 1753).
 * Producerar: klimat-temperatur-lund
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { annualMeans, fetchSmhiCsv, parseSmhiMonthlyCsv, SMHI_LICENSE, trailingMean } from '../lib/smhi.ts';

const PARAMETER = 22;
const STATION = 53430;
const WINDOW = 10;

/** Beskriver luckor längre än ett år, t.ex. "1773–1858". */
function gapText(points: { t: string }[]): string {
  const gaps: string[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = Number(points[i - 1]!.t);
    const b = Number(points[i]!.t);
    if (b - a > 2) gaps.push(`${a + 1}–${b - 1}`);
  }
  return gaps.join(', ') || 'inga år';
}

export const klimat: Fetcher = {
  name: 'klimat',
  produces: ['klimat-temperatur-lund'],
  async run() {
    const { text, apiUrl } = await fetchSmhiCsv(PARAMETER, STATION);
    const { stationName, rows } = parseSmhiMonthlyCsv(text);
    const annual = annualMeans(rows).map((a) => ({ t: a.year, v: a.value }));

    return [
      {
        id: 'klimat-temperatur-lund',
        title: `Årsmedeltemperatur i ${stationName}`,
        description: `Årets medeltemperatur vid SMHI:s station ${stationName}, med ${WINDOW}-årigt glidande medelvärde. Serien börjar 1753 men saknar data för åren ${gapText(annual)}.`,
        category: 'klimat',
        unit: '°C',
        frequency: 'year',
        source: {
          org: 'SMHI',
          name: `Lufttemperatur, månadsmedel – station ${stationName} (${STATION})`,
          url: 'https://www.smhi.se/data/meteorologi/ladda-ner-meteorologiska-observationer',
          apiUrl,
          tableId: `parameter ${PARAMETER}, station ${STATION}`,
          license: SMHI_LICENSE,
        },
        fetchedAt: now(),
        chart: { type: 'line', yFromZero: false, decimals: 1 },
        notes: [
          'Luckor i serien beror på att SMHI saknar fullständiga månadsvärden för de åren.',
          'Årsmedel beräknat som medelvärdet av årets tolv månadsmedel ur SMHI:s kvalitetskontrollerade arkiv. År med saknade månader är uteslutna.',
          `Glidande medelvärde = medel av de ${WINDOW} senaste åren (bakåtblickande).`,
          'Stationen har flyttats några gånger under perioden (se SMHI:s stationsmetadata), vilket kan påverka jämförbarheten något.',
        ],
        series: [
          { key: 'arsmedel', label: 'Årsmedel', role: 'muted', points: annual },
          { key: 'glidande', label: `${WINDOW}-årsmedel`, points: trailingMean(annual, WINDOW) },
        ],
      },
    ];
  },
};
