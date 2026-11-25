import { describe, expect, it } from 'vitest';
import { alignSeries, periodAxis, totalSeries } from './series';
import { axisFormatter, formatNumber, formatPeriod } from './format';
import type { Dataset } from './types';

describe('periodAxis', () => {
  it('fyller luckor mellan år så att kategoriaxeln inte drar ihop dem', () => {
    const axis = periodAxis([{ key: 'a', label: 'A', points: [{ t: '1771', v: 1 }, { t: '1774', v: 2 }] }]);
    expect(axis).toEqual(['1771', '1772', '1773', '1774']);
  });

  it('hanterar månader över årsskifte', () => {
    const axis = periodAxis([{ key: 'a', label: 'A', points: [{ t: '2023-11', v: 1 }, { t: '2024-02', v: 2 }] }]);
    expect(axis).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
  });

  it('slår ihop perioder från flera serier', () => {
    const axis = periodAxis([
      { key: 'a', label: 'A', points: [{ t: '2000', v: 1 }] },
      { key: 'b', label: 'B', points: [{ t: '2002', v: 1 }] },
    ]);
    expect(axis).toEqual(['2000', '2001', '2002']);
  });
});

describe('alignSeries / totalSeries', () => {
  const ds = {
    series: [
      { key: 'a', label: 'A', points: [{ t: '2000', v: 1 }, { t: '2001', v: 2 }] },
      { key: 'b', label: 'B', points: [{ t: '2001', v: 5 }] },
    ],
  } as Dataset;

  it('lägger ut null där värde saknas', () => {
    expect(alignSeries(ds.series[1]!, ['2000', '2001'])).toEqual([null, 5]);
  });

  it('summerar serier per period', () => {
    expect(totalSeries(ds).points).toEqual([
      { t: '2000', v: 1 },
      { t: '2001', v: 7 },
    ]);
  });
});

describe('format', () => {
  // sv-SE använder hårt mellanslag (U+00A0) som tusentalsavgränsare
  const norm = (s: string) => s.replace(/ /g, ' ').replace(/−/g, '-');

  it('formaterar tal på svenska', () => {
    expect(norm(formatNumber(10605529))).toBe('10 605 529');
    expect(norm(formatNumber(9.87, 1))).toBe('9,9');
  });

  it('formaterar perioder', () => {
    expect(formatPeriod('2024-03')).toBe('mar 2024');
    expect(formatPeriod('2024K2')).toBe('kv2 2024');
    expect(formatPeriod('1990')).toBe('1990');
  });

  it('använder samma stil för hela axeln', () => {
    const f = axisFormatter(12_000_000);
    expect([0, 3e6, 4.5e6, 12e6].map((v) => norm(f(v)))).toEqual(['0', '3 mn', '4,5 mn', '12 mn']);
    const g = axisFormatter(8000);
    expect([0, 5000, 7500].map((v) => norm(g(v)))).toEqual(['0', '5 000', '7 500']);
  });
});
