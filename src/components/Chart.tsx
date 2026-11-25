/**
 * Interaktivt diagram (React-ö). Tar ett helt Dataset och ritar det med ECharts.
 * Färger läses från CSS-variablerna i global.css så att ljust/mörkt läge följer sajtens tema.
 * Innehåller även tabellvy och CSV-nedladdning (tillgänglighet + öppenhet).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { Dataset } from '../lib/types';
import { alignSeries, isStacked, periodAxis } from '../lib/series';
import { axisFormatter, formatNumber, formatPeriod } from '../lib/format';
import { useTheme, type Theme } from './chart-shared';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, SVGRenderer]);

function buildOption(ds: Dataset, axis: string[], theme: Theme, narrow: boolean): EChartsCoreOption {
  const { type } = ds.chart;
  const stacked = isStacked(ds);
  const bar = type === 'bar' || type === 'stacked-bar';
  const decimals = ds.chart.decimals ?? 0;
  const yFromZero = ds.chart.yFromZero ?? (bar || stacked || type === 'area');
  const multi = ds.series.length > 1;
  const long = axis.length > 60;
  const isMonthly = ds.frequency === 'month';

  // Kategoriska färger tilldelas i fast ordning efter seriens position (aldrig cyklat).
  let colorIndex = 0;
  const colors = ds.series.map((s) => (s.role === 'muted' ? theme.muted : theme.series[colorIndex++ % 8]!));
  const lastIndex = ds.series.length - 1;

  const series = ds.series.map((s, i) => {
    const data = alignSeries(s, axis);
    const color = colors[i]!;
    if (bar) {
      return {
        type: 'bar',
        name: s.label,
        data,
        stack: stacked ? 'total' : undefined,
        barMaxWidth: 24,
        itemStyle: {
          color,
          // 1px kant i ytfärg på varje sida → 2px mellanrum mellan staplade segment och intilliggande staplar
          borderColor: theme.surface,
          borderWidth: axis.length > 50 ? 0.5 : 1,
          // 4px rundning endast på stapelns topp (översta segmentet), rak mot baslinjen
          borderRadius: !stacked || i === lastIndex ? [4, 4, 0, 0] : 0,
        },
        emphasis: { focus: 'series' },
      };
    }
    const muted = s.role === 'muted';
    return {
      type: 'line',
      name: s.label,
      data,
      stack: stacked ? 'total' : undefined,
      showSymbol: false,
      symbolSize: 8,
      connectNulls: false,
      lineStyle: {
        width: stacked ? 1 : muted ? 1.25 : 2,
        color: stacked ? theme.surface : color,
        cap: 'round',
        join: 'round',
      },
      itemStyle: { color, borderColor: theme.surface, borderWidth: 2 },
      areaStyle:
        type === 'area' ? { color, opacity: 0.1 } : stacked ? { color, opacity: 0.85 } : undefined,
      emphasis: { focus: stacked ? 'series' : 'none' },
      z: muted ? 1 : 2,
    };
  });

  // Största absoluta värde på axeln (staplat: största summan per period) styr axelns talformat
  const alignedAll = ds.series.map((s) => alignSeries(s, axis));
  const maxAbs = Math.max(
    0,
    ...axis.map((_, i) =>
      stacked
        ? alignedAll.reduce((a, col) => a + Math.abs(col[i] ?? 0), 0)
        : Math.max(0, ...alignedAll.map((col) => Math.abs(col[i] ?? 0))),
    ),
  );

  const fmtValue = (v: number | null) => (v === null || v === undefined ? '–' : formatNumber(v, decimals));

  return {
    animationDuration: 400,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    color: colors,
    grid: {
      left: 8,
      right: 16,
      top: multi ? (narrow ? 76 : 48) : 16,
      bottom: long ? 64 : 8,
      containLabel: true,
    },
    legend: multi
      ? {
          type: 'plain',
          top: 0,
          left: 0,
          icon: 'roundRect',
          itemWidth: 12,
          itemHeight: 12,
          itemGap: 16,
          textStyle: { color: theme.textSecondary, fontSize: 13 },
        }
      : undefined,
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: bar ? 'shadow' : 'line', lineStyle: { color: theme.baseline }, shadowStyle: { color: theme.grid, opacity: 0.4 } },
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: theme.textPrimary, fontSize: 13 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.12); border-radius: 8px;',
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          axisValue: string;
          seriesName: string;
          value: number | null;
          color: string;
        }[];
        if (!ps.length) return '';
        const head = `<div style="font-weight:600;margin-bottom:4px">${formatPeriod(ps[0]!.axisValue)}</div>`;
        // Staplade serier listas uppifrån och ned som i diagrammet
        const ordered = stacked ? [...ps].reverse() : ps;
        const rows = ordered
          .map(
            (p) =>
              `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center">` +
              `<span style="display:inline-flex;align-items:center;gap:6px;color:${theme.textSecondary}">` +
              `<span style="width:10px;height:10px;border-radius:3px;background:${p.color};flex:none"></span>${p.seriesName}</span>` +
              `<span style="font-variant-numeric:tabular-nums;font-weight:500">${fmtValue(p.value)}</span></div>`,
          )
          .join('');
        const total =
          stacked && ps.length > 1
            ? `<div style="display:flex;justify-content:space-between;gap:12px;border-top:1px solid ${theme.grid};margin-top:4px;padding-top:4px;font-weight:600">` +
              `<span>Totalt</span><span style="font-variant-numeric:tabular-nums">${fmtValue(
                ps.reduce((a, p) => a + (p.value ?? 0), 0),
              )}</span></div>`
            : '';
        return `${head}${rows}${total}<div style="color:${theme.axisLabel};font-size:12px;margin-top:4px">${ds.unit}</div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: axis,
      boundaryGap: bar,
      axisLine: { lineStyle: { color: theme.baseline } },
      axisTick: { show: false },
      axisLabel: {
        color: theme.axisLabel,
        fontSize: 12,
        hideOverlap: true,
        formatter: (t: string) => (isMonthly ? t.slice(0, 4) : formatPeriod(t)),
        ...(isMonthly ? { interval: (_i: number, t: string) => t.endsWith('-01') } : {}),
      },
    },
    yAxis: {
      type: 'value',
      scale: !yFromZero,
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: theme.grid, width: 1 } },
      axisLabel: {
        color: theme.axisLabel,
        fontSize: 12,
        formatter: axisFormatter(maxAbs, Math.max(decimals, 1)),
      },
    },
    dataZoom: long
      ? [
          { type: 'inside', zoomOnMouseWheel: 'shift', moveOnMouseMove: true },
          {
            type: 'slider',
            height: 24,
            bottom: 8,
            borderColor: theme.grid,
            backgroundColor: 'transparent',
            fillerColor: 'rgba(128,128,128,0.12)',
            dataBackground: { lineStyle: { color: theme.baseline }, areaStyle: { color: theme.grid } },
            selectedDataBackground: { lineStyle: { color: theme.axisLabel }, areaStyle: { color: theme.grid } },
            handleStyle: { color: theme.surface, borderColor: theme.axisLabel },
            moveHandleStyle: { color: theme.baseline },
            textStyle: { color: theme.axisLabel },
            labelFormatter: (_: number, t: string) => formatPeriod(t),
            brushSelect: false,
          },
        ]
      : undefined,
    series,
  };
}

function toCsv(ds: Dataset, axis: string[]): string {
  const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cols = ds.series.map((s) => alignSeries(s, axis));
  const header = ['Period', ...ds.series.map((s) => `${s.label} (${ds.unit})`)].map(esc).join(';');
  const lines = axis.map((t, i) =>
    [t, ...cols.map((c) => (c[i] === null ? '' : String(c[i]).replace('.', ',')))].join(';'),
  );
  const meta = `# Källa: ${ds.source.org} – ${ds.source.name} (${ds.source.url}); hämtad ${ds.fetchedAt}; licens: ${ds.source.license}`;
  return `﻿${meta}\n${header}\n${lines.join('\n')}\n`;
}

export default function Chart({ dataset, height = 360 }: { dataset: Dataset; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = useTheme();
  const axis = useMemo(() => periodAxis(dataset.series), [dataset]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!ref.current || !theme) return;
    const chart = chartRef.current ?? echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const render = () => chart.setOption(buildOption(dataset, axis, theme, ref.current!.clientWidth < 560), true);
    render();
    let lastNarrow = ref.current.clientWidth < 560;
    const ro = new ResizeObserver(() => {
      chart.resize();
      const narrow = (ref.current?.clientWidth ?? 0) < 560;
      if (narrow !== lastNarrow) {
        lastNarrow = narrow;
        render();
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [dataset, axis, theme]);

  useEffect(() => () => chartRef.current?.dispose(), []);

  const download = () => {
    const blob = new Blob([toCsv(dataset, axis)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${dataset.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const decimals = dataset.chart.decimals ?? 0;
  const tableRows = useMemo(() => {
    const cols = dataset.series.map((s) => alignSeries(s, axis));
    return axis
      .map((t, i) => ({ t, vals: cols.map((c) => c[i] ?? null) }))
      .filter((r) => r.vals.some((v) => v !== null))
      .reverse();
  }, [dataset, axis]);

  return (
    <div className="chart">
      <div
        ref={ref}
        style={{ height, width: '100%' }}
        role="img"
        aria-label={`Diagram: ${dataset.title}. ${dataset.description} Visa tabellen för exakta värden.`}
      />
      <div className="chart__actions">
        <button type="button" className="btn" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Dölj tabell' : 'Visa som tabell'}
        </button>
        <button type="button" className="btn" onClick={download}>
          Ladda ner CSV
        </button>
      </div>
      {showTable && (
        <div className="chart__table">
          <table>
            <caption className="visually-hidden">
              {dataset.title} ({dataset.unit})
            </caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                {dataset.series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.t}>
                  <th scope="row">{formatPeriod(r.t)}</th>
                  {r.vals.map((v, i) => (
                    <td key={i}>{v === null ? '–' : formatNumber(v, decimals)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
