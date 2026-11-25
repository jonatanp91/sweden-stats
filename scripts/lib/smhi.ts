/**
 * Klient för SMHI:s öppna meteorologiska observationer (metobs).
 * Dokumentation: https://opendata.smhi.se/apidocs/metobs/
 *
 * URL-mönster: /api/version/1.0/parameter/{param}/station/{station}/period/{period}/data.csv
 *  - param 22 = lufttemperatur, månadsmedel
 *  - period `corrected-archive` = kvalitetskontrollerad historik (utom de senaste ~3 månaderna)
 */
import { fetchWithRetry } from './http.ts';

export const SMHI_METOBS = 'https://opendata-download-metobs.smhi.se/api/version/1.0';
export const SMHI_LICENSE = 'CC BY 4.0 (SMHI öppna data)';

export interface SmhiMonthly {
  /** "YYYY-MM" */
  month: string;
  value: number;
  /** G = kontrollerat och godkänt, Y = misstänkt/aggregerat från ej kontrollerade värden. */
  quality: string;
}

export function smhiCsvUrl(parameter: number, station: number, period = 'corrected-archive'): string {
  return `${SMHI_METOBS}/parameter/${parameter}/station/${station}/period/${period}/data.csv`;
}

export async function fetchSmhiCsv(parameter: number, station: number, period = 'corrected-archive') {
  const apiUrl = smhiCsvUrl(parameter, station, period);
  const res = await fetchWithRetry(apiUrl);
  return { text: await res.text(), apiUrl };
}

/**
 * Tolkar SMHI:s CSV för månadsvärden. Filen har ett metadatahuvud; dataraderna börjar efter raden
 * som inleds med "Från Datum Tid". Kolumner: från;till;representativ månad;värde;kvalitet;...
 */
export function parseSmhiMonthlyCsv(text: string): { stationName: string; rows: SmhiMonthly[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const stationName = lines[1]?.split(';')[0]?.trim() ?? '';
  const start = lines.findIndex((l) => l.startsWith('Från Datum Tid'));
  if (start < 0) throw new Error('Kunde inte hitta datahuvudet i SMHI-filen');
  const rows: SmhiMonthly[] = [];
  for (const line of lines.slice(start + 1)) {
    const cols = line.split(';');
    const month = cols[2]?.trim();
    const raw = cols[3]?.trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !raw) continue;
    const value = Number(raw);
    if (Number.isNaN(value)) continue;
    rows.push({ month, value, quality: cols[4]?.trim() ?? '' });
  }
  return { stationName, rows };
}

/** Årsmedel av månadsmedel – endast år med alla 12 månader. */
export function annualMeans(rows: SmhiMonthly[]): { year: string; value: number }[] {
  const byYear = new Map<string, number[]>();
  for (const r of rows) {
    const y = r.month.slice(0, 4);
    const arr = byYear.get(y) ?? [];
    arr.push(r.value);
    byYear.set(y, arr);
  }
  return [...byYear.entries()]
    .filter(([, v]) => v.length === 12)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, v]) => ({ year, value: Math.round((v.reduce((a, b) => a + b, 0) / 12) * 100) / 100 }));
}

/** Bakåtblickande glidande medelvärde över `window` sammanhängande år (null tills fönstret är fullt). */
export function trailingMean(values: { t: string; v: number }[], window: number): { t: string; v: number | null }[] {
  return values.map((p, i) => {
    if (i + 1 < window) return { t: p.t, v: null };
    // Kräver att fönstret består av sammanhängande år
    const slice = values.slice(i + 1 - window, i + 1);
    const contiguous = Number(slice[slice.length - 1]!.t) - Number(slice[0]!.t) === window - 1;
    if (!contiguous) return { t: p.t, v: null };
    return { t: p.t, v: Math.round((slice.reduce((a, b) => a + b.v, 0) / window) * 100) / 100 };
  });
}
