import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeTax, grundavdrag, marginalTax } from './tax';
import { buildItems } from './tax-flow';
import { TaxCalculatorDatasetSchema, type FlowYear } from './types';

// Det genererade datasetet (regler och skattesatser från Skatteverket)
const ds = TaxCalculatorDatasetSchema.parse(
  JSON.parse(readFileSync(new URL('../data/datasets/skatter-kalkylator.json', import.meta.url), 'utf8')),
);
const rules = ds.rules['2026']!;
/** Skattetabell N enligt SKV 433: N − 1,16 procentenheter kommunalskatt + 1,16 för begravnings-/kyrkoavgift. */
const table = (n: number) => ({ kommun: n - 1.16, region: 0, begravning: 1.16, kyrka: 0 });

describe('grundavdrag 2026 (Skatteverkets belopp)', () => {
  it('ger lägsta, högsta och avtagande avdrag', () => {
    expect(grundavdrag(20_000, rules)).toBe(20_000); // aldrig större än inkomsten
    expect(grundavdrag(50_000, rules)).toBe(25_100);
    expect(grundavdrag(170_000, rules)).toBe(45_600);
    expect(grundavdrag(324_000, rules)).toBe(31_600); // exempel i SKV 433
    expect(grundavdrag(1_000_000, rules)).toBe(17_400);
  });
});

describe('skatt på lön 2026', () => {
  // Skatteverkets skattetabeller för månadslön, kolumn 1 (högsta beloppet i inkomstskiktet × 12)
  it.each([
    [30, 40_000, 7_650],
    [32, 40_000, 8_151],
    [32, 80_000, 25_944],
    [34, 20_000, 3_491],
  ])('tabell %i, %i kr/mån ≈ %i kr', (n, monthly, expected) => {
    expect(Math.abs(computeTax(monthly * 12, table(n), rules).skatt / 12 - expected)).toBeLessThanOrEqual(2);
  });

  it('allmän pensionsavgift avrundas och har tak', () => {
    expect(computeTax(181_200, table(32), rules).pensionsavgift).toBe(12_700);
    expect(computeTax(2_000_000, table(32), rules).pensionsavgift).toBe(47_100);
  });

  it('arbetsgivaravgiften är 31,42 %', () => {
    const r = computeTax(480_000, table(32), rules);
    expect(r.arbetsgivaravgiftTotalt / 480_000).toBeCloseTo(0.3142, 4);
  });

  it('marginalskatten är ca 32 % under och ca 52 % över brytpunkten', () => {
    expect(marginalTax(500_000, table(32), rules)).toBeCloseTo(0.32, 1);
    expect(marginalTax(900_000, table(32), rules)).toBeCloseTo(0.52, 1);
  });
});

describe('kalkylatorns flöde', () => {
  const stockholm = ds.municipalities.find((m) => m.code === '0180')!;
  const noFlows = { kommun: null, region: null, staten: null };
  const fakeFlow = (entity: string, values: Record<string, number>): FlowYear => ({ year: '2025', values: { [entity]: values } });

  it.each([15_000, 40_000, 120_000])('balanserar för %i kr/mån', (monthly) => {
    const r = computeTax(monthly * 12, stockholm.rates['2026']!, rules);
    const flows = {
      kommun: fakeFlow('0180', { 'k-pedagogisk': 40, 'k-omsorg': 30, avskrivningar: 30 }),
      region: fakeFlow(stockholm.region, { 'r-somatisk': 70, 'r-trafik': 30 }),
      staten: fakeFlow('SE', { 'uo-06': 50, 'uo-ovriga': 50 }),
    };
    const { items } = buildItems(ds, rules, r, stockholm, flows, 1);
    const leaves = items.filter((i) => i.role !== 'group');
    const ins = leaves.filter((i) => i.side === 'in').reduce((a, i) => a + i.value, 0);
    const outs = leaves.filter((i) => i.side === 'out').reduce((a, i) => a + i.value, 0);
    expect(outs).toBeCloseTo(ins, 6);
    expect(ins).toBeGreaterThanOrEqual(r.brutto + r.arbetsgivaravgiftTotalt - 1e-6);
    for (const i of leaves) expect(i.value).toBeGreaterThanOrEqual(0);
  });

  it('visar skattereduktionerna som inflöde när statens netto är negativt', () => {
    const r = computeTax(25_000 * 12, stockholm.rates['2026']!, rules);
    const { items, stateNet } = buildItems(ds, rules, r, stockholm, noFlows, 12);
    expect(stateNet).toBeLessThan(0);
    expect(items.find((i) => i.id === 'reduktion')?.value).toBeCloseTo(-stateNet / 12, 6);
    expect(items.some((i) => i.id === 'g-staten')).toBe(false);
  });

  it('fördelar kommunens del efter budgetandelarna', () => {
    const r = computeTax(40_000 * 12, stockholm.rates['2026']!, rules);
    const flows = { ...noFlows, kommun: fakeFlow('0180', { 'k-pedagogisk': 60, 'k-omsorg': 40 }) };
    const { items } = buildItems(ds, rules, r, stockholm, flows, 1);
    expect(items.find((i) => i.id === 'k-skola')!.value).toBeCloseTo(r.kommunalskattKommun * 0.6, 6);
  });
});
