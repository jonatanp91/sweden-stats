/**
 * Gemensam kod för diagramöarna (Chart, RegionMap, FlowSankey): tema från CSS-variabler,
 * tooltip-stil och CSV-nedladdning.
 */
import { useEffect, useState } from 'react';

export interface Theme {
  surface: string;
  textPrimary: string;
  textSecondary: string;
  axisLabel: string;
  grid: string;
  baseline: string;
  border: string;
  series: string[];
  muted: string;
  seqLow: string;
  seqHigh: string;
  divNeg: string;
  divMid: string;
  divPos: string;
  flowCenter: string;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    surface: v('--surface'),
    textPrimary: v('--text-primary'),
    textSecondary: v('--text-secondary'),
    axisLabel: v('--axis-label'),
    grid: v('--grid'),
    baseline: v('--baseline'),
    border: v('--border'),
    series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`)),
    muted: v('--series-muted'),
    seqLow: v('--seq-low'),
    seqHigh: v('--seq-high'),
    divNeg: v('--div-neg'),
    divMid: v('--div-mid'),
    divPos: v('--div-pos'),
    flowCenter: v('--flow-center'),
  };
}

/** Följer sajtens tema (data-theme på <html>) och operativsystemets inställning. */
export function useTheme(): Theme | null {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Gemensam tooltip-stil för ECharts. */
export function tooltipStyle(theme: Theme) {
  return {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: theme.textPrimary, fontSize: 13, fontFamily: FONT },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px; max-width: 320px; white-space: normal;',
  };
}

/** HTML-rad i tooltip: färgruta + etikett till vänster, värde till höger. */
export function tooltipRow(theme: Theme, label: string, value: string, color?: string, strong = false): string {
  const swatch = color
    ? `<span style="width:10px;height:10px;border-radius:3px;background:${color};flex:none"></span>`
    : '';
  return (
    `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center${strong ? ';font-weight:600' : ''}">` +
    `<span style="display:inline-flex;align-items:center;gap:6px;color:${theme.textSecondary}">${swatch}${label}</span>` +
    `<span style="font-variant-numeric:tabular-nums;font-weight:${strong ? 600 : 500};white-space:nowrap">${value}</span></div>`
  );
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Laddar ner en semikolonseparerad CSV (Excel-vänlig, svensk decimalkomma). */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][], sourceLine: string) {
  const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (c: string | number | null) =>
    c === null ? '' : typeof c === 'number' ? String(c).replace('.', ',') : esc(c);
  const text = `﻿# ${sourceLine}\n${header.map(esc).join(';')}\n${rows.map((r) => r.map(cell).join(';')).join('\n')}\n`;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Hämtar JSON med enkel cache per URL. */
const jsonCache = new Map<string, Promise<unknown>>();
export function fetchJson<T>(url: string): Promise<T> {
  let p = jsonCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} för ${url}`);
      return r.json();
    });
    p.catch(() => jsonCache.delete(url));
    jsonCache.set(url, p);
  }
  return p as Promise<T>;
}

/** Händelse för att välja en enhet (kommun/region) i ett annat diagram, t.ex. från kartan till Sankey. */
export const SELECT_ENTITY_EVENT = 'sverige:select-entity';
export interface SelectEntityDetail {
  param: string;
  code: string;
  year?: string;
}

/** Läser en URL-parameter (tom vid fel). */
export function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** Skriver URL-parametrar utan att ladda om sidan (för delbara länkar). */
export function writeParams(params: Record<string, string>) {
  try {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    window.history.replaceState(null, '', u);
  } catch {
    /* ignorera */
  }
}

/** Sant på pekskärmar utan hovring (telefoner/surfplattor) – där görs diagram statiska så att sidan går att scrolla. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    } catch {
      return;
    }
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return coarse;
}
