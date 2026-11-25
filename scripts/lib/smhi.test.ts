import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { annualMeans, parseSmhiMonthlyCsv, trailingMean } from './smhi.ts';

// Början av SMHI:s riktiga fil för Lund (53430), parameter 22: hela 1753–1754 och jan–mar 1755
const csv = readFileSync(new URL('../fixtures/smhi-lund-sample.csv', import.meta.url), 'utf8');

describe('parseSmhiMonthlyCsv', () => {
  const { stationName, rows } = parseSmhiMonthlyCsv(csv);

  it('läser stationsnamn och månadsrader', () => {
    expect(stationName).toBe('Lund');
    expect(rows).toHaveLength(27);
    expect(rows[0]).toEqual({ month: '1753-01', value: -1.8, quality: 'G' });
  });

  it('räknar årsmedel bara för hela år', () => {
    const annual = annualMeans(rows);
    expect(annual.map((a) => a.year)).toEqual(['1753', '1754']);
    const m1753 = rows.filter((r) => r.month.startsWith('1753')).reduce((a, r) => a + r.value, 0) / 12;
    expect(annual[0]!.value).toBeCloseTo(m1753, 2);
  });
});

describe('trailingMean', () => {
  it('kräver ett fullt och sammanhängande fönster', () => {
    const pts = [
      { t: '2000', v: 1 },
      { t: '2001', v: 2 },
      { t: '2002', v: 3 },
      { t: '2010', v: 10 },
      { t: '2011', v: 11 },
      { t: '2012', v: 12 },
    ];
    expect(trailingMean(pts, 3).map((p) => p.v)).toEqual([null, null, 2, null, null, 11]);
  });
});
