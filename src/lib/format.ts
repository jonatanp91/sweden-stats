/** Formatering enligt svensk standard (mellanslag som tusentalsavgränsare, komma som decimaltecken). */

const cache = new Map<string, Intl.NumberFormat>();
function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = JSON.stringify(opts);
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('sv-SE', opts);
    cache.set(k, f);
  }
  return f;
}

export function formatNumber(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return nf({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

/** Kompakt format för axlar och nyckeltal: 10 tn, 1,2 mn, 3,4 md. */
export function formatCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  const a = Math.abs(v);
  if (a < 10_000) return formatNumber(v, a < 10 && a % 1 !== 0 ? 1 : 0);
  if (a < 1_000_000) return `${formatNumber(v / 1000, a < 100_000 ? 1 : 0)} tn`;
  if (a < 1_000_000_000) return `${formatNumber(v / 1_000_000, a < 100_000_000 ? 2 : 0)} mn`;
  return `${formatNumber(v / 1_000_000_000, 1)} md`;
}

/**
 * Formatterare för en diagramaxel: samma stil för alla ticks, vald utifrån axelns största värde.
 * Under 10 000 skrivs talen ut i sin helhet; däröver kompakt (tn/mn/md) med samma enhet på hela axeln.
 */
export function axisFormatter(maxAbs: number, maxDecimals = 1): (v: number) => string {
  const scales: [number, string][] = [
    [1e9, ' md'],
    [1e6, ' mn'],
    [1e3, ' tn'],
  ];
  const scale = maxAbs >= 10_000 ? scales.find(([d]) => maxAbs >= d) : undefined;
  if (!scale) return (v) => nf({ minimumFractionDigits: 0, maximumFractionDigits: maxDecimals }).format(v);
  const [div, suffix] = scale;
  return (v) => (v === 0 ? '0' : `${nf({ minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(v / div)}${suffix}`);
}

/** Belopp i miljoner kronor → "52,3 mdkr", "830 mnkr", "4,2 mnkr". */
export function formatMnkr(mnkr: number | null | undefined): string {
  if (mnkr === null || mnkr === undefined || Number.isNaN(mnkr)) return '–';
  const a = Math.abs(mnkr);
  if (a >= 1000) return `${formatNumber(mnkr / 1000, a >= 100_000 ? 0 : 1)} mdkr`;
  return `${formatNumber(mnkr, a < 10 ? 1 : 0)} mnkr`;
}

/** Värde + enhet för ett mått: "30,55 %", "76 752 kr", "1 234 mnkr" (mnkr formateras som formatMnkr). */
export function formatWithUnit(v: number | null | undefined, unit: string, decimals = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  if (unit === 'mnkr') return formatMnkr(v);
  if (unit === '%') return `${formatNumber(v, decimals)} %`;
  return `${formatNumber(v, decimals)} ${unit}`;
}

export function formatSigned(v: number, decimals = 0): string {
  const s = formatNumber(Math.abs(v), decimals);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "2024" → "2024", "2024-03" → "mar 2024", "2024K1" → "kv1 2024". */
export function formatPeriod(t: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(t);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const q = /^(\d{4})K([1-4])$/.exec(t);
  if (q) return `kv${q[2]} ${q[1]}`;
  return t;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
}
