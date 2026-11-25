/** Rad med små nyckeltalskort ovanför ett diagram (React). */
import { formatWithUnit } from '../lib/format';

export interface KeyFigureItem {
  key: string;
  label: string;
  value: number | null | undefined;
  unit: string;
  decimals?: number;
  /** Färdigformaterat värde (ersätter value/unit). */
  text?: string;
  hint?: string;
}

export default function KeyFigureRow({ items }: { items: KeyFigureItem[] }) {
  const shown = items.filter((i) => i.text || (i.value !== null && i.value !== undefined));
  if (shown.length === 0) return null;
  return (
    <dl className="kfrow">
      {shown.map((i) => (
        <div key={i.key} className="kfrow__item" title={i.hint}>
          <dt>{i.label}</dt>
          <dd>{i.text ?? formatWithUnit(i.value, i.unit, i.decimals ?? 0)}</dd>
        </div>
      ))}
      <style>{`
        .kfrow { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 0 0 16px; }
        .kfrow__item { background: var(--surface-sunken); border-radius: 8px; padding: 8px 12px; min-width: 0; }
        .kfrow dt { font-size: 0.75rem; color: var(--text-secondary); line-height: 1.3; }
        .kfrow dd { margin: 2px 0 0; font-size: 1.05rem; font-weight: 600; font-variant-numeric: tabular-nums; }
      `}</style>
    </dl>
  );
}
