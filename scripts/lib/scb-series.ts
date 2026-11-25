/**
 * Årsserier från SCB som flera hämtare behöver (staten, statsskuld): folkmängd i riket, BNP och statsskuld.
 * Varje funktion returnerar år → värde samt källan (för spårbarhet i datasetet).
 */
import type { Source } from '../../src/lib/types.ts';
import { fetchPxTable, jsonStatToRecords, scbProductUrl, SCB_LICENSE, type JsonStat2 } from './pxweb.ts';

export interface YearSeries {
  values: Map<string, number>;
  source: Source;
}

function scbSource(js: JsonStat2, apiUrl: string, tableId: string, name: string, producer?: string): Source {
  return { org: 'SCB', producer, name, url: scbProductUrl(js), apiUrl, tableId, license: SCB_LICENSE, updated: js.updated };
}

function toMap(js: JsonStat2, keyOf: (codes: Record<string, string>) => string | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of jsonStatToRecords(js)) {
    const k = keyOf(r.codes);
    if (k !== null && r.value !== null) m.set(k, r.value);
  }
  return m;
}

/** Folkmängd i riket 31 december (TAB4365, BE0101). */
export async function fetchPopulationRiket(): Promise<YearSeries> {
  const { data, apiUrl } = await fetchPxTable('TAB4365', { Kon: ['1+2'], ContentsCode: ['000000LV'], Tid: '*' });
  return { values: toMap(data, (c) => c.Tid!), source: scbSource(data, apiUrl, 'TAB4365', 'Befolkningsutveckling i riket') };
}

/** BNP till marknadspris, löpande priser, mnkr (TAB121 – samma tabell som skattekvoten; har senaste året). */
export async function fetchGdp(): Promise<YearSeries> {
  const { data, apiUrl } = await fetchPxTable('TAB121', { Skattetyp: ['101'], ContentsCode: ['000000T8'], Tid: '*' });
  const unit = Object.values(data.dimension.ContentsCode?.category.unit ?? {})[0]?.base;
  if (unit && unit !== 'mnkr') throw new Error(`Oväntad enhet för BNP i TAB121: ${unit}`);
  return {
    values: toMap(data, (c) => c.Tid!),
    source: scbSource(data, apiUrl, 'TAB121', 'BNP till marknadspris (skattekvot och BNP)'),
  };
}

/** Statsskulden vid årets slut (december), mnkr (TAB6378, Riksgälden). */
export async function fetchDebtDecember(): Promise<YearSeries> {
  const { data, apiUrl } = await fetchPxTable('TAB6378', { Marknad: ['SSTot'], ContentsCode: ['000007J7'], Tid: '*' });
  const unit = Object.values(data.dimension.ContentsCode?.category.unit ?? {})[0]?.base;
  if (unit !== 'mkr') throw new Error(`Oväntad enhet för statsskulden: ${unit}`);
  return {
    values: toMap(data, (c) => (c.Tid!.endsWith('M12') ? c.Tid!.slice(0, 4) : null)),
    source: scbSource(data, apiUrl, 'TAB6378', 'Statsskulden fördelad på marknader', 'Riksgälden'),
  };
}

/** Offentlig förvaltnings konsoliderade bruttoskuld (Maastrichtskulden), mnkr (TAB5050). */
export async function fetchMaastrichtDebt(): Promise<YearSeries> {
  const { data, apiUrl } = await fetchPxTable('TAB5050', {
    Sektor: ['S13'],
    Kontopost: ['FL01N'],
    ContentsCode: ['000002KK'],
    Tid: '*',
  });
  const unit = Object.values(data.dimension.ContentsCode?.category.unit ?? {})[0]?.base;
  if (unit && !/^m(n)?kr$/.test(unit)) throw new Error(`Oväntad enhet för Maastrichtskulden: ${unit}`);
  return {
    values: toMap(data, (c) => c.Tid!),
    source: scbSource(data, apiUrl, 'TAB5050', 'Offentlig förvaltnings konsoliderade bruttoskuld (Maastrichtskuld)'),
  };
}

/** Genomsnittlig kommunal skattesats i riket: andel som går till kommunerna (TAB2015 F2 / F1). */
export async function fetchMunicipalTaxShare(): Promise<YearSeries> {
  const { data, apiUrl } = await fetchPxTable('TAB2015', { ContentsCode: ['OE0101F2', 'OE0101F3'], Tid: '*' });
  const kommun = toMap(data, (c) => (c.ContentsCode === 'OE0101F2' ? c.Tid! : null));
  const region = toMap(data, (c) => (c.ContentsCode === 'OE0101F3' ? c.Tid! : null));
  const values = new Map<string, number>();
  for (const [y, k] of kommun) {
    const r = region.get(y);
    if (r !== undefined && k + r > 0) values.set(y, k / (k + r));
  }
  return { values, source: scbSource(data, apiUrl, 'TAB2015', 'Kommunalskatteuppgifter, riket') };
}
