/**
 * Klient för SCB:s PxWebApi 2 (https://statistikdatabasen.scb.se/api/v2/).
 * Svar hämtas som JSON-stat 2.0 och plattas ut till poster.
 *
 * Kända gränser (se docs/datakallor.md):
 *  - max ~150 000 celler per anrop
 *  - max 30 anrop per 10 sekunder per IP
 */
import { fetchWithRetry } from './http.ts';

export const SCB_API = 'https://statistikdatabasen.scb.se/api/v2';
export const SCB_LICENSE = 'CC0 1.0 (SCB öppna data)';

/** Urval per variabel: lista med värdekoder eller '*' för alla. */
export type PxSelection = Record<string, string[] | '*'>;

export interface JsonStat2 {
  version: string;
  class: 'dataset';
  label: string;
  source?: string;
  updated?: string;
  note?: string[];
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label: string;
      category: {
        index: Record<string, number> | string[];
        label?: Record<string, string>;
        unit?: Record<string, { base?: string; decimals?: number }>;
      };
    }
  >;
  value: (number | null)[] | Record<string, number | null>;
  status?: Record<string, string> | string[];
  extension?: { px?: { infofile?: string; tableid?: string } };
}

export interface PxRecord {
  /** Värdekod per dimension, t.ex. { Kon: '1+2', Tid: '2024' }. */
  codes: Record<string, string>;
  /** Etikett per dimension. */
  labels: Record<string, string>;
  value: number | null;
}

export function buildDataUrl(tableId: string, selection: PxSelection, lang = 'sv'): string {
  const params = [`lang=${lang}`, 'outputFormat=json-stat2'];
  for (const [variable, codes] of Object.entries(selection)) {
    const v = codes === '*' ? '*' : codes.join(',');
    params.push(`valueCodes[${encodeURIComponent(variable)}]=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%2A/g, '*')}`);
  }
  return `${SCB_API}/tables/${tableId}/data?${params.join('&')}`;
}

export async function fetchPxTable(tableId: string, selection: PxSelection): Promise<{ data: JsonStat2; apiUrl: string }> {
  const apiUrl = buildDataUrl(tableId, selection);
  const res = await fetchWithRetry(apiUrl);
  const data = (await res.json()) as JsonStat2;
  if (data.class !== 'dataset') throw new Error(`Oväntat svar från SCB för ${tableId}`);
  return { data, apiUrl };
}

/** Hämtar tabellens metadata (variabler, värdekoder och etiketter) som JSON-stat 2. */
export async function fetchPxMetadata(tableId: string): Promise<JsonStat2> {
  const res = await fetchWithRetry(`${SCB_API}/tables/${tableId}/metadata?lang=sv`);
  return (await res.json()) as JsonStat2;
}

/** Värdekoder → etiketter för en variabel i en JSON-stat-tabell, i tabellens ordning. */
export function dimensionLabels(js: JsonStat2, dim: string): { code: string; label: string }[] {
  const cat = js.dimension[dim]?.category;
  if (!cat) throw new Error(`Variabeln ${dim} saknas`);
  return categoryKeys(cat.index).map((code) => ({ code, label: cat.label?.[code] ?? code }));
}

/**
 * Indexerar poster för snabb uppslagning: get(kod1, kod2, …) i ordningen `dims`.
 * Ex: const get = indexRecords(records, ['Region', 'Tid']); get('0180', '2024')
 */
export function indexRecords(records: PxRecord[], dims: string[]): (...codes: string[]) => number | null {
  const m = new Map<string, number | null>();
  for (const r of records) m.set(dims.map((d) => r.codes[d]).join('|'), r.value);
  return (...codes) => m.get(codes.join('|')) ?? null;
}

function categoryKeys(index: Record<string, number> | string[]): string[] {
  if (Array.isArray(index)) return index;
  return Object.entries(index)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);
}

/** Plattar ut JSON-stat 2 (radmajor-ordning enligt `id`/`size`) till en lista poster. */
export function jsonStatToRecords(js: JsonStat2): PxRecord[] {
  const dims = js.id.map((id) => {
    const cat = js.dimension[id]!.category;
    const keys = categoryKeys(cat.index);
    return { id, keys, labels: cat.label ?? {} };
  });
  const total = js.size.reduce((a, b) => a * b, 1);
  const values = js.value;
  const getValue = (i: number): number | null => {
    const v = Array.isArray(values) ? values[i] : values[String(i)];
    return v === undefined || v === null ? null : v;
  };

  const out: PxRecord[] = [];
  for (let i = 0; i < total; i++) {
    let rest = i;
    const codes: Record<string, string> = {};
    const labels: Record<string, string> = {};
    for (let d = dims.length - 1; d >= 0; d--) {
      const dim = dims[d]!;
      const size = js.size[d]!;
      const k = dim.keys[rest % size]!;
      rest = Math.floor(rest / size);
      codes[dim.id] = k;
      labels[dim.id] = dim.labels[k] ?? k;
    }
    out.push({ codes, labels, value: getValue(i) });
  }
  return out;
}

/** SCB:s tidskoder → sajtens format: "2024M03" → "2024-03", "2024K1" och "2024" oförändrade. */
export function normalizePeriod(code: string): string {
  const m = /^(\d{4})M(\d{2})$/.exec(code);
  return m ? `${m[1]}-${m[2]}` : code;
}

/** Publik länk till statistikproduktens sida hos SCB, t.ex. https://www.scb.se/BE0101/. */
export function scbProductUrl(js: JsonStat2, fallback = 'https://www.statistikdatabasen.scb.se/'): string {
  const info = js.extension?.px?.infofile;
  return info ? `https://www.scb.se/${info}/` : fallback;
}
