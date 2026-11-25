/** Hjälpfunktioner för tidsserier – delas av diagram, nyckeltal och tabeller. */
import type { Dataset, Series } from './types';

/** Nästa period efter t, för år ("2024"), månad ("2024-03") och kvartal ("2024K1"). */
function nextPeriod(t: string): string | null {
  if (/^\d{4}$/.test(t)) return String(Number(t) + 1);
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  const q = /^(\d{4})K([1-4])$/.exec(t);
  if (q) {
    const y = Number(q[1]);
    const k = Number(q[2]);
    return k === 4 ? `${y + 1}K1` : `${y}K${k + 1}`;
  }
  return null;
}

/**
 * Alla perioder som förekommer i någon serie, sorterade och med luckor ifyllda,
 * så att en kategoriaxel inte drar ihop t.ex. 1772 och 1859 bredvid varandra.
 */
export function periodAxis(series: Series[]): string[] {
  const set = new Set<string>();
  for (const s of series) for (const p of s.points) set.add(p.t);
  const sorted = [...set].sort();
  if (sorted.length < 2) return sorted;
  const out: string[] = [];
  let cur: string | null = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  let guard = 0;
  while (cur && cur <= last && guard++ < 100_000) {
    out.push(cur);
    cur = nextPeriod(cur);
  }
  // Okänt periodformat → använd bara de faktiska perioderna
  return cur === null ? sorted : out;
}

/** Värden för en serie utlagda på en gemensam axel (null där värde saknas). */
export function alignSeries(s: Series, axis: string[]): (number | null)[] {
  const m = new Map(s.points.map((p) => [p.t, p.v]));
  return axis.map((t) => m.get(t) ?? null);
}

/** Senaste punkten med värde. */
export function latestPoint(s: Series): { t: string; v: number } | null {
  for (let i = s.points.length - 1; i >= 0; i--) {
    const p = s.points[i]!;
    if (p.v !== null) return { t: p.t, v: p.v };
  }
  return null;
}

export function valueAt(s: Series, t: string): number | null {
  return s.points.find((p) => p.t === t)?.v ?? null;
}

/** Summa av alla serier per period (för staplade diagram). */
export function totalSeries(ds: Dataset): Series {
  const axis = periodAxis(ds.series);
  const aligned = ds.series.map((s) => alignSeries(s, axis));
  return {
    key: 'total',
    label: 'Totalt',
    points: axis
      .map((t, i) => {
        const vals = aligned.map((a) => a[i]);
        const v = vals.every((x) => x === null) ? null : vals.reduce<number>((acc, x) => acc + (x ?? 0), 0);
        return { t, v };
      })
      .filter((p) => p.v !== null),
  };
}

export function getSeries(ds: Dataset, key: string): Series {
  if (key === 'total') return totalSeries(ds);
  const s = ds.series.find((x) => x.key === key);
  if (!s) throw new Error(`Serie "${key}" saknas i ${ds.id}`);
  return s;
}

export function isStacked(ds: Dataset): boolean {
  return ds.chart.type === 'stacked-bar' || ds.chart.type === 'stacked-area';
}
