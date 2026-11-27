/**
 * Poster i skattekalkylatorns Sankey (src/components/TaxSankey.tsx): ren funktion så att balansen kan testas.
 * Utan mittnod: tre källor går direkt till mottagarna (`from`), så att det syns vad som betalas av lönen och vad
 * som betalas av arbetsgivaravgifterna.
 *   Bruttolön            → nettolön, kommunen, regionen, staten (statlig skatt), begravnings-/kyrkoavgift, public service
 *   Arbetsgivaravgifter  → pension (ålderspensionsavgift), socialförsäkringar, staten (löneavgift + avgift över taket)
 *   Skattereduktioner    → pension (reduktionen för allmän pensionsavgift betalar avgiften), nettolön (jobbskatteavdrag m.m.)
 * Den allmänna pensionsavgiften dras formellt på lönen men kompenseras fullt av en skattereduktion; den visas därför
 * som finansierad av skattereduktionerna (resten – bara vid mycket låga inkomster – från bruttolönen).
 * Staten visas brutto; statens netto = brutto − skattereduktioner.
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
  stateGross: number;
  reductions: number;
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
  const stateFromAg = fee('loneavgift') + r.alderspensionOverTak;
  const stateGross = r.statligSkatt + stateFromAg;
  const pension = fee('alderspension') + r.pensionsavgift;
  const socialKeys = rules.arbetsgivaravgifter.map((f) => f.key).filter((k) => k !== 'alderspension' && k !== 'loneavgift');
  const social = socialKeys.reduce((a, k) => a + fee(k), 0);
  const fees = r.begravningsavgift + r.kyrkoavgift;
  // Allmän pensionsavgift: den del som täcks av skattereduktionen visas som finansierad av staten
  const pensionFromReduction = Math.min(r.reduktionPension, r.pensionsavgift);
  const pensionFromBrutto = r.pensionsavgift - pensionFromReduction;
  const reductionsToNetto = reductions - pensionFromReduction;
  // Nettolön som kommer direkt ur bruttolönen (före jobbskatteavdrag och förvärvsreduktion)
  const nettoFromBrutto = r.netto - reductionsToNetto;

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
  if (reductions > 0) {
    items.push({
      id: 'reduktion',
      label: 'Skattereduktioner (betalas av staten)',
      side: 'in',
      value: reductions,
      description:
        'Betalas av staten. Skattereduktionen för allmän pensionsavgift (100 % av avgiften) betalar din del av pensionsavgiften; jobbskatteavdraget och skattereduktionen för förvärvsinkomst höjer din nettolön. Kommunen och regionen får ändå hela kommunalskatten.',
    });
  }

  items.push(
    {
      id: 'g-kommun',
      label: kommun.name,
      side: 'out',
      role: 'group',
      value: 0,
      description: 'Kommunalskatt till kommunen',
      from: { brutto: r.kommunalskattKommun },
    },
    ...breakdownItems(ds.breakdowns.kommun, flows.kommun, kommun.code, r.kommunalskattKommun, 'k', 'g-kommun'),
    {
      id: 'g-region',
      label: kommun.regionName,
      side: 'out',
      role: 'group',
      value: 0,
      description: 'Regionskatt (kommunal inkomstskatt till regionen)',
      from: { brutto: r.kommunalskattRegion },
    },
    ...breakdownItems(ds.breakdowns.region, flows.region, kommun.region, r.kommunalskattRegion, 'r', 'g-region'),
    {
      id: 'g-staten',
      label: 'Staten (statlig skatt och allmän löneavgift)',
      side: 'out',
      role: 'group',
      value: 0,
      description:
        'Statlig inkomstskatt (från lönen, över brytpunkten) samt allmän löneavgift och ålderspensionsavgift över taket (från arbetsgivaravgifterna). Löneavgiften är en skatt utan koppling till förmåner och går till statsbudgeten. Nästa steg fördelar beloppet efter hur statsbudgeten används (utgiftsområden) – skatter är inte öronmärkta. Staten betalar i sin tur skattereduktionerna.',
      from: { brutto: r.statligSkatt, ag: stateFromAg },
    },
    ...breakdownItems(ds.breakdowns.staten, flows.staten, 'SE', stateGross, 's', 'g-staten'),
    {
      id: 'g-pension',
      label: 'Pensionssystemet',
      side: 'out',
      role: 'group',
      value: 0,
      description:
        'Ålderspensionsavgift (arbetsgivaren, 10,21 %) och allmän pensionsavgift (7 % av lönen – dras formellt på lönen men betalas i praktiken av staten via en lika stor skattereduktion). Blir din framtida allmänna pension.',
      from: { brutto: pensionFromBrutto, ag: fee('alderspension'), reduktion: pensionFromReduction },
    },
    { id: 'p-inkomst', label: 'Inkomstpension', side: 'out', parent: 'g-pension', value: pension * rules.pensionSplit.inkomstpension, description: 'Fördelningssystemet (AP-fonderna)' },
    { id: 'p-premie', label: 'Premiepension', side: 'out', parent: 'g-pension', value: pension * rules.pensionSplit.premiepension, description: 'Fonderad pension som du själv kan placera' },
    {
      id: 'g-social',
      label: 'Socialförsäkringar',
      side: 'out',
      role: 'group',
      value: 0,
      description: 'Arbetsgivaravgifter som finansierar socialförsäkringarna',
      from: { ag: social },
    },
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
      value: fees,
      description: 'Till Svenska kyrkan (eller Stockholms/Tranås kommun) för begravningsverksamhet; kyrkoavgift för medlemmar',
      from: { brutto: fees },
    },
    {
      id: 'publicservice',
      label: 'Public service-avgift',
      side: 'out',
      value: r.publicService,
      description: 'Finansierar SVT, SR och UR',
      from: { brutto: r.publicService },
    },
    {
      id: 'netto',
      label: 'Nettolön',
      side: 'out',
      role: 'balance',
      value: r.netto,
      description: 'Det du får ut efter skatt',
      from: { brutto: nettoFromBrutto, reduktion: reductionsToNetto },
    },
  );

  const scale = (x: number) => x / divisor;
  return {
    items: items.map((i) => ({
      ...i,
      value: scale(i.value),
      ...(i.from ? { from: Object.fromEntries(Object.entries(i.from).map(([k, v]) => [k, scale(v)])) } : {}),
    })),
    stateGross,
    reductions,
    stateNet: stateGross - reductions,
  };
}
