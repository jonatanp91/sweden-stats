import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildDataUrl, jsonStatToRecords, normalizePeriod, scbProductUrl, type JsonStat2 } from './pxweb.ts';

// Riktigt svar från SCB: TAB5644, Vattenkraft + Kärnkraft, jan–mar 2024
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/scb-tab5644-sample.json', import.meta.url), 'utf8'),
) as JsonStat2;

describe('jsonStatToRecords', () => {
  const records = jsonStatToRecords(fixture);

  it('ger en post per cell', () => {
    expect(records).toHaveLength(6);
  });

  it('mappar värden i radmajor-ordning (sista dimensionen varierar snabbast)', () => {
    const vatten = records.filter((r) => r.codes.Produktionsslag === 'Vattenkraft');
    expect(vatten.map((r) => r.codes.Tid)).toEqual(['2024M01', '2024M02', '2024M03']);
    expect(vatten.map((r) => r.value)).toEqual([6559, 5993, 6545]);
    const karn = records.filter((r) => r.codes.Produktionsslag === 'Karnkraft');
    expect(karn.map((r) => r.value)).toEqual([4609, 4652, 4819]);
  });

  it('tar med etiketter', () => {
    expect(records[0]!.labels.Produktionsslag).toMatch(/vattenkraft/);
  });

  it('hanterar null-värden och värden som objekt (gles JSON-stat)', () => {
    const sparse: JsonStat2 = {
      ...fixture,
      value: { '0': 1, '5': 2 },
    };
    const r = jsonStatToRecords(sparse);
    expect(r.map((x) => x.value)).toEqual([1, null, null, null, null, 2]);
  });
});

describe('hjälpfunktioner', () => {
  it('normaliserar SCB:s tidskoder', () => {
    expect(normalizePeriod('2024M03')).toBe('2024-03');
    expect(normalizePeriod('2024K1')).toBe('2024K1');
    expect(normalizePeriod('2024')).toBe('2024');
  });

  it('bygger publik produktlänk från infofile', () => {
    expect(scbProductUrl(fixture)).toBe('https://www.scb.se/EN0108/');
  });

  it('bygger data-URL med urval', () => {
    const u = buildDataUrl('TAB4365', { Kon: ['1+2'], Tid: '*' });
    expect(u).toContain('/tables/TAB4365/data?');
    expect(u).toContain('valueCodes[Kon]=1%2B2');
    expect(u).toContain('valueCodes[Tid]=*');
    expect(u).toContain('outputFormat=json-stat2');
  });
});
