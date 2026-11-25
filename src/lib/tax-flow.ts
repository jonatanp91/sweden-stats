/**
 * Poster i skattekalkylatorns Sankey (src/components/TaxSankey.tsx): ren funktion så att balansen kan testas.
 * Inflöden: bruttolön + arbetsgivaravgifter (+ skattereduktioner från staten om statens netto är negativt).
 * Utflöden: nettolön, kommunen, regionen, staten (netto), pensionssystemet, socialförsäkringarna och avgifter.
 */
import type { SankeyItem } from '../components/sankey-shared';
import type { TaxResult } from './tax';
import type { Breakdown, FlowYear, TaxCalculatorDataset, TaxRules } from './types';

/** Fördelar `amount` på en mottagares verksamheter efter budgetandelarna för `entity` (reserv: riket "00"). */
export function breakdownItems(
  b: Breakdown,
  data: FlowYear | null,
  entity: string,
  amount: number,
  prefix: string,
  parent: string,
): SankeyItem[] {
  const values = data?.values[entity] ?? data?.values['00'];
  const total = values ? b.include.reduce((a, id) => a + (values[id] ?? 0), 0) : 0;
  if (!values || total <= 0 || amount <= 0) {
    // Andelar saknas: hela beloppet som ett löv under gruppen
    return [{ id: `${prefix}-ovrigt`, label: b.otherLabel, side: 'out', parent, value: amount }];
  }
  let used = 0;
  const items: SankeyItem[] = b.groups.map((g) => {
    const share = g.nodes.reduce((a, id) => a + (values[id] ?? 0), 0) / total;
    used += share;
    return { id: `${prefix}-${g.id}`, label: g.label, side: 'out', parent, value: amount * share, description: g.description };
  });
  items.push({ id: `${prefix}-ovrigt`, label: b.otherLabel, side: 'out', parent, value: amount * Math.max(0, 1 - used) });
  return items;
}

export interface Built {
  items: SankeyItem[];
  stateNet: number;
}

export function buildItems(
  ds: TaxCalculatorDataset,
  rules: TaxRules,
  r: TaxResult,
  kommun: { code: string; name: string; region: string; regionName: string },
  flows: { kommun: FlowYear | null; region: FlowYear | null; staten: FlowYear | null },
  divisor: number,
): Built {
  const fee = (key: string) => r.arbetsgivaravgifter[key] ?? 0;
  const feeLabel = (key: string) => rules.arbetsgivaravgifter.find((f) => f.key === key);
  const reductions = r.reduktionPension + r.jobbskatteavdrag + r.reduktionForvarv;
  const stateNet = r.statligSkatt + fee('loneavgift') + r.alderspensionOverTak - reductions;
  const pension = fee('alderspension') + r.pensionsavgift;
  const socialKeys = rules.arbetsgivaravgifter.map((f) => f.key).filter((k) => k !== 'alderspension' && k !== 'loneavgift');

  const items: SankeyItem[] = [
    { id: 'brutto', label: 'Bruttolön', side: 'in', value: r.brutto, description: 'Din lön före skatt' },
    {
      id: 'ag',
      label: 'Arbetsgivaravgifter',
      side: 'in',
      value: r.arbetsgivaravgiftTotalt,
      description: 'Betalas av arbetsgivaren utöver lönen (31,42 % för den som är född 1959–2002)',
    },
  ];
  if (stateNet < 0) {
    items.push({
      id: 'reduktion',
      label: 'Skattereduktioner från staten',
      side: 'in',
      value: -stateNet,
      description:
        'Jobbskatteavdrag och andra skattereduktioner är större än den statliga skatten och löneavgiften – staten bidrar netto till din kommunalskatt och pension',
    });
  }

  items.push(
    { id: 'g-kommun', label: kommun.name, side: 'out', role: 'group', value: 0, description: `Kommunalskatt till kommunen` },
    ...breakdownItems(ds.breakdowns.kommun, flows.kommun, kommun.code, r.kommunalskattKommun, 'k', 'g-kommun'),
    { id: 'g-region', label: kommun.regionName, side: 'out', role: 'group', value: 0, description: 'Regionskatt (kommunal inkomstskatt till regionen)' },
    ...breakdownItems(ds.breakdowns.region, flows.region, kommun.region, r.kommunalskattRegion, 'r', 'g-region'),
  );
  if (stateNet > 0) {
    items.push(
      {
        id: 'g-staten',
        label: 'Staten',
        side: 'out',
        role: 'group',
        value: 0,
        description: 'Statlig inkomstskatt och allmän löneavgift minus jobbskatteavdrag och andra skattereduktioner',
      },
      ...breakdownItems(ds.breakdowns.staten, flows.staten, 'SE', stateNet, 's', 'g-staten'),
    );
  }
  items.push(
    {
      id: 'g-pension',
      label: 'Pensionssystemet',
      side: 'out',
      role: 'group',
      value: 0,
      description: 'Ålderspensionsavgift (arbetsgivaren) och allmän pensionsavgift (du) – blir din framtida allmänna pension',
    },
    { id: 'p-inkomst', label: 'Inkomstpension', side: 'out', parent: 'g-pension', value: pension * rules.pensionSplit.inkomstpension, description: 'Fördelningssystemet (AP-fonderna)' },
    { id: 'p-premie', label: 'Premiepension', side: 'out', parent: 'g-pension', value: pension * rules.pensionSplit.premiepension, description: 'Fonderad pension som du själv kan placera' },
    { id: 'g-social', label: 'Socialförsäkringar', side: 'out', role: 'group', value: 0, description: 'Arbetsgivaravgifter som finansierar socialförsäkringarna' },
    ...socialKeys.map((k) => ({
      id: `f-${k}`,
      label: feeLabel(k)?.label ?? k,
      side: 'out' as const,
      parent: 'g-social',
      value: fee(k),
      description: feeLabel(k)?.description,
    })),
    {
      id: 'avgifter',
      label: r.kyrkoavgift > 0 ? 'Begravnings- och kyrkoavgift' : 'Begravningsavgift',
      side: 'out',
      value: r.begravningsavgift + r.kyrkoavgift,
      description: 'Till Svenska kyrkan (eller Stockholms/Tranås kommun) för begravningsverksamhet; kyrkoavgift för medlemmar',
    },
    { id: 'publicservice', label: 'Public service-avgift', side: 'out', value: r.publicService, description: 'Finansierar SVT, SR och UR' },
    { id: 'netto', label: 'Nettolön', side: 'out', role: 'balance', value: r.netto, description: 'Det du får ut efter skatt' },
  );

  return { items: items.map((i) => ({ ...i, value: i.value / divisor })), stateNet };
}

