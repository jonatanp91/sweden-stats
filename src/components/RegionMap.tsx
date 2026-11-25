/**
 * Karta över Sveriges kommuner (React-ö). Färgsätter kommunerna efter valt mått och år,
 * visar alla mått i tooltip vid hover och skickar en händelse vid klick så att t.ex. kommunens
 * Sankey-diagram kan visa samma kommun. Geometri: public/geo/kommuner.json. Data: public/<dataPath>/<år>.json.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { GeoComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { RegionalDataset, RegionalMetric, RegionalYear } from '../lib/types';
import { formatNumber, formatWithUnit } from '../lib/format';
import { url } from '../lib/url';
import {
  downloadCsv,
  escapeHtml,
  fetchJson,
  FONT,
  SELECT_ENTITY_EVENT,
  tooltipRow,
  tooltipStyle,
  useTheme,
  type SelectEntityDetail,
  type Theme,
} from './chart-shared';

echarts.use([MapChart, GeoComponent, TooltipComponent, VisualMapComponent, SVGRenderer]);

const MAP_NAME = 'sverige-kommuner';
let geoPromise: Promise<void> | null = null;
function ensureGeo(): Promise<void> {
  geoPromise ??= fetchJson<object>(url('geo/kommuner.json')).then((g) => {
    echarts.registerMap(MAP_NAME, g as Parameters<typeof echarts.registerMap>[1]);
  });
  return geoPromise;
}

/** Percentil av sorterade värden (för att inte låta extremvärden styra färgskalan). */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i]!;
}

function buildOption(
  ds: RegionalDataset,
  data: RegionalYear,
  metric: RegionalMetric,
  theme: Theme,
  narrow: boolean,
): EChartsCoreOption {
  const names = new Map(ds.regions.map((r) => [r.code, r]));
  const values = ds.regions.map((r) => ({ name: r.code, value: data.values[r.code]?.[metric.key] ?? null }));
  const nums = values.map((v) => v.value).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const diverging = metric.scale === 'diverging';
  let min = percentile(nums, 0.02);
  let max = percentile(nums, 0.98);
  if (diverging) {
    const m = Math.max(Math.abs(min), Math.abs(max));
    min = -m;
    max = m;
  }
  const fmt = (v: number) => formatWithUnit(v, metric.unit, metric.decimals);

  return {
    textStyle: { fontFamily: FONT },
    tooltip: {
      trigger: 'item',
      ...tooltipStyle(theme),
      formatter: (p: { name: string }) => {
        const r = names.get(p.name);
        const v = data.values[p.name] ?? {};
        if (!r) return '';
        const rows = ds.metrics
          .map((m) => tooltipRow(theme, m.label, formatWithUnit(v[m.key], m.unit, m.decimals), undefined, m.key === metric.key))
          .join('');
        return (
          `<div style="font-weight:600">${escapeHtml(r.name)}</div>` +
          `<div style="color:${theme.axisLabel};font-size:12px;margin-bottom:6px">${escapeHtml(r.group ?? '')} · ${data.year}</div>` +
          rows +
          `<div style="color:${theme.axisLabel};font-size:12px;margin-top:6px">Klicka för att se kommunens budget</div>`
        );
      },
    },
    visualMap: {
      type: 'continuous',
      min,
      max,
      calculable: false,
      realtime: false,
      orient: narrow ? 'horizontal' : 'vertical',
      left: narrow ? 'center' : 0,
      bottom: narrow ? 0 : 24,
      itemWidth: 12,
      itemHeight: narrow ? 160 : 140,
      text: [fmt(max), fmt(min)],
      textGap: 8,
      textStyle: { color: theme.textSecondary, fontSize: 12 },
      inRange: { color: diverging ? [theme.divNeg, theme.divMid, theme.divPos] : [theme.seqLow, theme.seqHigh] },
      outOfRange: { color: theme.grid },
      formatter: (v: number) => fmt(v),
    },
    series: [
      {
        type: 'map',
        map: MAP_NAME,
        nameProperty: 'code',
        roam: true,
        scaleLimit: { min: 1, max: 12 },
        // Sverige ligger långt norrut: utan korrigering ser landet utdraget ut
        aspectScale: 0.5,
        layoutCenter: narrow ? ['50%', '45%'] : ['55%', '50%'],
        layoutSize: narrow ? '95%' : '98%',
        selectedMode: false,
        data: values,
        itemStyle: { borderColor: theme.surface, borderWidth: 0.4, areaColor: theme.grid },
        emphasis: {
          label: { show: false },
          itemStyle: { borderColor: theme.textPrimary, borderWidth: 1.2, areaColor: theme.series[3] },
        },
      },
    ],
  };
}

export default function RegionMap({ dataset }: { dataset: RegionalDataset }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = useTheme();
  const colorable = dataset.metrics.filter((m) => m.scale);
  const [metricKey, setMetricKey] = useState(dataset.defaultMetric);
  const metric = dataset.metrics.find((m) => m.key === metricKey) ?? dataset.metrics[0]!;
  const [year, setYear] = useState(metric.years[metric.years.length - 1] ?? dataset.years[dataset.years.length - 1]!);
  const [data, setData] = useState<RegionalYear | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [narrow, setNarrow] = useState(false);

  // Byt år om valt mått saknar data för det året
  useEffect(() => {
    if (!metric.years.includes(year)) setYear(metric.years[metric.years.length - 1]!);
  }, [metric, year]);

  useEffect(() => {
    ensureGeo()
      .then(() => setGeoReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let alive = true;
    fetchJson<RegionalYear>(url(`${dataset.dataPath}/${year}.json`))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [dataset.dataPath, year]);

  useEffect(() => {
    if (!ref.current || !theme || !data || !geoReady) return;
    const chart = chartRef.current ?? echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const isNarrow = ref.current.clientWidth < 560;
    setNarrow(isNarrow);
    chart.setOption(buildOption(dataset, data, metric, theme, isNarrow), true);
    chart.off('click');
    chart.on('click', (p) => {
      const detail: SelectEntityDetail = { param: dataset.level, code: String(p.name), year };
      window.dispatchEvent(new CustomEvent(SELECT_ENTITY_EVENT, { detail }));
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [dataset, data, metric, theme, geoReady, year]);

  useEffect(() => () => chartRef.current?.dispose(), []);

  // Topp- och bottenlistor för valt mått
  const ranking = useMemo(() => {
    if (!data) return null;
    const rows = dataset.regions
      .map((r) => ({ r, v: data.values[r.code]?.[metric.key] ?? null }))
      .filter((x): x is { r: (typeof dataset.regions)[number]; v: number } => x.v !== null)
      .sort((a, b) => b.v - a.v);
    return { top: rows.slice(0, 5), bottom: rows.slice(-5).reverse(), count: rows.length };
  }, [data, dataset, metric]);

  const csv = () => {
    if (!data) return;
    downloadCsv(
      `${dataset.id}-${year}.csv`,
      ['Kod', dataset.level === 'kommun' ? 'Kommun' : 'Region', 'Län', ...dataset.metrics.map((m) => `${m.label} (${m.unit})`)],
      dataset.regions.map((r) => [r.code, r.name, r.group ?? '', ...dataset.metrics.map((m) => data.values[r.code]?.[m.key] ?? null)]),
      `Källa: ${[dataset.source, ...dataset.extraSources].map((s) => `${s.org} ${s.tableId ?? ''}`).join(', ')}; år ${year}; hämtad ${dataset.fetchedAt}`,
    );
  };

  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...dataset.regions].sort(
      (a, b) => (data.values[b.code]?.[metric.key] ?? -Infinity) - (data.values[a.code]?.[metric.key] ?? -Infinity),
    );
  }, [data, dataset, metric]);

  const fmt = (v: number | null | undefined, m: RegionalMetric) => formatWithUnit(v, m.unit, m.decimals);

  return (
    <div className="region-map">
      <div className="viz-controls">
        <label>
          Visa på kartan
          <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
            {colorable.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          År
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            {[...metric.years].reverse().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="viz-status">Kunde inte ladda kartan: {error}</p>}
      <div className="region-map__layout">
        <div
          ref={ref}
          className="region-map__canvas"
          role="img"
          aria-label={`Karta över Sveriges kommuner: ${metric.label} ${year}. Visa tabellen för exakta värden.`}
        />
        {ranking && ranking.count > 0 && (
          <aside className="region-map__ranking" aria-label={`Högst och lägst: ${metric.label}`}>
            <h3>Högst {metric.label.toLowerCase()}</h3>
            <ol>
              {ranking.top.map(({ r, v }) => (
                <li key={r.code}>
                  <span>{r.name}</span>
                  <span className="num">{fmt(v, metric)}</span>
                </li>
              ))}
            </ol>
            <h3>Lägst</h3>
            <ol>
              {ranking.bottom.map(({ r, v }) => (
                <li key={r.code}>
                  <span>{r.name}</span>
                  <span className="num">{fmt(v, metric)}</span>
                </li>
              ))}
            </ol>
            <p className="muted small">
              {year} · {formatNumber(ranking.count)} kommuner med data
            </p>
          </aside>
        )}
      </div>

      <div className="chart__actions">
        <button type="button" className="btn" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Dölj tabell' : 'Visa som tabell'}
        </button>
        <button type="button" className="btn" onClick={csv} disabled={!data}>
          Ladda ner CSV ({year})
        </button>
      </div>
      {showTable && data && (
        <div className="chart__table">
          <table>
            <caption className="visually-hidden">
              {dataset.title}, {year}
            </caption>
            <thead>
              <tr>
                <th scope="col">Kommun</th>
                {dataset.metrics.map((m) => (
                  <th scope="col" key={m.key}>
                    {m.label} ({m.unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.code}>
                  <th scope="row">{r.name}</th>
                  {dataset.metrics.map((m) => (
                    <td key={m.key}>{formatNumber(data.values[r.code]?.[m.key] ?? null, m.decimals)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <style>{`
        .region-map__layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 16px; align-items: start; }
        .region-map__canvas { width: 100%; height: ${narrow ? 560 : 720}px; }
        .region-map__ranking h3 { font-size: 0.85rem; margin: 8px 0 6px; color: var(--text-secondary); }
        .region-map__ranking ol { list-style: none; margin: 0 0 12px; padding: 0; font-size: 0.875rem; }
        .region-map__ranking li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--grid); }
        .region-map__ranking .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .region-map__ranking .small { font-size: 0.75rem; }
        @media (max-width: 760px) {
          .region-map__layout { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
