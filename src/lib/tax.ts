/**
 * Skatt på lön för en person under 66 år – ren beräkning enligt inkomstskattelagen (IL) och
 * socialavgiftslagen. Alla belopp och procentsatser kommer från `TaxRules` (genereras av hämtaren
 * scripts/datasets/skattekalkyl.ts och kontrolleras där mot Skatteverkets skattetabeller).
 *
 * Beräkningen följer Skatteverkets tekniska beskrivning av skattetabellerna (SKV 433).
 * Förenklingar: endast lön (inga andra inkomster eller avdrag), helt år, obegränsat skattskyldig,
 * arbetsgivaravgift för den som är född 1959–2002.
 */

import type { LocalRates, TaxRules } from './types';

export type { LocalRates, TaxRules };

export interface TaxResult {
  brutto: number;
  grundavdrag: number;
  beskattningsbar: number;
  kommunalskattKommun: number;
  kommunalskattRegion: number;
  begravningsavgift: number;
  kyrkoavgift: number;
  publicService: number;
  statligSkatt: number;
  pensionsavgift: number;
  reduktionPension: number;
  jobbskatteavdrag: number;
  reduktionForvarv: number;
  /** Skatt som dras på lönen (preliminärskatt), efter skattereduktioner. */
  skatt: number;
  netto: number;
  /** Arbetsgivaravgifter per del (nyckel → kr). */
  arbetsgivaravgifter: Record<string, number>;
  /** Ålderspensionsavgift på lön över taket (går till statsbudgeten). */
  alderspensionOverTak: number;
  arbetsgivaravgiftTotalt: number;
}

const down100 = (x: number) => Math.floor(x / 100) * 100;
const up100 = (x: number) => Math.ceil(x / 100) * 100;
/** Avrundning till närmaste hundratal, där 50 avrundas nedåt (som för allmän pensionsavgift). */
const round100 = (x: number) => Math.ceil(x / 100 - 0.5) * 100;

/** Grundavdrag för fastställd förvärvsinkomst `ffi` (IL 63:3), avrundat uppåt till hundratal. */
export function grundavdrag(ffi: number, r: TaxRules): number {
  const g = r.grundavdrag;
  const p = r.pbb;
  let ga: number;
  if (ffi <= g.lowLimit * p) ga = g.low * p;
  else if (ffi <= g.midStart * p) ga = g.low * p + g.upRate * (ffi - g.lowLimit * p);
  else if (ffi <= g.highStart * p) ga = g.mid * p;
  else if (ffi <= g.highEnd * p) ga = g.mid * p - g.downRate * (ffi - g.highStart * p);
  else ga = g.high * p;
  return Math.min(up100(ga), ffi);
}

/** Jobbskatteavdrag (IL 67:7) före begränsning mot skatten. `ki` = kommunal skattesats som andel. */
export function jobbskatteavdrag(ai: number, ga: number, ki: number, r: TaxRules): number {
  const j = r.jobbskatteavdrag;
  const p = r.pbb;
  let x: number;
  if (ai <= j.step1 * p) x = ai;
  else if (ai <= j.step2 * p) x = j.step1 * p + j.rate2 * (ai - j.step1 * p);
  else if (ai <= j.step3 * p) x = j.base3 * p + j.rate3 * (ai - j.step2 * p);
  else x = j.max * p;
  return Math.max(0, Math.floor((x - ga) * ki));
}

/** Beräknar skatt och avgifter på en årslön. */
export function computeTax(bruttoAr: number, rates: LocalRates, r: TaxRules, churchMember = false): TaxResult {
  const brutto = Math.max(0, bruttoAr);
  const ffi = down100(brutto);
  const ga = grundavdrag(ffi, r);
  const ti = down100(Math.max(0, ffi - ga));
  const ki = (rates.kommun + rates.region) / 100;

  const kommunalskattKommun = (ti * rates.kommun) / 100;
  const kommunalskattRegion = (ti * rates.region) / 100;
  const kommunal = kommunalskattKommun + kommunalskattRegion;
  const begravningsavgift = (ti * rates.begravning) / 100;
  const kyrkoavgift = churchMember ? (ti * rates.kyrka) / 100 : 0;
  const publicService = Math.floor(Math.min(ti, r.publicService.capIbb * r.ibb) * r.publicService.rate);
  const statligSkatt = Math.max(0, ti - r.skiktgrans) * r.statligSkatt;

  const pa = r.pensionsavgift;
  const pensionsavgift =
    ffi < pa.minPbb * r.pbb ? 0 : round100(Math.min(ffi, pa.capIbb * r.ibb) * pa.rate);

  // Skattereduktioner i lagens ordning (IL 67:2): pensionsavgift (mot kommunal + statlig skatt),
  // jobbskatteavdrag och förvärvsinkomst (endast mot kommunal inkomstskatt).
  const reduktionPension = Math.min(pensionsavgift, kommunal + statligSkatt);
  let kommunalKvar = kommunal - Math.max(0, reduktionPension - statligSkatt);
  const jsa = Math.min(jobbskatteavdrag(down100(brutto), ga, ki, r), kommunalKvar);
  kommunalKvar -= jsa;
  const f = r.forvarvsreduktion;
  const forv = ti > f.lower ? Math.min(f.rate * (Math.min(ti, f.upper) - f.lower), kommunalKvar) : 0;

  const skatt =
    kommunal +
    statligSkatt +
    begravningsavgift +
    kyrkoavgift +
    publicService +
    pensionsavgift -
    reduktionPension -
    jsa -
    Math.max(0, forv);

  const cap = r.pensionCapIbb * r.ibb;
  const arbetsgivaravgifter: Record<string, number> = {};
  let alderspensionOverTak = 0;
  for (const fee of r.arbetsgivaravgifter) {
    if (fee.key === 'alderspension') {
      arbetsgivaravgifter[fee.key] = Math.min(brutto, cap) * fee.rate;
      alderspensionOverTak = Math.max(0, brutto - cap) * fee.rate;
    } else {
      arbetsgivaravgifter[fee.key] = brutto * fee.rate;
    }
  }
  const arbetsgivaravgiftTotalt = Object.values(arbetsgivaravgifter).reduce((a, x) => a + x, 0) + alderspensionOverTak;

  return {
    brutto,
    grundavdrag: ga,
    beskattningsbar: ti,
    kommunalskattKommun,
    kommunalskattRegion,
    begravningsavgift,
    kyrkoavgift,
    publicService,
    statligSkatt,
    pensionsavgift,
    reduktionPension,
    jobbskatteavdrag: jsa,
    reduktionForvarv: Math.max(0, forv),
    skatt,
    netto: brutto - skatt,
    arbetsgivaravgifter,
    alderspensionOverTak,
    arbetsgivaravgiftTotalt,
  };
}

/** Marginalskatt: andel av en löneökning (100 kr/mån) som går till skatt. */
export function marginalTax(bruttoAr: number, rates: LocalRates, r: TaxRules, churchMember = false): number {
  const step = 1200;
  const a = computeTax(bruttoAr, rates, r, churchMember).skatt;
  const b = computeTax(bruttoAr + step, rates, r, churchMember).skatt;
  return (b - a) / step;
}
