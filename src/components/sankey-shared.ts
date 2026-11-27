/**
 * Gemensam Sankey-logik för FlowSankey (kommun/region/staten) och TaxSankey (skattekalkylatorn).
 *
 * Kolumner: vänsterlöv → (vänstergrupp) → centrum → (högergrupp) → högerlöv. En gruppnod (`role: 'group'`)
 * har inget eget belopp – det är summan av noderna som pekar på den med `parent`. Löv utan grupp placeras i
 * yttersta kolumnen (länken hoppar då över gruppkolumnen).
 *
 * Utan mittnod: om någon utflödesnod har `from` (källa → belopp) går länkarna direkt från källorna till
 * mottagarna (kalkylatorn: bruttolön och arbetsgivaravgifter var för sig). Då ritas inget centrum.
 */
import type { EChartsCoreOption } from 'echarts/core';
import { formatNumber } from '../lib/format';
import { escapeHtml, FONT, tooltipRow, tooltipStyle, type Theme } from './chart-shared';

export const CENTER = '__center';

export interface SankeyItem {
  id: string;
  label: string;
  side: 'in' | 'out';
  role?: 'balance' | 'group';
  parent?: string;
  description?: string;
  value: number;
  /** Utan mittnod: inflödesnod-id → belopp som går direkt till denna mottagare. */
  from?: Record<string, number>;
}

export const pct = (v: number, total: number) =>
  total > 0 ? `${formatNumber((v / total) * 100, v / total < 0.01 ? 1 : 0)} %` : '–';

/** Mäter etiketternas bredd (px) så att marginalerna räcker utan att text klipps. */
let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, size: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}

/**
 * Lägger till gruppnodernas belopp (summan av barnen), tar bort tomma noder och sorterar så att barnen
 * ligger i samma ordning som sina grupper (färre korsande länkar).
 */
export function withGroups(items: SankeyItem[]): SankeyItem[] {
  const groupSum = new Map<string, number>();
  for (const it of items) if (it.parent && it.value > 0) groupSum.set(it.parent, (groupSum.get(it.parent) ?? 0) + it.value);
  const filled = items
    .map((it) => (it.role === 'group' ? { ...it, value: groupSum.get(it.id) ?? 0 } : it))
    .filter((it) => it.value > 0);
  const groupOrder = new Map(filled.filter((g) => g.role === 'group').map((g, i) => [g.id, i]));
  const rank = (it: SankeyItem) =>
    it.role === 'group' ? (groupOrder.get(it.id) ?? 0) : it.parent ? (groupOrder.get(it.parent) ?? 0) : groupOrder.size;
  // Stabil sortering: inom samma grupp behålls ursprunglig ordning
  return filled.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it);
}

export interface SankeyLayout {
  items: SankeyItem[];
  total: number;
  hasGroups: boolean;
  /** Antal noder i den högsta kolumnen – styr diagrammets höjd. */
  maxColumn: number;
}

export function layoutItems(rawItems: SankeyItem[]): SankeyLayout {
  const items = withGroups(rawItems);
  const total = items.filter((i) => i.side === 'in' && !i.parent).reduce((a, i) => a + i.value, 0);
  const hasGroups = items.some((i) => i.role === 'group');
  const col = (side: 'in' | 'out', leaf: boolean) => items.filter((i) => i.side === side && (i.role === 'group') !== leaf).length;
  const maxColumn = Math.max(col('in', true), col('out', true), col('in', false), col('out', false), 1);
  return { items, total, hasGroups, maxColumn };
}

export interface SankeyOptions {
  title: string;
  layout: SankeyLayout;
  theme: Theme;
  narrow: boolean;
  /** Formaterar ett belopp, t.ex. formatMnkr eller "12 345 kr". */
  fmt: (v: number) => string;
  /** Extra text per belopp, t.ex. "5 012 kr/inv" (null = utelämnas). */
  extra?: (v: number) => string | null;
  /** Etiketter i tooltip: andel av totalen för in- resp. utflöden. */
  shareLabels?: { in: string; out: string };
  /** Färg per nod (standard: inflöden serie 1, utflöden serie 2, saldo nedtonat). */
  colorOf?: (it: SankeyItem, theme: Theme) => string;
  /** false = statiskt diagram (ingen tooltip/markering, släpper pekgester) – används på pekskärmar. */
  interactive?: boolean;
  /** Brett diagram (≥ WIDE_PX): etiketterna får plats på en rad även med grupper. */
  wide?: boolean;
}

/** Diagrambredd (px) från vilken etiketterna i diagram med grupper ritas på en rad. */
export const WIDE_PX = 1300;

const defaultColor = (it: SankeyItem, theme: Theme) =>
  it.role === 'balance' ? theme.muted : it.side === 'in' ? theme.series[0]! : theme.series[1]!;

export function buildSankeyOption(o: SankeyOptions): EChartsCoreOption {
  const { layout, theme, fmt, extra } = o;
  const { items, total } = layout;
  // Med grupper (fyra kolumner) blir etiketterna tvåradiga så att kolumnerna får plats
  const stacked = o.narrow || (layout.hasGroups && !o.wide);
  const colorOf = (it: SankeyItem) => (o.colorOf ?? defaultColor)(it, theme);
  const byId = new Map(items.map((i) => [i.id, i]));
  const size = o.narrow ? 11 : 12;
  const inGroups = items.some((i) => i.side === 'in' && i.role === 'group');
  const outGroups = items.some((i) => i.side === 'out' && i.role === 'group');
  // Utan mittnod går länkarna direkt från källorna till mottagarna
  const direct = items.some((i) => i.from);
  const center = direct ? 0 : inGroups ? 2 : 1;
  const last = center + (outGroups ? 2 : 1);
  const depthOf = (it: SankeyItem) => {
    if (it.side === 'in') return it.role === 'group' ? 1 : 0;
    if (it.role === 'group') return center + 1;
    return last;
  };

  const valueText = (v: number) => {
    const e = extra?.(v);
    return `${fmt(v)} · ${pct(v, total)}${e ? ` · ${e}` : ''}`;
  };
  const rich = {
    name: { color: theme.textPrimary, fontSize: size, fontFamily: FONT },
    gname: { color: theme.textPrimary, fontSize: size, fontWeight: 600, fontFamily: FONT },
    val: { color: theme.textSecondary, fontSize: size, fontFamily: FONT },
    title: { color: theme.textPrimary, fontSize: 13, fontWeight: 600, fontFamily: FONT },
  };
  const leafLabel = (it: SankeyItem) =>
    stacked ? `{name|${it.label}}\n{val|${valueText(it.value)}}` : `{name|${it.label}}  {val|${valueText(it.value)}}`;
  // Gruppetiketter ligger i luckan mot centrum (över länkarna) och får därför en bakgrund
  const groupLabel = (it: SankeyItem) => ({
    position: it.side === 'in' ? 'right' : 'left',
    formatter: `{gname|${it.label}}\n{val|${fmt(it.value)} · ${pct(it.value, total)}}`,
    rich,
    backgroundColor: theme.surface,
    borderRadius: 4,
    padding: [3, 6],
    opacity: 0.94,
    lineHeight: 16,
  });

  const nodes = [
    ...items.map((it) => ({
      name: it.id,
      depth: depthOf(it),
      itemStyle: { color: colorOf(it), borderWidth: 0 },
      label:
        it.role === 'group'
          ? groupLabel(it)
          : { position: it.side === 'in' ? 'left' : 'right', formatter: leafLabel(it), rich, lineHeight: size + 4 },
    })),
    ...(direct
      ? []
      : [
          {
            name: CENTER,
            depth: center,
            itemStyle: { color: theme.flowCenter, borderWidth: 0 },
            label: { position: 'top', formatter: `{title|${o.title}}\n{val|${fmt(total)}}`, rich, align: 'center', lineHeight: 16 },
          },
        ]),
  ];
  const links = direct
    ? items.flatMap((it) => {
        if (it.side === 'out' && it.parent && byId.has(it.parent)) {
          return [{ source: it.parent, target: it.id, value: it.value, lineStyle: { color: colorOf(it) } }];
        }
        // Källa → mottagare, färgad efter mottagaren så att källans fördelning syns
        return Object.entries(it.from ?? {})
          .filter(([src, v]) => v > 0 && byId.has(src))
          .map(([src, v]) => ({ source: src, target: it.id, value: v, lineStyle: { color: colorOf(it) } }));
      })
    : items.map((it) => {
        const other = it.parent && byId.has(it.parent) ? it.parent : CENTER;
        const [source, target] = it.side === 'in' ? [it.id, other] : [other, it.id];
        return { source, target, value: it.value, lineStyle: { color: colorOf(it) } };
      });

  const leafWidth = (side: 'in' | 'out') =>
    Math.ceil(
      items
        .filter((i) => i.side === side && i.role !== 'group')
        .reduce((max, it) => {
          const name = textWidth(it.label, size);
          const val = textWidth(valueText(it.value), size);
          return Math.max(max, stacked ? Math.max(name, val) : name + 8 + val);
        }, 60),
    );

  const shareLabels = o.shareLabels ?? { in: 'Andel av inflödet', out: 'Andel av utflödet' };
  const describe = (it: SankeyItem, v: number) => {
    const parent = it.parent ? byId.get(it.parent) : undefined;
    const e = extra?.(v);
    return (
      `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(it.label)}</div>` +
      tooltipRow(theme, 'Belopp', fmt(v)) +
      tooltipRow(theme, it.side === 'in' ? shareLabels.in : shareLabels.out, pct(v, total)) +
      (parent ? tooltipRow(theme, `Andel av ${parent.label.toLowerCase()}`, pct(v, parent.value)) : '') +
      (e ? tooltipRow(theme, 'Per invånare', e.replace(/\/inv$/, '')) : '') +
      (it.description ? `<div style="color:${theme.axisLabel};font-size:12px;margin-top:4px">${escapeHtml(it.description)}</div>` : '')
    );
  };

  // Länk direkt från en källa till en mottagare
  const describeDirect = (src: SankeyItem, dst: SankeyItem, v: number) =>
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(src.label)} → ${escapeHtml(dst.label)}</div>` +
    tooltipRow(theme, 'Belopp', fmt(v)) +
    tooltipRow(theme, `Andel av ${src.label.toLowerCase()}`, pct(v, src.value)) +
    tooltipRow(theme, `Andel av ${dst.label.toLowerCase()}`, pct(v, dst.value)) +
    (dst.description ? `<div style="color:${theme.axisLabel};font-size:12px;margin-top:4px">${escapeHtml(dst.description)}</div>` : '');

  const interactive = o.interactive !== false;
  return {
    textStyle: { fontFamily: FONT },
    tooltip: {
      show: interactive,
      trigger: 'item',
      ...tooltipStyle(theme),
      formatter: (p: { dataType: string; name: string; data: { source?: string; target?: string }; value: number }) => {
        if (p.dataType === 'edge' && direct) {
          const src = byId.get(p.data.source!);
          const dst = byId.get(p.data.target!);
          if (src && dst && src.side === 'in' && dst.side === 'out') return describeDirect(src, dst, p.value);
          return dst ? describe(dst, p.value) : '';
        }
        if (p.dataType === 'edge') {
          // Länken beskriver noden längst från centrum
          const src = byId.get(p.data.source!);
          const id = src && src.side === 'in' ? p.data.source! : p.data.target!;
          const it = byId.get(id);
          return it ? describe(it, p.value) : '';
        }
        if (p.name === CENTER) {
          return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(o.title)}</div>${tooltipRow(theme, 'Totalt', fmt(total))}`;
        }
        const it = byId.get(p.name);
        return it ? describe(it, p.value) : '';
      },
    },
    series: [
      {
        type: 'sankey',
        left: leafWidth('in') + 12,
        right: leafWidth('out') + 12,
        top: direct ? 16 : 44,
        bottom: 8,
        nodeWidth: 14,
        nodeGap: stacked ? 24 : 16,
        nodeAlign: 'justify',
        layoutIterations: 0,
        draggable: false,
        silent: !interactive,
        emphasis: interactive ? { focus: 'adjacency' } : { disabled: true },
        lineStyle: { opacity: 0.3, curveness: 0.5 },
        data: nodes,
        links,
      },
    ],
  };
}

/** Diagramhöjd och minsta bredd för en layout. */
export function sankeySize(layout: SankeyLayout, narrow: boolean, wide = false) {
  const stacked = narrow || (layout.hasGroups && !wide);
  return {
    height: Math.max(440, layout.maxColumn * (stacked ? 54 : 44) + 60),
    minWidth: layout.hasGroups ? 960 : 720,
  };
}
