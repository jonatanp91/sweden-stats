/**
 * Skattekalkylator (React-ö): bruttolön + kommun → personligt Sankey-diagram över vart skatten går.
 * Steg 1: nettolön och mottagare (kommunen, regionen, staten, pensionssystemet, socialförsäkringarna).
 * Steg 2: vad mottagarna använder pengarna till, fördelat efter deras budgetandelar (flödesdatasetens årsfiler).
 * Beräkningen görs i src/lib/tax.ts; regler och skattesatser finns i datasetet (Skatteverket).
 * Valen speglas i URL:en (?lon=40000&kommun=0180) och kommunen följer klick i kommunkartan.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { SankeyChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Breakdown, FlowYear, TaxCalculatorDataset } from '../lib/types';
import { computeTax, marginalTax } from '../lib/tax';
import { buildItems } from '../lib/tax-flow';
import { formatNumber } from '../lib/format';
import { url } from '../lib/url';
import {
  downloadCsv,
  fetchJson,
  readParam,
  SELECT_ENTITY_EVENT,
  useTheme,
  writeParams,
  type SelectEntityDetail,
  type Theme,
} from './chart-shared';
import { buildSankeyOption, layoutItems, pct, sankeySize, type SankeyItem } from './sankey-shared';
import KeyFigureRow from './KeyFigureRow';

echarts.use([SankeyChart, TooltipComponent, SVGRenderer]);

const kr = (v: number) => `${formatNumber(v, 0)} kr`;

/** Färg per mottagare (barn ärver gruppens färg); in = serie 1, nettolön nedtonad. */
const GROUP_COLOR: Record<string, number> = { 'g-kommun': 2, 'g-region': 3, 'g-staten': 6, 'g-pension': 1, 'g-social': 4, avgifter: 5, publicservice: 5 };
function colorOf(it: SankeyItem, theme: Theme): string {
  if (it.role === 'balance') return theme.muted;
  if (it.side === 'in') return theme.series[0]!;
  const idx = GROUP_COLOR[it.parent ?? it.id];
  return theme.series[idx ?? 1]!;
}

export default function TaxSankey({ dataset }: { dataset: TaxCalculatorDataset }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const theme = useTheme();
  const latest = dataset.years[dataset.years.length - 1]!;
  const [year, setYear] = useState(latest);
  const [salaryText, setSalaryText] = useState(String(dataset.defaultSalary));
  const [code, setCode] = useState(dataset.defaultMunicipality);
  const [church, setChurch] = useState(false);
  const [perYear, setPerYear] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [flows, setFlows] = useState<{ kommun: FlowYear | null; region: FlowYear | null; staten: FlowYear | null }>({
    kommun: null,
    region: null,
    staten: null,
  });
  const [error, setError] = useState<string | null>(null);

  // Startval från URL:en
  useEffect(() => {
    const l = readParam('lon');
    if (l && /^\d{1,7}$/.test(l)) setSalaryText(l);
    const k = readParam('kommun');
    if (k && dataset.municipalities.some((m) => m.code === k)) setCode(k);
  }, [dataset]);

  // Klick i kommunkartan väljer kommun även här
  useEffect(() => {
    const onSelect = (ev: Event) => {
      const d = (ev as CustomEvent<SelectEntityDetail>).detail;
      if (d.param === 'kommun' && dataset.municipalities.some((m) => m.code === d.code)) setCode(d.code);
    };
    window.addEventListener(SELECT_ENTITY_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_ENTITY_EVENT, onSelect);
  }, [dataset]);

  // Budgetandelar för andra steget
  useEffect(() => {
    let alive = true;
    const load = (b: Breakdown) => fetchJson<FlowYear>(url(`${b.dataPath}/${b.year}.json`));
    Promise.all([load(dataset.breakdowns.kommun), load(dataset.breakdowns.region), load(dataset.breakdowns.staten)])
      .then(([kommun, region, staten]) => alive && setFlows({ kommun, region, staten }))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [dataset]);

  const salary = Math.min(Math.max(Number(salaryText.replace(/\s/g, '')) || 0, 0), 5_000_000);
  const kommun = dataset.municipalities.find((m) => m.code === code) ?? dataset.municipalities[0]!;
  const rules = dataset.rules[year]!;
  const rates = kommun.rates[year]!;
  const result = useMemo(() => computeTax(salary * 12, rates, rules, church), [salary, rates, rules, church]);
  const divisor = perYear ? 1 : 12;
  const built = useMemo(
    () => buildItems(dataset, rules, result, kommun, flows, divisor),
    [dataset, rules, result, kommun, flows, divisor],
  );
  const layout = useMemo(() => layoutItems(built.items), [built]);
  const { height, minWidth } = sankeySize(layout, narrow);
  const total = layout.total;
  const marginal = useMemo(() => marginalTax(salary * 12, rates, rules, church), [salary, rates, rules, church]);

  useEffect(() => {
    if (!ref.current || !theme || total <= 0) return;
    const chart = chartRef.current ?? echarts.init(ref.current, undefined, { renderer: 'svg' });
    chartRef.current = chart;
    const isNarrow = (wrapRef.current?.clientWidth ?? 800) < 720;
    setNarrow(isNarrow);
    chart.setOption(
      buildSankeyOption({
        title: perYear ? 'Arbetsgivarens kostnad per år' : 'Arbetsgivarens kostnad per månad',
        layout,
        theme,
        narrow: isNarrow,
        fmt: kr,
        shareLabels: { in: 'Andel av arbetsgivarens kostnad', out: 'Andel av arbetsgivarens kostnad' },
        colorOf,
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
  }, [layout, total, theme, narrow, height, perYear]);

  useEffect(() => () => chartRef.current?.dispose(), []);

  const groups = useMemo(() => {
    const m = new Map<string, typeof dataset.municipalities>();
    for (const k of dataset.municipalities) m.set(k.group ?? '', [...(m.get(k.group ?? '') ?? []), k]);
    return [...m.entries()];
  }, [dataset]);

  const employerCost = result.brutto + result.arbetsgivaravgiftTotalt;
  const allTaxes = result.skatt + result.arbetsgivaravgiftTotalt;
  const per = perYear ? 'år' : 'mån';
  const keyItems = [
    { key: 'skatt', label: `Din skatt per ${per}`, value: result.skatt / divisor, unit: 'kr' },
    { key: 'netto', label: `Nettolön per ${per}`, value: result.netto / divisor, unit: 'kr' },
    {
      key: 'skattesats',
      label: 'Skatt i % av bruttolönen',
      value: result.brutto > 0 ? (result.skatt / result.brutto) * 100 : null,
      unit: '%',
      decimals: 1,
    },
    {
      key: 'kil',
      label: 'Skatt och avgifter i % av arbetsgivarens kostnad',
      value: employerCost > 0 ? (allTaxes / employerCost) * 100 : null,
      unit: '%',
      decimals: 1,
      hint: 'Din skatt plus arbetsgivaravgifterna, delat med lön + arbetsgivaravgifter',
    },
    { key: 'marginal', label: 'Marginalskatt', value: marginal * 100, unit: '%', decimals: 0, hint: 'Andel av en löneökning som går till skatt' },
    {
      key: 'kommunalskatt',
      label: `Kommunalskatt i ${kommun.name}`,
      value: rates.kommun + rates.region,
      unit: '%',
      decimals: 2,
    },
  ];

  const onSalary = (v: string) => {
    setSalaryText(v);
    const n = Number(v.replace(/\s/g, ''));
    if (Number.isFinite(n) && n >= 0) writeParams({ lon: String(Math.round(n)) });
  };
  const onKommun = (c: string) => {
    setCode(c);
    writeParams({ kommun: c });
  };

  const labelOf = new Map(layout.items.map((i) => [i.id, i.label]));
  const csv = () => {
    downloadCsv(
      `skatt-${kommun.code}-${salary}-${year}.csv`,
      ['Riktning', 'Grupp', 'Post', `Belopp (kr per ${per})`, 'Andel (%)'],
      layout.items
        .filter((i) => i.role !== 'group')
        .map((i) => [
          i.side === 'in' ? 'Inflöde' : 'Utflöde',
          i.parent ? (labelOf.get(i.parent) ?? '') : '',
          i.label,
          Math.round(i.value),
          total ? Math.round((i.value / total) * 1000) / 10 : null,
        ]),
      `Bruttolön ${salary} kr/mån, ${kommun.name} ${year}. Beräkning enligt Skatteverkets regler; fördelning efter budgetandelar (SCB, Statskontoret).`,
    );
  };

  return (
    <div className="taxcalc" ref={wrapRef}>
      <div className="viz-controls">
        <label>
          Bruttolön per månad (kr)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={5000000}
            step={1000}
            value={salaryText}
            onChange={(e) => onSalary(e.target.value)}
          />
        </label>
        <label>
          Kommun
          <select value={kommun.code} onChange={(e) => onKommun(e.target.value)}>
            {groups.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {dataset.years.length > 1 && (
          <label>
            Inkomstår
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {[...dataset.years].reverse().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="taxcalc__check">
          <input type="checkbox" checked={church} onChange={(e) => setChurch(e.target.checked)} />
          Medlem i Svenska kyrkan
        </label>
        <div className="taxcalc__toggle" role="group" aria-label="Visa belopp">
          <button type="button" className="btn" aria-pressed={!perYear} onClick={() => setPerYear(false)}>
            Per månad
          </button>
          <button type="button" className="btn" aria-pressed={perYear} onClick={() => setPerYear(true)}>
            Per år
          </button>
        </div>
      </div>

      <KeyFigureRow items={keyItems} />

      {error && <p className="viz-status">Kunde inte ladda budgetandelar: {error}</p>}
      {salary === 0 && <p className="viz-status">Ange en bruttolön för att se fördelningen.</p>}
      <div className="flow__scroll">
        <div
          ref={ref}
          style={{ height, width: '100%', minWidth, display: total > 0 ? 'block' : 'none' }}
          role="img"
          aria-label={`Sankey-diagram: lön ${formatNumber(salary)} kr per månad i ${kommun.name}. Skatt ${kr(result.skatt / 12)} per månad. Visa tabellen för alla poster.`}
        />
      </div>

      <div className="chart__actions">
        <button type="button" className="btn" aria-expanded={showTable} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Dölj tabell' : 'Visa som tabell'}
        </button>
        <button type="button" className="btn" onClick={csv} disabled={total <= 0}>
          Ladda ner CSV
        </button>
      </div>
      {showTable && total > 0 && (
        <div className="chart__table">
          <table>
            <caption className="visually-hidden">
              Fördelning av lön {formatNumber(salary)} kr per månad i {kommun.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Post</th>
                <th scope="col">Belopp per {per}</th>
                <th scope="col">Andel</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['Arbetsgivarens kostnad', 'in'],
                  ['Vart pengarna går', 'out'],
                ] as const
              ).map(([title, side]) => (
                <Fragment key={side}>
                  <tr>
                    <th scope="rowgroup" colSpan={3} className="flow__group">
                      {title}
                    </th>
                  </tr>
                  {layout.items
                    .filter((i) => i.side === side)
                    .map((i) => (
                      <tr key={i.id} className={i.role === 'group' ? 'flow__subtotal' : i.parent ? 'flow__child' : undefined}>
                        <th scope="row">{i.label}</th>
                        <td>{kr(i.value)}</td>
                        <td>{pct(i.value, total)}</td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="flow__pop">
            Grundavdrag {kr(result.grundavdrag)}/år · jobbskatteavdrag {kr(result.jobbskatteavdrag)}/år · statlig inkomstskatt{' '}
            {kr(result.statligSkatt)}/år · allmän pensionsavgift {kr(result.pensionsavgift)}/år (återbetalas helt som skattereduktion).
          </p>
        </div>
      )}
      <style>{`
        .flow__scroll { overflow-x: auto; }
        .taxcalc input[type='number'] { font: inherit; font-size: 0.9rem; font-weight: 400; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); color: var(--text-primary); width: 160px; }
        .taxcalc .taxcalc__check { flex-direction: row; align-items: center; gap: 6px; font-weight: 400; color: var(--text-primary); font-size: 0.9rem; padding-bottom: 6px; }
        .taxcalc__toggle { display: inline-flex; gap: 4px; }
        .taxcalc__toggle .btn[aria-pressed='true'] { background: var(--text-primary); color: var(--surface); }
        .chart__table .flow__group { text-align: left; background: var(--surface-sunken); font-weight: 600; }
        .chart__table .flow__subtotal th, .chart__table .flow__subtotal td { font-weight: 600; }
        .chart__table .flow__child th { padding-left: 24px; font-weight: 400; }
        .flow__pop { font-size: 0.8rem; color: var(--text-secondary); margin: 6px 0 0; }
      `}</style>
    </div>
  );
}
