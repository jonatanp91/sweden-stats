/**
 * Skattekalkylator – vart går skatten på min lön? Producerar: skatter-kalkylator
 *
 * - Regler (belopp och procentsatser) per inkomstår står nedan med källa: Skatteverkets "Belopp och procent",
 *   inkomstskattelagen (IL) och Skatteverkets tekniska beskrivning av skattetabellerna (SKV 433).
 * - Skattesatser per kommun (kommunalskatt, regionskatt, begravnings- och kyrkoavgift) hämtas från
 *   Skatteverkets öppna data och stäms av mot SCB:s skattesatser (TAB2017, via skatter-kommuner).
 * - KONTROLL: beräkningen i src/lib/tax.ts jämförs med Skatteverkets skattetabeller (kolumn 1) för alla
 *   inkomstskikt upp till 200 000 kr/mån i flera tabeller. Avvikelser större än 2 kr/mån stoppar hämtningen.
 * - Andra steget (vad kommunen/regionen/staten använder pengarna till) använder andelar ur flödesdataseten,
 *   så hämtarna `skatter` och `staten` ska ha körts först (de ligger före i scripts/datasets/index.ts).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeTax } from '../../src/lib/tax.ts';
import {
  FlowDatasetSchema,
  FlowYearSchema,
  RegionalDatasetSchema,
  RegionalYearSchema,
  type Breakdown,
  type FlowDataset,
  type LocalRates,
  type Source,
  type TaxRules,
} from '../../src/lib/types.ts';
import type { Fetcher } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import { fetchWithRetry } from '../lib/http.ts';
import { DATASETS_DIR, PUBLIC_DIR } from '../lib/write-dataset.ts';

const ROWSTORE = 'https://skatteverket.entryscape.net/rowstore/dataset';
const RATES_DATASET = `${ROWSTORE}/c67b320b-ffee-4876-b073-dd9236cd2a99`;
const TABLES_DATASET = `${ROWSTORE}/88320397-5c32-4c16-ae79-d36d95b17b95`;
const SKV_LICENSE = 'CC0 1.0 (Skatteverkets öppna data)';
const SKV_RULES_PAGE: Record<string, string> = {
  '2026': 'https://www.skatteverket.se/privat/skatter/beloppochprocent/2026.4.1522bf3f19aea8075ba21.html',
};
const SKV_433: Record<string, string> = {
  '2026': 'https://www.skatteverket.se/download/18.1522bf3f19aea8075ba55c/1766385913260/teknisk-beskrivning-skv-433-2026-utgava-36.pdf',
};
const IL_URL = 'https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/inkomstskattelag-19991229_sfs-1999-1229/';

/** Begravnings- och kyrkoavgift ingår i skattetabellernas nummer med 1,16 procentenheter (SKV 433 avsnitt 7.3). */
const TABLE_FEE_POINTS = 1.16;
const CHECK_TABLES = ['29', '32', '35', '38'];
const CHECK_TOLERANCE = 2; // kr per månad

/**
 * Regler per inkomstår. Källor:
 *  - Prisbasbelopp, inkomstbasbelopp, skiktgräns, allmän pensionsavgift, arbetsgivaravgifter: Skatteverket,
 *    "Belopp och procent" för året.
 *  - Grundavdrag: IL 63 kap. 3 §. Jobbskatteavdrag: IL 67 kap. 7 § (lydelse SFS 2025:1376).
 *    Skattereduktion för förvärvsinkomster: IL 67 kap. 46–47 §§.
 *  - Public service-avgift och avrundningsregler: SKV 433 (2026), avsnitt 7.
 *  - Pensionsrättens fördelning (16 + 2,5 procent av den pensionsgrundande inkomsten): socialförsäkringsbalken
 *    62–64 kap.
 */
const RULES: Record<string, TaxRules> = {
  '2026': {
    year: '2026',
    pbb: 59_200,
    ibb: 83_400,
    grundavdrag: { lowLimit: 0.99, low: 0.423, upRate: 0.2, midStart: 2.72, mid: 0.77, highStart: 3.11, downRate: 0.1, highEnd: 7.88, high: 0.293 },
    jobbskatteavdrag: { step1: 0.91, step2: 3.24, step3: 8.08, rate2: 0.3874, base3: 1.813, rate3: 0.251, max: 3.027 },
    forvarvsreduktion: { lower: 40_000, upper: 240_000, rate: 0.0075 },
    skiktgrans: 643_000,
    statligSkatt: 0.2,
    pensionsavgift: { rate: 0.07, capIbb: 8.07, minPbb: 0.423 },
    publicService: { rate: 0.01, capIbb: 1.42 },
    pensionCapIbb: 8.07,
    pensionSplit: { inkomstpension: 16 / 18.5, premiepension: 2.5 / 18.5 },
    arbetsgivaravgifter: [
      { key: 'alderspension', label: 'Ålderspensionsavgift', rate: 0.1021, description: 'Finansierar inkomst- och premiepensionen' },
      { key: 'sjukforsakring', label: 'Sjukförsäkring', rate: 0.0355, description: 'Sjukpenning, sjuk- och aktivitetsersättning' },
      { key: 'foraldraforsakring', label: 'Föräldraförsäkring', rate: 0.02, description: 'Föräldrapenning m.m.' },
      { key: 'arbetsmarknad', label: 'Arbetslöshetsförsäkring m.m.', rate: 0.0264, description: 'Arbetsmarknadsavgiften: arbetslöshetsersättning och lönegaranti' },
      { key: 'efterlevande', label: 'Efterlevandepension', rate: 0.003, description: 'Pension till efterlevande' },
      { key: 'arbetsskada', label: 'Arbetsskadeförsäkring', rate: 0.001, description: 'Ersättning vid arbetsskada' },
      { key: 'loneavgift', label: 'Allmän löneavgift', rate: 0.1262, description: 'En skatt utan koppling till förmåner – går till statsbudgeten' },
    ],
  },
};

interface RateRow {
  år: string;
  'församlings-kod': string;
  kommun: string;
  'kommunal-skatt': string;
  'landstings-skatt': string;
  'begravnings-avgift': string;
  kyrkoavgift: string;
}

async function fetchAllRows<T>(url: string): Promise<T[]> {
  const rows: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const res = (await (await fetchWithRetry(next)).json()) as { results: T[]; next?: string };
    rows.push(...res.results);
    next = res.next;
    if (rows.length > 20_000) throw new Error(`För många rader från ${url}`);
  }
  return rows;
}

const num = (s: string) => {
  const n = Number(String(s).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Ogiltigt tal "${s}"`);
  return n;
};
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Skattesatser per kommun (kommunkod = de fyra första siffrorna i församlingskoden). */
async function fetchRates(year: string): Promise<{ rates: Map<string, LocalRates>; apiUrl: string }> {
  const apiUrl = `${RATES_DATASET}?${new URLSearchParams({ år: year, _limit: '500' })}`;
  const rows = await fetchAllRows<RateRow>(apiUrl);
  if (rows.length === 0) throw new Error(`Skatteverket har inga skattesatser för ${year}`);
  const byKommun = new Map<string, RateRow[]>();
  for (const r of rows) {
    const code = r['församlings-kod'].replace(/\s+/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(code)) throw new Error(`Oväntad församlingskod "${r['församlings-kod']}"`);
    byKommun.set(code, [...(byKommun.get(code) ?? []), r]);
  }
  const rates = new Map<string, LocalRates>();
  for (const [code, list] of byKommun) {
    const kommun = new Set(list.map((r) => num(r['kommunal-skatt'])));
    const region = new Set(list.map((r) => num(r['landstings-skatt'])));
    if (kommun.size !== 1 || region.size !== 1) throw new Error(`Kommun ${code}: olika skattesatser mellan församlingar`);
    rates.set(code, {
      kommun: [...kommun][0]!,
      region: [...region][0]!,
      // Begravnings- och kyrkoavgift varierar mellan församlingar: kommunens medelvärde
      begravning: r3(mean(list.map((r) => num(r['begravnings-avgift'])))),
      kyrka: r3(mean(list.map((r) => num(r.kyrkoavgift)))),
    });
  }
  return { rates, apiUrl };
}

/** Jämför beräkningen med Skatteverkets skattetabeller (kolumn 1, månadslön). */
async function checkAgainstTables(rules: TaxRules): Promise<{ apiUrl: string; rows: number; worst: number }> {
  let worst = 0;
  let count = 0;
  let firstUrl = '';
  for (const tab of CHECK_TABLES) {
    const apiUrl = `${TABLES_DATASET}?${new URLSearchParams({ år: rules.year, tabellnr: tab, 'antal dgr': '30B', _limit: '500' })}`;
    firstUrl ||= apiUrl;
    const rows = await fetchAllRows<Record<string, string>>(apiUrl);
    if (rows.length < 100) throw new Error(`Skattetabell ${tab} ${rules.year}: för få rader (${rows.length})`);
    const local = { kommun: Number(tab) - TABLE_FEE_POINTS, region: 0, begravning: TABLE_FEE_POINTS, kyrka: 0 };
    for (const r of rows) {
      const to = num(r['inkomst t.o.m.']);
      if (to > 200_000 || !r['kolumn 1']) continue;
      // Tabellerna räknas på det högsta beloppet i varje inkomstskikt × 12 (SKV 433 avsnitt 7)
      const calc = computeTax(to * 12, local, rules).skatt / 12;
      const diff = calc - num(r['kolumn 1']);
      count++;
      if (Math.abs(diff) > Math.abs(worst)) worst = diff;
      if (Math.abs(diff) > CHECK_TOLERANCE) {
        throw new Error(
          `Skatteberäkningen avviker från Skatteverkets tabell ${tab} (${rules.year}) vid ${to} kr/mån: ${calc.toFixed(0)} ≠ ${r['kolumn 1']}`,
        );
      }
    }
  }
  return { apiUrl: firstUrl, rows: count, worst };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readFlow(id: string) {
  const meta = FlowDatasetSchema.parse(await readJson(join(DATASETS_DIR, `${id}.json`)));
  const year = meta.years[meta.years.length - 1]!;
  const data = FlowYearSchema.parse(await readJson(join(PUBLIC_DIR, meta.dataPath, `${year}.json`)));
  return { meta, year, data };
}

const outLeaves = (meta: FlowDataset) => meta.nodes.filter((n) => n.side === 'out' && !n.role).map((n) => n.id);

export const skattekalkyl: Fetcher = {
  name: 'skattekalkyl',
  produces: ['skatter-kalkylator'],
  async run() {
    const years = Object.keys(RULES).sort();
    const latest = years[years.length - 1]!;

    // --- Kommuner (namn, län) och skattesatser enligt SCB för avstämning ---
    const kommunMeta = RegionalDatasetSchema.parse(await readJson(join(DATASETS_DIR, 'skatter-kommuner.json')));
    const regionFlow = await readFlow('skatter-region-flode');
    const kommunFlow = await readFlow('skatter-kommun-flode');
    const stateFlow = await readFlow('skatter-staten-flode');

    const ratesByYear = new Map<string, Map<string, LocalRates>>();
    const rateUrls: string[] = [];
    for (const y of years) {
      const { rates, apiUrl } = await fetchRates(y);
      rateUrls.push(apiUrl);
      // Avstämning mot SCB (TAB2017) om SCB har året
      if (kommunMeta.years.includes(y)) {
        const scb = RegionalYearSchema.parse(await readJson(join(PUBLIC_DIR, kommunMeta.dataPath, `${y}.json`)));
        for (const k of kommunMeta.regions) {
          const own = rates.get(k.code);
          const v = scb.values[k.code];
          if (!own) throw new Error(`Skatteverket saknar skattesatser för ${k.code} ${k.name} ${y}`);
          if (
            Math.abs(own.kommun - (v?.['skattesats-kommun'] ?? NaN)) > 0.005 ||
            Math.abs(own.region - (v?.['skattesats-region'] ?? NaN)) > 0.005
          ) {
            throw new Error(`Skattesatserna för ${k.name} ${y} skiljer sig mellan Skatteverket och SCB`);
          }
        }
        console.log(`  ${y}: skattesatser för ${rates.size} kommuner stämmer med SCB`);
      }
      ratesByYear.set(y, rates);
    }

    // --- Kontroll mot Skatteverkets skattetabeller ---
    const checks = [];
    for (const y of years) {
      const c = await checkAgainstTables(RULES[y]!);
      console.log(`  ${y}: ${c.rows} inkomstskikt i ${CHECK_TABLES.length} skattetabeller, största avvikelse ${c.worst.toFixed(1)} kr/mån`);
      checks.push(c);
    }

    // --- Region för varje kommun (regionflödets enhetskod börjar med länskoden) ---
    const regionFor = (kommunCode: string) => {
      const e = regionFlow.meta.entities.find((x) => x.code !== '00' && x.code.slice(0, 2) === kommunCode.slice(0, 2));
      if (!e) throw new Error(`Ingen region för kommun ${kommunCode}`);
      return e;
    };

    const municipalities = kommunMeta.regions.map((k) => {
      const reg = regionFor(k.code);
      return {
        code: k.code,
        name: k.name,
        group: k.group,
        region: reg.code,
        regionName: reg.name,
        rates: Object.fromEntries(years.map((y) => [y, ratesByYear.get(y)!.get(k.code)!])),
      };
    });

    // --- Andra steget: fördelning efter budgetandelar ---
    const kommunBreakdown: Breakdown = {
      dataPath: kommunFlow.meta.dataPath,
      year: kommunFlow.year,
      include: outLeaves(kommunFlow.meta),
      groups: [
        { id: 'skola', label: 'Förskola och skola', nodes: ['k-pedagogisk'] },
        { id: 'omsorg', label: 'Äldreomsorg, LSS och socialtjänst', nodes: ['k-omsorg'] },
        { id: 'infrastruktur', label: 'Gator, räddningstjänst och miljö', nodes: ['k-infrastruktur'] },
        { id: 'kultur', label: 'Kultur och fritid', nodes: ['k-kultur'] },
      ],
      otherLabel: 'Övrig kommunal verksamhet',
    };
    const healthNodes = regionFlow.meta.nodes.filter((n) => n.parent === 'g-halso').map((n) => n.id);
    if (healthNodes.length === 0) throw new Error('Regionflödet saknar gruppen hälso- och sjukvård');
    const regionBreakdown: Breakdown = {
      dataPath: regionFlow.meta.dataPath,
      year: regionFlow.year,
      include: outLeaves(regionFlow.meta),
      groups: [
        { id: 'halso', label: 'Hälso- och sjukvård', nodes: healthNodes },
        { id: 'trafik', label: 'Kollektivtrafik', nodes: ['r-trafik'] },
      ],
      otherLabel: 'Övrig regional verksamhet',
    };
    const budgetNodes = stateFlow.meta.nodes.filter((n) => n.parent === 'g-statsbudget' && n.id.startsWith('uo-'));
    const stateValues = stateFlow.data.values.SE ?? {};
    const topUo = budgetNodes
      .filter((n) => n.id !== 'uo-ovriga')
      .sort((a, b) => (stateValues[b.id] ?? 0) - (stateValues[a.id] ?? 0))
      .slice(0, 6);
    const stateBreakdown: Breakdown = {
      dataPath: stateFlow.meta.dataPath,
      year: stateFlow.year,
      include: budgetNodes.map((n) => n.id),
      groups: topUo.map((n) => ({ id: n.id, label: n.label, nodes: [n.id], description: n.description })),
      otherLabel: 'Övriga utgiftsområden',
    };

    const skvSource = (y: string): Source => ({
      org: 'Skatteverket',
      name: `Skattesatser per kommun ${y}`,
      url: 'https://www.dataportal.se/datasets/9_10',
      apiUrl: rateUrls[years.indexOf(y)],
      license: SKV_LICENSE,
    });

    return [
      {
        output: 'calculator',
        meta: {
          kind: 'calculator',
          id: 'skatter-kalkylator',
          title: 'Vart går skatten på din lön?',
          description:
            'Ange din bruttolön och kommun. Diagrammet visar hur arbetsgivarens kostnad för din lön fördelas: nettolön, kommunen, regionen, staten och socialförsäkringarna – och vad pengarna används till.',
          category: 'skatter',
          source: skvSource(latest),
          extraSources: [
            {
              org: 'Skatteverket',
              name: `Belopp och procent ${latest}`,
              url: SKV_RULES_PAGE[latest]!,
              license: 'Offentlig information',
            },
            {
              org: 'Skatteverket',
              name: `Teknisk beskrivning för skattetabeller ${latest} (SKV 433) – beräkningsregler`,
              url: SKV_433[latest]!,
              license: 'Offentlig information',
            },
            {
              org: 'Skatteverket',
              name: `Skattetabeller för månadslön ${latest} – kontroll av beräkningen`,
              url: 'https://www.dataportal.se/datasets/9_5',
              apiUrl: checks[checks.length - 1]!.apiUrl,
              license: SKV_LICENSE,
            },
            { org: 'Riksdagen', name: 'Inkomstskattelag (1999:1229), 63 kap. 3 § och 67 kap.', url: IL_URL, license: 'Offentlig handling' },
            kommunFlow.meta.source,
            regionFlow.meta.source,
            stateFlow.meta.source,
          ],
          fetchedAt: now(),
          notes: [
            `Beräkningen gäller lön för en person som är född 1959–2002 (inte fyllt 66 år) och saknar andra inkomster och avdrag. Den följer Skatteverkets regler för ${latest} och stämmer med Skatteverkets skattetabeller på kronan när (kontrolleras vid varje hämtning).`,
            'Diagrammet visar tre källor var för sig: bruttolönen, arbetsgivaravgifterna (som arbetsgivaren betalar utöver lönen) och skattereduktionerna. Strömmarna visar vilken källa som finansierar vad – t.ex. går ålderspensionsavgiften och socialförsäkringsavgifterna direkt från arbetsgivaravgifterna.',
            'Skatten minskas av jobbskatteavdraget, skattereduktionen för förvärvsinkomster och skattereduktionen för allmän pensionsavgift. De betalas av staten: kommunen och regionen får hela kommunalskatten. Staten visas därför brutto (statlig skatt, allmän löneavgift och ålderspensionsavgift över taket) och skattereduktionerna som en egen källa som höjer nettolönen. Statens netto visas som nyckeltal – för låga och medelhöga inkomster är det negativt.',
            'Den allmänna pensionsavgiften (7 % av lönen) dras formellt på lönen men kompenseras fullt av en lika stor skattereduktion. Den visas därför som finansierad av skattereduktionerna (staten), inte av bruttolönen. Från bruttolönen går alltså bara kommunalskatt, regionskatt, statlig skatt (över brytpunkten), begravnings-/kyrkoavgift och public service-avgift – resten är nettolön.',
            'Arbetsgivaravgiften betalas av arbetsgivaren utöver bruttolönen men är en kostnad för din anställning. Ålderspensionsavgiften och den allmänna pensionsavgiften går till pensionssystemet; för lön över taket för pensionsgrundande inkomst (8,07 inkomstbasbelopp per år) går ålderspensionsavgiften till statsbudgeten. Den allmänna löneavgiften är en skatt till staten.',
            `Andra steget fördelar kommunens, regionens och statens del efter hur de använde sina pengar ${kommunFlow.year} (kommunens och regionens kostnader per verksamhet, statens utgiftsområden). Det är en proportionell illustration – skatten är inte öronmärkt.`,
            'Begravningsavgift och kyrkoavgift varierar mellan församlingar; här används kommunens medelvärde. Kyrkoavgift ingår bara om du väljer medlemskap i Svenska kyrkan. Public service-avgiften (högst 1 184 kr per år) går till public service via staten.',
            'Moms och punktskatter på det du köper för nettolönen ingår inte.',
          ],
          years,
          rules: RULES,
          municipalities,
          defaultMunicipality: '0180',
          defaultSalary: 40_000,
          breakdowns: { kommun: kommunBreakdown, region: regionBreakdown, staten: stateBreakdown },
        },
      },
    ];
  },
};
