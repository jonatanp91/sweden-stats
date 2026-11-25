import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INCOME_ITEMS,
  OTHER_UO,
  parseDecimal,
  parseSemicolonCsv,
  placeStateItems,
  signedStateItems,
  toExpenseRows,
  toIncomeRows,
  uoNodeId,
} from './statskontoret.ts';

// Riktiga utdrag ur Statskontorets årsutfall: samtliga rader för 2025
const read = (f: string) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8');
const income = toIncomeRows(parseSemicolonCsv(read('statskontoret-inkomster-2025.csv')));
const expense = toExpenseRows(parseSemicolonCsv(read('statskontoret-utgifter-2025.csv')));

describe('CSV-tolkning', () => {
  it('hanterar BOM, semikolon, citattecken och decimalkomma', () => {
    const rows = parseSemicolonCsv('﻿A;B\n"x;y";1234,5\n');
    expect(rows).toEqual([{ A: 'x;y', B: '1234,5' }]);
    expect(parseDecimal('1234,5')).toBe(1234.5);
    expect(parseDecimal('')).toBe(0);
    expect(() => parseDecimal('abc')).toThrow();
  });

  it('läser de riktiga filerna', () => {
    expect(income.length).toBeGreaterThan(100);
    expect(expense.length).toBeGreaterThan(100);
    expect(income[0]!.year).toBe('2025');
  });
});

describe('statens flöde 2025', () => {
  const top = new Set(['06', '25', '10']);
  const share = 0.63;
  const { items, saldo, budgetIncome, budgetExpense } = signedStateItems(income, expense, '2025', top, share);
  const sides = new Map<string, 'in' | 'out'>([
    ...INCOME_ITEMS.map((i) => [i.id, i.side] as const),
    ...['06', '25', '10'].map((uo) => [uoNodeId(uo), 'out'] as const),
    [OTHER_UO, 'out'],
    ['rgk-nettoutlaning', 'out'],
    ['kassamassig', 'out'],
  ]);
  const values = placeStateItems(items, saldo, sides);
  const sideOf = (id: string) => (id === 'budgetunderskott' ? 'in' : id === 'budgetoverskott' ? 'out' : id.endsWith('-motsatt') ? (sides.get(id.replace('-motsatt', '')) === 'in' ? 'out' : 'in') : sides.get(id));

  it('saldot = statsbudgetens inkomster − utgifter', () => {
    const totalIncome = income.reduce((a, r) => a + r.utfall, 0);
    // Statsbudgetens inkomster 2025 enligt filen: ca 1 304 mdkr
    expect(totalIncome / 1000).toBeCloseTo(1303.9, 0);
    expect(saldo).toBeLessThan(0);
    expect(values.budgetunderskott).toBeCloseTo(-saldo, 0);
  });

  it('balanserar inflöden och utflöden', () => {
    let ins = 0;
    let outs = 0;
    for (const [id, v] of Object.entries(values)) {
      expect(v).toBeGreaterThan(0);
      if (sideOf(id) === 'in') ins += v;
      else outs += v;
    }
    expect(Math.abs(ins - outs)).toBeLessThan(1);
  });

  it('visar vidareföringen per mottagare och skatterna brutto', () => {
    // Avgående poster (1700 + 1800) 2025 ≈ 1 333 mdkr
    const vf = values['vf-kommuner']! + values['vf-regioner']! + values['vf-pension']! + values['vf-eu']!;
    expect(vf / 1000).toBeCloseTo(1332.7, 0);
    // 1811 kommunala skatter delas efter kommunandelen; summan bevaras
    expect((values['vf-kommuner']! + values['vf-regioner']!) / 1000).toBeCloseTo(984.5, 0);
    expect(values['vf-kommuner']! / (values['vf-kommuner']! + values['vf-regioner']!)).toBeCloseTo(share, 3);
    expect(values['vf-pension']! / 1000).toBeCloseTo(339.2, 0);
    expect(values['vf-eu']! / 1000).toBeCloseTo(9.1, 0);
    expect(values['skatt-arbete-indirekt']! / 1000).toBeCloseTo(781.9, 0);
  });

  it('statsbudgetens inkomster och utgifter ger saldot', () => {
    expect(budgetIncome - budgetExpense).toBeCloseTo(saldo, 6);
    expect(budgetIncome / 1000).toBeCloseTo(1303.9, 0);
  });

  it('kräver en giltig kommunandel', () => {
    expect(() => signedStateItems(income, expense, '2025', top, 1.2)).toThrow();
  });

  it('flyttar negativa poster till motsatt sida', () => {
    // Riksgäldens nettoutlåning var negativ 2025 → visas som inflöde
    expect(values['rgk-nettoutlaning']).toBeUndefined();
    expect(values['rgk-nettoutlaning-motsatt']).toBeCloseTo(946, 0);
  });

  it('slår ihop övriga utgiftsområden', () => {
    const allAreas = expense.filter((r) => r.uo).reduce((a, r) => a + r.utfall, 0);
    const shown = values[uoNodeId('06')]! + values[uoNodeId('25')]! + values[uoNodeId('10')]! + values[OTHER_UO]!;
    expect(shown).toBeCloseTo(allAreas, -1);
  });
});
