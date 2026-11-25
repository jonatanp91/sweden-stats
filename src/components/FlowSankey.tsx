/**
 * Sankey-diagram (React-ö): inflöden → enhet (kommun/region/staten) → (grupper) → utflöden, med belopp,
 * andel och belopp per invånare. Nyckeltal för vald enhet visas ovanför diagrammet.
 * Användaren väljer enhet och år i dropdown-menyer; valet speglas i URL:en (?kommun=0180&kommun-ar=2025)
 * så att länkar kan delas. Lyssnar på SELECT_ENTITY_EVENT (t.ex. klick i kommunkartan).
 * Data: public/<dataPath>/<år>.json.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { FlowDataset, FlowYear } from '../lib/types';
import { formatMnkr, formatNumber } from '../lib/format';
import { url } from '../lib/url';
import {
  downloadCsv,
  fetchJson,
  readParam,
  SELECT_ENTITY_EVENT,
  useTheme,
  writeParams,
  type SelectEntityDetail,
} from './chart-shared';
import { buildSankeyOption, layoutItems, pct, sankeySize, type SankeyItem } from './sankey-shared';
import KeyFigureRow from './KeyFigureRow';

echarts.use([SankeyChart, TooltipComponent, SVGRenderer]);

/** Belopp i mnkr per invånare → kronor. */
const perCapita = (mnkr: number, pop: number | undefined) => (pop ? (mnkr * 1e6) / pop : null);
const formatKr = (kr: number | null) => (kr === null ? '–' : `${formatNumber(kr, 0)} kr`);

export default function FlowSankey({ dataset }: { dataset: FlowDataset }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = useTheme();
  const latest = dataset.years[dataset.years.length - 1]!;
  const yearParam = `${dataset.entityParam}-ar`;
  const [entity, setEntity] = useState(dataset.defaultEntity);
  const [year, setYear] = useState(latest);
  const [data, setData] = useState<FlowYear | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [narrow, setNarrow] = useState(false);

  // Startval från URL:en
  useEffect(() => {
    const e = readParam(dataset.entityParam);
    if (e && dataset.entities.some((x) => x.code === e)) setEntity(e);
    const y = readParam(yearParam);
    if (y && dataset.years.includes(y)) setYear(y);
  }, [dataset, yearParam]);

  // Val från andra komponenter (t.ex. klick i kartan)
  useEffect(() => {
    const onSelect = (ev: Event) => {
      const d = (ev as CustomEvent<SelectEntityDetail>).detail;
      if (d.param !== dataset.entityParam || !dataset.entities.some((x) => x.code === d.code)) return;
      setEntity(d.code);
      if (d.year && dataset.years.includes(d.year)) setYear(d.year);
      wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(SELECT_ENTITY_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_ENTITY_EVENT, onSelect);
  }, [dataset]);

  useEffect(() => {
    let alive = true;
    fetchJson<FlowYear>(url(`${dataset.dataPath}/${year}.json`))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [dataset.dataPath, year]);

  const entityName = dataset.entities.find((e) => e.code === entity)?.name ?? entity;
  const pop = data?.population?.[entity];
  const layout = useMemo(() => {
    const values = data?.values[entity] ?? {};
    const items: SankeyItem[] = dataset.nodes.map((n) => ({ ...n, value: values[n.id] ?? 0 }));
    return layoutItems(items);
  }, [dataset, data, entity]);
  const { total } = layout;
  const { height, minWidth } = sankeySize(layout, narrow);

  useEffect(() => {
    if (!ref.current || !theme || !data || total === 0) return;
    const chart = chartRef.current ?? echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const isNarrow = (wrapRef.current?.clientWidth ?? 800) < 720;
    setNarrow(isNarrow);
    chart.setOption(
      buildSankeyOption({
        title: entityName,
        layout,
        theme,
        narrow: isNarrow,
        fmt: formatMnkr,
        extra: pop ? (v) => `${formatKr(perCapita(v, pop))}/inv` : undefined,
        shareLabels: { in: 'Andel av intäkterna', out: 'Andel av utgifterna' },
      }),
      true,
    );
    chart.resize();
    const ro = new ResizeObserver(() => {
      chart.resize();
      const n = (wrapRef.current?.clientWidth ?? 800) < 720;
      if (n !== isNarrow) setNarrow(n);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [data, entityName, layout, total, pop, theme, narrow, height]);

  useEffect(() => () => chartRef.current?.dispose(), []);

  const groups = useMemo(() => {
    const ungrouped = dataset.entities.filter((e) => !e.group);
    const byGroup = new Map<string, typeof dataset.entities>();
    for (const e of dataset.entities.filter((x) => x.group)) {
      byGroup.set(e.group!, [...(byGroup.get(e.group!) ?? []), e]);
    }
    return { ungrouped, byGroup: [...byGroup.entries()] };
  }, [dataset]);

  const figures = data?.keyFigures?.[entity];
  const keyItems = dataset.keyFigures.map((k) => ({ ...k, value: figures?.[k.key] }));

  const onEntity = (code: string) => {
    setEntity(code);
    writeParams({ [dataset.entityParam]: code });
  };
  const onYear = (y: string) => {
    setYear(y);
    writeParams({ [yearParam]: y });
  };

  const labelOf = new Map(layout.items.map((i) => [i.id, i.label]));
  const tableRows = (side: 'in' | 'out') => layout.items.filter((i) => i.side === side);

  const csv = () => {
    downloadCsv(
      `${dataset.id}-${entity}-${year}.csv`,
      ['Riktning', 'Grupp', 'Post', `Belopp (${dataset.unit})`, 'Andel (%)', 'Kr per invånare'],
      layout.items
        .filter((i) => i.role !== 'group')
        .map((r) => {
          const kr = perCapita(r.value, pop);
          return [
            r.side === 'in' ? 'Intäkt' : 'Utgift',
            r.parent ? (labelOf.get(r.parent) ?? '') : '',
            r.label,
            r.value,
            total ? Math.round((r.value / total) * 1000) / 10 : null,
            kr === null ? null : Math.round(kr),
          ];
        }),
      `${entityName} ${year}. Källa: ${[dataset.source, ...dataset.extraSources].map((s) => `${s.org} ${s.tableId ?? ''}`).join(', ')}; hämtad ${dataset.fetchedAt}`,
    );
  };

  return (
    <div className="flow" ref={wrapRef}>
      <div className="viz-controls">
        {dataset.entities.length > 1 && (
          <label>
            {dataset.entityLabel}
            <select value={entity} onChange={(e) => onEntity(e.target.value)}>
              {groups.ungrouped.map((e) => (
                <option key={e.code} value={e.code}>
                  {e.name}
                </option>
              ))}
              {groups.byGroup.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map((e) => (
                    <option key={e.code} value={e.code}>
                      {e.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        <label>
          År
          <select value={year} onChange={(e) => onYear(e.target.value)}>
            {[...dataset.years].reverse().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <div className="flow__legend" aria-hidden="true">
          <span>
            <i style={{ background: 'var(--series-1)' }} /> Intäkter
          </span>
          <span>
            <i style={{ background: 'var(--series-2)' }} /> Kostnader
          </span>
          <span>
            <i style={{ background: 'var(--series-muted)' }} /> Över-/underskott
          </span>
        </div>
      </div>

      {data && <KeyFigureRow items={keyItems} />}

      {error && <p className="viz-status">Kunde inte ladda data: {error}</p>}
      {data && total === 0 && <p className="viz-status">Ingen data för {entityName} {year}.</p>}
      <div className="flow__scroll">
        <div
          ref={ref}
          style={{ height, width: '100%', minWidth, display: total === 0 ? 'none' : 'block' }}
          role="img"
          aria-label={`Sankey-diagram: ${entityName} ${year}. Intäkter ${formatMnkr(total)}. Visa tabellen för alla poster.`}
        />
      </div>

      <div className="chart__actions">
        <button type="button" className="btn" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Dölj tabell' : 'Visa som tabell'}
        </button>
        <button type="button" className="btn" onClick={csv} disabled={total === 0}>
          Ladda ner CSV
        </button>
      </div>
      {showTable && total > 0 && (
        <div className="chart__table">
          <table>
            <caption className="visually-hidden">
              {entityName} {year}
            </caption>
            <thead>
              <tr>
                <th scope="col">Post</th>
                <th scope="col">Belopp</th>
                <th scope="col">Andel</th>
                {pop ? <th scope="col">Per invånare</th> : null}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Intäkter', 'in'],
                  ['Kostnader', 'out'],
                ] as const
              ).map(([title, side]) => (
                <Fragment key={side}>
                  <tr>
                    <th scope="rowgroup" colSpan={pop ? 4 : 3} className="flow__group">
                      {title}
                    </th>
                  </tr>
                  {tableRows(side).map((r) => (
                    <tr key={r.id} className={r.role === 'group' ? 'flow__subtotal' : r.parent ? 'flow__child' : undefined}>
                      <th scope="row">{r.label}</th>
                      <td>{formatMnkr(r.value)}</td>
                      <td>{pct(r.value, total)}</td>
                      {pop ? <td>{formatKr(perCapita(r.value, pop))}</td> : null}
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr>
                <th scope="row">Totalt</th>
                <td>{formatMnkr(total)}</td>
                <td>100 %</td>
                {pop ? <td>{formatKr(perCapita(total, pop))}</td> : null}
              </tr>
            </tbody>
          </table>
          {pop ? <p className="flow__pop">Folkmängd {formatNumber(pop)} invånare.</p> : null}
        </div>
      )}
      <style>{`
        .flow__scroll { overflow-x: auto; }
        .flow__legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8rem; color: var(--text-secondary); padding-bottom: 8px; }
        .flow__legend span { display: inline-flex; align-items: center; gap: 6px; }
        .flow__legend i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
        .chart__table .flow__group { text-align: left; background: var(--surface-sunken); font-weight: 600; }
        .chart__table .flow__subtotal th, .chart__table .flow__subtotal td { font-weight: 600; }
        .chart__table .flow__child th { padding-left: 24px; font-weight: 400; }
        .flow__pop { font-size: 0.8rem; color: var(--text-secondary); margin: 6px 0 0; }
      `}</style>
    </div>
  );
}
