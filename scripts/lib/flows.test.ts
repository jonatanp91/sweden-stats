import { describe, expect, it } from 'vitest';
import { buildFlow, type IncomeStatement, incomeStatementFigures } from './flows.ts';

// Riktiga värden ur SCB TAB6777 (tkr), 2024
const stockholm: IncomeStatement = {
  '010': 16939139,
  '022': -69422279,
  '024': null,
  '025': -2800231,
  '030': -55283371,
  '040': 63186966,
  '050': -5549370,
  '035': 2354225,
  '060': 3883836,
  '072': -3340543,
  '080': 2897518,
  '085': 0,
  '120': 2897518,
};

// Riktiga värden ur SCB TAB6784 (mnkr), Region Skåne 2024 – underskott
const skane: IncomeStatement = {
  '010': 12475,
  '022': -66651,
  '026': -1970,
  '030': -56146,
  '040': 39730,
  '054': 14798,
  '035': -1618,
  '060': 334,
  '072': -2891,
  '080': -4175,
  '120': -4175,
};

const sum = (flow: Record<string, number>, ids: string[]) => ids.reduce((a, id) => a + (flow[id] ?? 0), 0);

describe('buildFlow', () => {
  it('balanserar inflöden och utflöden (Stockholm, nettobetalare till utjämningen)', () => {
    const flow = buildFlow(
      stockholm,
      {
        revenueSplit: { avgifter: 3283259, hyror: 5024007 },
        costShares: { skola: 33943766, omsorg: 25451015 },
      },
      1000,
    );
    const ins = sum(flow, ['skatt', 'statsbidrag', 'avgifter', 'hyror', 'ovriga-intakter', 'fin-in', 'underskott']);
    const outs = sum(flow, ['skola', 'omsorg', 'avskrivningar', 'fin-ut', 'utjamningsavgift', 'overskott']);
    expect(Math.abs(ins - outs)).toBeLessThan(1);
    expect(flow.statsbidrag).toBeUndefined();
    expect(flow.utjamningsavgift).toBeCloseTo(5549.4, 1);
    expect(flow.overskott).toBeCloseTo(2897.5, 1);
    expect(flow.underskott).toBeUndefined();
    expect(flow.skatt).toBeCloseTo(63187, 0);
    // Kostnaderna fördelas efter andel: skola/(skola+omsorg) av 69 422 mnkr
    expect(flow.skola).toBeCloseTo((69422.279 * 33943766) / (33943766 + 25451015), 0);
    expect(flow['ovriga-intakter']).toBeCloseTo(16939.1 - 3283.3 - 5024.0, 0);
  });

  it('hanterar underskott och härledda avskrivningar (Region Skåne)', () => {
    const flow = buildFlow(skane);
    expect(flow.underskott).toBe(4175);
    expect(flow.avskrivningar).toBe(1970);
    expect(flow.statsbidrag).toBe(14798);
    expect(flow['verksamhetens-intakter']).toBe(12475);
    expect(flow.verksamhet).toBe(66651);
    const ins = sum(flow, ['skatt', 'statsbidrag', 'verksamhetens-intakter', 'fin-in', 'underskott']);
    const outs = sum(flow, ['verksamhet', 'avskrivningar', 'fin-ut']);
    expect(ins).toBe(outs);
  });

  it('kräver de obligatoriska posterna', () => {
    expect(() => buildFlow({ '010': 1 })).toThrow();
  });

  it('stoppar om intäktsdelningen är större än intäkterna', () => {
    expect(() => buildFlow(skane, { revenueSplit: { a: 20000 } })).toThrow();
  });

  it('kan skala en för stor intäktsdelning proportionellt', () => {
    let scaled = 0;
    const flow = buildFlow(skane, {
      revenueSplit: { a: 15000, b: 10000 },
      onRevenueOverflow: 'scale',
      onScaled: (f) => (scaled = f),
    });
    expect(scaled).toBeCloseTo(12475 / 25000, 5);
    expect(flow.a! + flow.b!).toBeCloseTo(12475, 0);
    expect(flow['ovriga-intakter']).toBeUndefined();
  });
});

describe('incomeStatementFigures', () => {
  // Syntetisk resultaträkning i tkr: intäkter 100, kostnader −900, avskrivningar −50, skatt 700,
  // statsbidrag 200, finansiella poster +10/−20, inga extraordinära poster
  const rr = { '010': 100, '022': -900, '030': -850, '040': 700, '035': 50, '060': 10, '072': -20, '080': 40, '120': 40 };

  it('räknar kostnader, intäkter och per invånare', () => {
    const f = incomeStatementFigures(rr, 10, 1000);
    expect(f.kostnader).toBe(1); // (900 + 50 + 20) tkr = 0,97 mnkr, avrundat till 0,1 mnkr
    expect(f['kostnad-per-inv']).toBe(97_000);
    expect(f.statsbidrag).toBeCloseTo(0.2, 6);
    expect(f['resultat-per-inv']).toBe(4_000);
    expect(f.folkmangd).toBe(10);
  });

  it('ger null när resultaträkningen är ofullständig', () => {
    const f = incomeStatementFigures({ '010': 1 }, 10, 1000);
    expect(f.kostnader).toBeNull();
    expect(f['skatt-per-inv']).toBeNull();
  });
});
