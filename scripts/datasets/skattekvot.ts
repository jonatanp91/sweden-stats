/**
 * Skattetryck – SCB TAB121 "Skattekvot i procent av BNP och skatter efter skattetyp" (nationalräkenskaperna).
 * Producerar: skatter-skattekvot (skatternas andel av BNP per skattetyp sedan 1950, staplad yta)
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchPxTable, jsonStatToRecords, scbProductUrl, SCB_LICENSE } from '../lib/pxweb.ts';

const TABLE = 'TAB121';
const GDP = '101';
const TOTAL = '102';
/** Serier: skattetypskoder som slås ihop (201 Sverige + 202 EU = D.2). */
const GROUPS = [
  { key: 'produktion', label: 'Moms, punktskatter och lönesummeskatter', codes: ['201', '202'] },
  { key: 'inkomst', label: 'Inkomst- och förmögenhetsskatter', codes: ['203'] },
  { key: 'sociala', label: 'Sociala avgifter', codes: ['204'] },
  { key: 'kapital', label: 'Kapitalskatter', codes: ['205'] },
] as const;
const CODES = [GDP, TOTAL, ...GROUPS.flatMap((g) => g.codes)];

export const skattekvot: Fetcher = {
  name: 'skattekvot',
  produces: ['skatter-skattekvot'],
  async run() {
    const { data, apiUrl } = await fetchPxTable(TABLE, { Skattetyp: CODES, ContentsCode: ['000000SP', '000000T8'], Tid: '*' });
    // (innehåll, skattetyp, år) → värde
    const val = new Map<string, number>();
    const years = new Set<string>();
    for (const r of jsonStatToRecords(data)) {
      if (r.value === null) continue;
      val.set(`${r.codes.ContentsCode}|${r.codes.Skattetyp}|${r.codes.Tid}`, r.value);
      years.add(r.codes.Tid!);
    }
    const get = (content: string, code: string, y: string) => val.get(`${content}|${code}|${y}`);
    const sorted = [...years].sort();

    // SCB anger procent av BNP bara för totalen; per skattetyp räknas andelen som mnkr / BNP.
    // Summakontroll: skattetyperna ska summera till totala skatter (mnkr) och totalen till SCB:s skattekvot.
    for (const y of sorted) {
      const total = get('000000T8', TOTAL, y);
      const totalPct = get('000000SP', TOTAL, y);
      const gdp = get('000000T8', GDP, y);
      if (total === undefined || totalPct === undefined || !gdp) throw new Error(`Totala skatter eller BNP saknas för ${y}`);
      const sum = GROUPS.flatMap((g) => g.codes).reduce((a, c) => a + (get('000000T8', c, y) ?? 0), 0);
      if (Math.abs(sum - total) > total * 0.005) throw new Error(`Skattetyperna ${y}: ${sum} mnkr ≠ totalt ${total} mnkr`);
      if (Math.abs((sum / gdp) * 100 - totalPct) > 0.1) throw new Error(`Skattekvot ${y}: ${(sum / gdp) * 100} % ≠ SCB ${totalPct} %`);
    }
    const last = sorted[sorted.length - 1]!;
    console.log(`  skattekvot ${last}: ${get('000000SP', TOTAL, last)} %`);

    return [
      {
        id: 'skatter-skattekvot',
        title: 'Skattetrycket: skatternas andel av BNP',
        description:
          'Alla obligatoriska skatter och avgifter till staten, kommuner, regioner, pensionssystemet och EU i procent av BNP (skattekvoten), uppdelat på skattetyp.',
        category: 'skatter',
        unit: '% av BNP',
        frequency: 'year',
        source: {
          org: 'SCB',
          name: 'Skattekvot i procent av BNP och skatter efter skattetyp',
          url: scbProductUrl(data),
          apiUrl,
          tableId: TABLE,
          license: SCB_LICENSE,
          updated: data.updated,
        },
        fetchedAt: now(),
        chart: { type: 'stacked-area', yFromZero: true, decimals: 1 },
        notes: [
          'Skattekvoten = obligatoriska skatter och avgifter enligt nationalräkenskaperna (ENS 2010) delat med BNP till marknadspris. Kommunalskatt, arbetsgivaravgifter och egenavgifter ingår – till skillnad från statsbudgetens skatteinkomster, som bara avser staten.',
          'SCB anger andelen av BNP för totalen; andelen per skattetyp är beräknad här som skattetypens belopp (mnkr, löpande priser) delat med BNP. Summan stämmer med SCB:s skattekvot.',
          'Indelningen följer nationalräkenskaperna, inte skattesystemets namn. "Skatter på produktion och import" (D.2) omfattar moms och punktskatter men också lönesummeskatter – den del av arbetsgivaravgifterna som inte ger rätt till förmåner, t.ex. allmän löneavgift – samt skatter som går direkt till EU (tullar). "Sociala avgifter" (D.61C) är bara de obligatoriska avgifter som räknas som avgifter för socialförsäkringen; frivilliga och avtalsenliga avgifter ingår inte.',
          'Premiepensionen och övriga avgiftsbestämda pensioner ligger utanför offentlig förvaltning och ingår inte.',
          'De två senaste åren är preliminära. Kontroll: skattetyperna summerar till totala skatter för varje år.',
        ],
        series: GROUPS.map((g) => ({
          key: g.key,
          label: g.label,
          points: sorted.map((t) => {
            const parts = g.codes.map((c) => get('000000T8', c, t));
            const sum = parts.reduce((a: number, p) => a + (p ?? 0), 0);
            return { t, v: parts.every((p) => p === undefined) ? null : Math.round((sum / get('000000T8', GDP, t)!) * 1000) / 10 };
          }),
        })),
      },
    ];
  },
};
