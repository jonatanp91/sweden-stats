/**
 * Skatter & offentliga finanser – kommuner och regioner (SCB).
 *
 * Producerar:
 *  - skatter-kommuner              regionalt: skattesatser, kostnader, intäkter och resultat per kommun och år (karta)
 *  - skatter-kommun-flode          flöde: kommunens intäkter → kostnader per verksamhet (Sankey), per kommun och år
 *  - skatter-region-flode          flöde: regionens intäkter → kostnader per verksamhet (Sankey), per region och år
 *  - skatter-kommunalskatt-riket   tidsserie: genomsnittlig kommunalskatt i riket sedan 1930
 *
 * Tabeller: TAB2017/TAB2015 (skattesatser, OE0101), TAB6777 (resultaträkning kommuner, OE0107A),
 * TAB4201 (verksamhetsintäkter), TAB4199 (driftredovisning kommuner), TAB6784 (resultaträkning regioner),
 * TAB4242 (driftredovisning regioner), TAB6574 (folkmängd, BE0101).
 */
import type { FlowNode, RegionalMetric, Source } from '../../src/lib/types.ts';
import type { Fetcher, FetcherOutput } from '../lib/fetcher.ts';
import { now } from '../lib/fetcher.ts';
import {
  buildFlow,
  COMMON_IN_NODES,
  COMMON_OUT_NODES,
  hasIncomeStatement,
  INCOME_STATEMENT_KEY_FIGURES,
  incomeStatementFigures,
  type IncomeStatement,
} from '../lib/flows.ts';
import {
  dimensionLabels,
  fetchPxMetadata,
  fetchPxTable,
  indexRecords,
  jsonStatToRecords,
  scbProductUrl,
  SCB_LICENSE,
  type JsonStat2,
} from '../lib/pxweb.ts';

const FIRST_YEAR = 2010;
const RR_CODES = ['010', '022', '030', '035', '040', '060', '072', '080', '120'];

/** Varför skatteintäkterna här inte är exakt samma som kommunalskatten i statens budgetdiagram. */
const MUNICIPAL_TAX_NOTE =
  'Skatteintäkterna är bokförda enligt kommunal redovisning: årets preliminära kommunalskatt plus prognos för slutavräkningen. De ligger därför nära skatten på årets inkomster och skiljer sig från statens utbetalning av kommunalskatt under året i statens budgetdiagram (inkomsttitel 1811), som bygger på en prognos för skatteunderlaget och innehåller avräkningar för tidigare år.';

function source(js: JsonStat2, apiUrl: string, tableId: string, name: string): Source {
  return { org: 'SCB', name, url: scbProductUrl(js), apiUrl, tableId, license: SCB_LICENSE, updated: js.updated };
}

const yearsOf = (js: JsonStat2) =>
  dimensionLabels(js, 'Tid')
    .map((t) => t.code)
    .filter((y) => Number(y) >= FIRST_YEAR);

// ---- Kommunflöde: noder ----
const KOMMUN_REVENUE: { id: string; label: string; codes: string[]; description: string }[] = [
  { id: 'avgifter', label: 'Taxor och avgifter', codes: ['290'], description: 'T.ex. barnomsorg, äldreomsorg, VA och avfall' },
  { id: 'hyror', label: 'Hyror och arrenden', codes: ['490'], description: 'Bostads- och lokalhyror, markarrenden' },
  { id: 'bidrag', label: 'Riktade bidrag', codes: ['590'], description: 'Riktade statsbidrag, ersättningar från Försäkringskassan, EU-bidrag m.m.' },
  { id: 'forsaljning', label: 'Försäljning av verksamhet', codes: ['390', '130'], description: 'Försäljning av tjänster till andra kommuner, regioner m.fl.' },
];
const KOMMUN_COSTS: { id: string; label: string; code: string; description: string }[] = [
  { id: 'k-pedagogisk', label: 'Förskola, skola och utbildning', code: '490', description: 'Förskola, grundskola, gymnasium, fritidshem, vuxenutbildning' },
  { id: 'k-omsorg', label: 'Vård och omsorg', code: '590', description: 'Äldreomsorg, LSS, individ- och familjeomsorg, ekonomiskt bistånd' },
  { id: 'k-infrastruktur', label: 'Infrastruktur och skydd', code: '290', description: 'Gator, parker, planering, räddningstjänst, miljö' },
  { id: 'k-affar', label: 'Affärsverksamhet', code: '890', description: 'VA, avfall, energi, hamnar, kommersiell verksamhet' },
  { id: 'k-kultur', label: 'Kultur och fritid', code: '390', description: 'Bibliotek, kulturskola, idrottsanläggningar, fritidsgårdar' },
  { id: 'k-riktade', label: 'Flyktingmottagande och arbetsmarknad', code: '690', description: 'Särskilt riktade insatser' },
  { id: 'k-politisk', label: 'Politisk verksamhet', code: '190', description: 'Nämnder, styrelser, revision, partistöd' },
];

// ---- Regionflöde: noder ----
// Mellansteg (gruppnoder): hälso- och sjukvård (SCB:s verksamhetsområden 0–4) respektive allt annat
const REGION_HEALTH = 'g-halso';
const REGION_OTHER = 'g-ovrigt';
const REGION_COSTS: { id: string; label: string; codes: string[]; description: string; parent: string }[] = [
  { id: 'r-somatisk', label: 'Specialiserad somatisk vård', codes: ['1'], description: 'Sjukhusvård och specialistmottagningar', parent: REGION_HEALTH },
  { id: 'r-primarvard', label: 'Primärvård', codes: ['0'], description: 'Vårdcentraler m.m.', parent: REGION_HEALTH },
  { id: 'r-psykiatri', label: 'Specialiserad psykiatrisk vård', codes: ['2'], description: '', parent: REGION_HEALTH },
  { id: 'r-ovrig-hos', label: 'Övrig hälso- och sjukvård', codes: ['4'], description: 'Hjälpmedel, social verksamhet, FoU, politik avseende vård', parent: REGION_HEALTH },
  { id: 'r-tandvard', label: 'Tandvård', codes: ['3'], description: '', parent: REGION_HEALTH },
  { id: 'r-trafik', label: 'Trafik och infrastruktur', codes: ['7'], description: 'Kollektivtrafik, färdtjänst', parent: REGION_OTHER },
  { id: 'r-regional', label: 'Utbildning, kultur och regional utveckling', codes: ['5', '6', '8'], description: 'Folkhögskolor, kultur, näringslivsutveckling', parent: REGION_OTHER },
];
/** Gemensamma utflödesnoder som hör till gruppen "övrigt" i regionflödet. */
const REGION_OTHER_COMMON = new Set(['avskrivningar', 'fin-ut', 'utjamningsavgift', 'extra-ut']);

const KOMMUN_KEY_FIGURES = [
  { key: 'skattesats', label: 'Skattesats, totalt', unit: '%', decimals: 2 },
  { key: 'skattesats-kommun', label: 'Skattesats till kommunen', unit: '%', decimals: 2 },
  { key: 'skattesats-region', label: 'Skattesats till regionen', unit: '%', decimals: 2 },
  ...INCOME_STATEMENT_KEY_FIGURES,
];

export const skatter: Fetcher = {
  name: 'skatter',
  produces: ['skatter-kommuner', 'skatter-kommun-flode', 'skatter-region-flode', 'skatter-kommunalskatt-riket'],
  async run() {
    const fetchedAt = now();

    // --- Kommunlista och län ---
    const taxMeta = await fetchPxMetadata('TAB2017');
    const regionLabels = dimensionLabels(taxMeta, 'Region');
    const lanName = new Map(regionLabels.filter((r) => /^\d{2}$/.test(r.code) && r.code !== '00').map((r) => [r.code, r.label]));
    const kommuner = regionLabels
      .filter((r) => /^\d{4}$/.test(r.code))
      .map((r) => ({ code: r.code, name: r.label, group: lanName.get(r.code.slice(0, 2)) ?? '' }));
    const kommunCodes = kommuner.map((k) => k.code);
    const lanCodes = [...lanName.keys()];

    // --- Hämta tabeller ---
    const tax = await fetchPxTable('TAB2017', { Region: ['00', ...lanCodes, ...kommunCodes], ContentsCode: '*', Tid: '*' });
    const rr = await fetchPxTable('TAB6777', { Region: ['00', ...kommunCodes], Resultatraknposter: RR_CODES, ContentsCode: '*', Tid: '*' });
    const rev = await fetchPxTable('TAB4201', {
      Region: ['00', ...kommunCodes],
      Kontopost: KOMMUN_REVENUE.flatMap((r) => r.codes),
      ContentsCode: '*',
      Tid: '*',
    });
    const drift = await fetchPxTable('TAB4199', {
      Region: ['00', ...kommunCodes],
      Verksomrkom: KOMMUN_COSTS.map((c) => c.code),
      ContentsCode: ['0000005Z'],
      Tid: '*',
    });
    const popMeta = await fetchPxMetadata('TAB6574');
    const popYears = yearsOf(popMeta);
    const pop = await fetchPxTable('TAB6574', {
      Region: ['00', ...kommunCodes],
      Alder: ['totalt'],
      Kon: ['1+2'],
      ContentsCode: '*',
      Tid: popYears,
    });

    const getTax = indexRecords(jsonStatToRecords(tax.data), ['Region', 'ContentsCode', 'Tid']);
    const getRR = indexRecords(jsonStatToRecords(rr.data), ['Region', 'Resultatraknposter', 'Tid']);
    const getRev = indexRecords(jsonStatToRecords(rev.data), ['Region', 'Kontopost', 'Tid']);
    const getDrift = indexRecords(jsonStatToRecords(drift.data), ['Region', 'Verksomrkom', 'Tid']);
    const getPop = indexRecords(jsonStatToRecords(pop.data), ['Region', 'Tid']);

    const taxYears = yearsOf(tax.data);
    const rrYears = new Set(yearsOf(rr.data));
    const flowYears = yearsOf(drift.data).filter((y) => rrYears.has(y) && yearsOf(rev.data).includes(y));

    const rrFor = (code: string, y: string): IncomeStatement =>
      Object.fromEntries(RR_CODES.map((k) => [k, getRR(code, k, y)]));

    // --- Nyckeltal per kommun (karta och kommunflöde) ---
    const kommunFigures = (code: string, y: string): Record<string, number | null> => ({
      skattesats: getTax(code, 'OE0101D1', y),
      'skattesats-kommun': getTax(code, 'OE0101D2', y),
      'skattesats-region': getTax(code, 'OE0101D3', y),
      ...incomeStatementFigures(rrFor(code, y), getPop(code, y), 1000),
    });

    // --- Regionalt dataset: kommuner ---
    const regionalYears = taxYears.map((y) => {
      const values: Record<string, Record<string, number | null>> = {};
      for (const code of kommunCodes) values[code] = kommunFigures(code, y);
      return { year: y, values };
    });

    const metricYears = (key: string) =>
      regionalYears.filter((ry) => Object.values(ry.values).some((v) => v[key] !== null)).map((ry) => ry.year);
    const metric = (m: Omit<RegionalMetric, 'years'>): RegionalMetric => ({ ...m, years: metricYears(m.key) });

    const taxSource = source(tax.data, tax.apiUrl, 'TAB2017', 'Kommunala skattesatser');
    const rrSource = source(rr.data, rr.apiUrl, 'TAB6777', 'Resultaträkning för kommuner');
    const popSource = source(pop.data, pop.apiUrl, 'TAB6574', 'Folkmängden per region');
    const revSource = source(rev.data, rev.apiUrl, 'TAB4201', 'Verksamhetsintäkter för kommuner');
    const driftSource = source(drift.data, drift.apiUrl, 'TAB4199', 'Kostnader och intäkter för kommuner efter verksamhetsområde');

    const outputs: FetcherOutput[] = [];

    outputs.push({
      output: 'regional',
      meta: {
        kind: 'regional',
        id: 'skatter-kommuner',
        title: 'Kommunalskatt och kommunernas ekonomi',
        description:
          'Skattesats, kostnader, intäkter och resultat för Sveriges 290 kommuner. Hovra över en kommun för detaljer och klicka för att se hela budgeten nedan.',
        category: 'skatter',
        source: taxSource,
        extraSources: [rrSource, popSource],
        fetchedAt,
        notes: [
          'Skattesats total = skatt till kommunen + skatt till regionen (exklusive kyrkoavgift och begravningsavgift).',
          'Kommunens totala kostnader = verksamhetens kostnader + avskrivningar + finansiella kostnader enligt resultaträkningen (kommunen, inte kommunkoncernen med bolag).',
          'Belopp per invånare beräknas med folkmängden den 31 december samma år.',
          'Statsbidrag och utjämning är netto: negativa värden betyder att kommunen betalar mer till utjämningssystemet än den får i generella bidrag.',
          'Skattesatserna publiceras för innevarande år; ekonomiska utfall finns först efter bokslut (året efter).',
          'Region Gotland är både kommun och region och redovisas här som kommun, vilket gör den svår att jämföra med övriga kommuner.',
        ],
        level: 'kommun',
        years: taxYears,
        defaultMetric: 'skattesats',
        metrics: [
          metric({ key: 'skattesats', label: 'Skattesats, totalt', unit: '%', decimals: 2, scale: 'sequential' }),
          metric({ key: 'skattesats-kommun', label: 'Skattesats till kommunen', unit: '%', decimals: 2, scale: 'sequential' }),
          metric({ key: 'skattesats-region', label: 'Skattesats till regionen', unit: '%', decimals: 2, scale: 'sequential' }),
          metric({ key: 'kostnader', label: 'Totala kostnader', unit: 'mnkr', decimals: 0 }),
          metric({ key: 'kostnad-per-inv', label: 'Kostnader per invånare', unit: 'kr', decimals: 0, scale: 'sequential' }),
          metric({ key: 'skatteintakter', label: 'Skatteintäkter', unit: 'mnkr', decimals: 0 }),
          metric({ key: 'skatt-per-inv', label: 'Skatteintäkter per invånare', unit: 'kr', decimals: 0, scale: 'sequential' }),
          metric({ key: 'statsbidrag', label: 'Statsbidrag och utjämning (netto)', unit: 'mnkr', decimals: 0 }),
          metric({ key: 'statsbidrag-per-inv', label: 'Statsbidrag och utjämning per invånare', unit: 'kr', decimals: 0, scale: 'diverging' }),
          metric({ key: 'resultat', label: 'Årets resultat', unit: 'mnkr', decimals: 0 }),
          metric({ key: 'resultat-per-inv', label: 'Årets resultat per invånare', unit: 'kr', decimals: 0, scale: 'diverging' }),
          metric({ key: 'folkmangd', label: 'Folkmängd', unit: 'personer', decimals: 0 }),
        ],
        regions: kommuner,
        dataPath: 'data/skatter-kommuner',
      },
      years: regionalYears,
    });

    // --- Flöde: kommuner ---
    const kommunNodes: FlowNode[] = [
      COMMON_IN_NODES[0]!,
      COMMON_IN_NODES[1]!,
      ...KOMMUN_REVENUE.map((r) => ({ id: r.id, label: r.label, side: 'in' as const, description: r.description })),
      { id: 'ovriga-intakter', label: 'Övriga verksamhetsintäkter', side: 'in', description: 'Exploatering, försäljning av anläggningar m.m.' },
      ...COMMON_IN_NODES.slice(2),
      ...KOMMUN_COSTS.map((c) => ({ id: c.id, label: c.label, side: 'out' as const, description: c.description })),
      ...COMMON_OUT_NODES,
    ];
    const scaledRevenue: string[] = [];
    const kommunFlowYears = flowYears.map((y) => {
      const values: Record<string, Record<string, number>> = {};
      const population: Record<string, number> = {};
      const keyFigures: Record<string, Record<string, number | null>> = {};
      for (const code of ['00', ...kommunCodes]) {
        const s = rrFor(code, y);
        if (!hasIncomeStatement(s)) continue;
        const p = getPop(code, y);
        if (p) population[code] = p;
        keyFigures[code] = kommunFigures(code, y);
        const revenueSplit = Object.fromEntries(
          KOMMUN_REVENUE.map((r) => [r.id, r.codes.reduce((a, c) => a + (getRev(code, c, y) ?? 0), 0)]),
        );
        const costShares = Object.fromEntries(KOMMUN_COSTS.map((c) => [c.id, getDrift(code, c.code, y)]));
        try {
          values[code] = buildFlow(
            s,
            {
              revenueSplit,
              costShares,
              onRevenueOverflow: 'scale',
              onScaled: (f) => scaledRevenue.push(`${code} ${y} (×${f.toFixed(2)})`),
            },
            1000,
          );
        } catch (e) {
          throw new Error(`Kommun ${code} ${y}: ${e instanceof Error ? e.message : e}`);
        }
      }
      return { year: y, values, population, keyFigures };
    });
    if (scaledRevenue.length) {
      console.warn(`  ! Intäktsdelningen skalades ned för: ${scaledRevenue.join(', ')}`);
    }

    outputs.push({
      output: 'flow',
      meta: {
        kind: 'flow',
        id: 'skatter-kommun-flode',
        title: 'Kommunens budget: var pengarna kommer ifrån och vart de går',
        description:
          'Kommunens intäkter till vänster och kostnader per verksamhetsområde till höger. Välj en kommun eller se alla kommuner sammantaget.',
        category: 'skatter',
        source: rrSource,
        extraSources: [revSource, driftSource],
        fetchedAt,
        notes: [
          'Bygger på kommunens resultaträkning (exklusive kommunala bolag). Alla belopp i löpande priser.',
          'Verksamhetens kostnader fördelas på verksamhetsområden efter respektive områdes andel av bruttokostnaderna i driftredovisningen. Driftredovisningen innehåller interna poster och summerar därför inte exakt till resultaträkningen; andelarna används bara för fördelningen.',
          'Verksamhetens intäkter delas upp enligt SCB:s kontoposter; det som inte ryms i de redovisade grupperna visas som "Övriga verksamhetsintäkter". I de få fall där kontoposterna summerar till mer än resultaträkningens intäkter (främst Region Gotland, som redovisar både kommun- och regionuppgifter) skalas uppdelningen proportionellt.',
          'Kommuner som betalar netto till det kommunalekonomiska utjämningssystemet visar en "Avgift till utjämningssystemet" bland utgifterna.',
          'Ett överskott (eller underskott) balanserar flödet så att intäkter och kostnader blir lika stora.',
          'Belopp per invånare beräknas med folkmängden den 31 december samma år (SCB TAB6574). Nyckeltalen är desamma som i kartan ovan.',
          MUNICIPAL_TAX_NOTE,
        ],
        unit: 'mnkr',
        entityLabel: 'Kommun',
        entityParam: 'kommun',
        entities: [{ code: '00', name: 'Alla kommuner (riket)' }, ...kommuner],
        defaultEntity: '00',
        years: kommunFlowYears.map((y) => y.year),
        nodes: kommunNodes,
        keyFigures: KOMMUN_KEY_FIGURES,
        dataPath: 'data/skatter-kommun-flode',
      },
      years: kommunFlowYears,
    });

    // --- Flöde: regioner ---
    const regRR = await fetchPxTable('TAB6784', { Region: '*', Resultatraknposter: RR_CODES, ContentsCode: '*', Tid: '*' });
    const regDrift = await fetchPxTable('TAB4242', {
      Region: '*',
      Verksomrkom: REGION_COSTS.flatMap((c) => c.codes),
      ContentsCode: ['000000A6'],
      Tid: '*',
    });
    const getRegRR = indexRecords(jsonStatToRecords(regRR.data), ['Region', 'Resultatraknposter', 'Tid']);
    const getRegDrift = indexRecords(jsonStatToRecords(regDrift.data), ['Region', 'Verksomrkom', 'Tid']);
    const regions = dimensionLabels(regRR.data, 'Region').filter((r) => r.code !== '00');
    const regRRYears = new Set(dimensionLabels(regRR.data, 'Tid').map((t) => t.code));
    const regYears = dimensionLabels(regDrift.data, 'Tid')
      .map((t) => t.code)
      .filter((y) => regRRYears.has(y));

    // Folkmängd per region = summan av länets kommuner (regionkod "01L" ↔ länskod "01")
    const lanOf = (regionCode: string) => regionCode.slice(0, 2);
    const regionPop = (code: string, y: string): number | null => {
      if (code === '00') return getPop('00', y);
      const vals = kommunCodes.filter((k) => k.startsWith(lanOf(code))).map((k) => getPop(k, y));
      return vals.length === 0 || vals.some((v) => v === null) ? null : vals.reduce((a: number, v) => a + (v as number), 0);
    };
    for (const r of regions) {
      if (!lanName.has(lanOf(r.code))) throw new Error(`Region ${r.code} (${r.label}) saknar motsvarande län`);
    }

    const regionFlowYears = regYears
      .map((y) => {
        const values: Record<string, Record<string, number>> = {};
        const population: Record<string, number> = {};
        const keyFigures: Record<string, Record<string, number | null>> = {};
        for (const code of ['00', ...regions.map((r) => r.code)]) {
          const s: IncomeStatement = Object.fromEntries(RR_CODES.map((k) => [k, getRegRR(code, k, y)]));
          if (!hasIncomeStatement(s)) continue;
          const p = regionPop(code, y);
          if (p) population[code] = p;
          keyFigures[code] = {
            'skattesats-region': getTax(code === '00' ? '00' : lanOf(code), 'OE0101D3', y),
            ...incomeStatementFigures(s, p, 1e6),
          };
          const costShares = Object.fromEntries(
            REGION_COSTS.map((c) => [c.id, c.codes.reduce((a, k) => a + (getRegDrift(code, k, y) ?? 0), 0)]),
          );
          try {
            values[code] = buildFlow(s, { costShares }, 1);
          } catch (e) {
            throw new Error(`Region ${code} ${y}: ${e instanceof Error ? e.message : e}`);
          }
        }
        return { year: y, values, population, keyFigures };
      })
      .filter((y) => Object.keys(y.values).length > 0);

    outputs.push({
      output: 'flow',
      meta: {
        kind: 'flow',
        id: 'skatter-region-flode',
        title: 'Regionens budget: var pengarna kommer ifrån och vart de går',
        description:
          'Regionernas intäkter till vänster och kostnader per verksamhetsområde till höger. Hälso- och sjukvården dominerar.',
        category: 'skatter',
        source: source(regRR.data, regRR.apiUrl, 'TAB6784', 'Resultaträkning för regioner'),
        extraSources: [source(regDrift.data, regDrift.apiUrl, 'TAB4242', 'Kostnader och intäkter för regioner efter verksamhetsområde')],
        fetchedAt,
        notes: [
          'Bygger på regionens resultaträkning (exklusive regionala bolag). Alla belopp i löpande priser.',
          'Verksamhetens kostnader fördelas efter respektive verksamhetsområdes andel av bruttokostnaderna. Serviceverksamheter (t.ex. fastighetsförvaltning och medicinsk service) är interna och fördelas därför inte som eget område.',
          'Verksamhetens intäkter omfattar bl.a. patientavgifter, riktade statsbidrag (t.ex. för läkemedel) och försäljning av vård.',
          'Region Gotland är både kommun och region; SCB uppskattar att 35 % av verksamheten avser regionuppgifter.',
          'Mellansteget "Hälso- och sjukvård" omfattar SCB:s verksamhetsområden 0–4 (primärvård, somatisk och psykiatrisk specialistvård, tandvård, övrig hälso- och sjukvård). Avskrivningar och finansiella kostnader kan inte fördelas per verksamhet och redovisas under "Övrig verksamhet och finansiering".',
          'Belopp per invånare beräknas med folkmängden den 31 december (summan av länets kommuner, SCB TAB6574).',
          MUNICIPAL_TAX_NOTE,
        ],
        unit: 'mnkr',
        entityLabel: 'Region',
        entityParam: 'region',
        entities: [{ code: '00', name: 'Alla regioner (riket)' }, ...regions.map((r) => ({ code: r.code, name: r.label }))],
        defaultEntity: '00',
        years: regionFlowYears.map((y) => y.year),
        nodes: [
          ...COMMON_IN_NODES.slice(0, 2),
          { id: 'verksamhetens-intakter', label: 'Verksamhetens intäkter', side: 'in', description: 'Patientavgifter, riktade bidrag, försäljning m.m.' },
          ...COMMON_IN_NODES.slice(2),
          {
            id: REGION_HEALTH,
            label: 'Hälso- och sjukvård',
            side: 'out',
            role: 'group',
            description: 'Primärvård, specialiserad somatisk och psykiatrisk vård, tandvård och övrig hälso- och sjukvård',
          },
          {
            id: REGION_OTHER,
            label: 'Övrig verksamhet och finansiering',
            side: 'out',
            role: 'group',
            description: 'Kollektivtrafik, regional utveckling, kultur och utbildning samt avskrivningar och finansiella kostnader',
          },
          ...REGION_COSTS.map((c) => ({ id: c.id, label: c.label, side: 'out' as const, description: c.description || undefined, parent: c.parent })),
          ...COMMON_OUT_NODES.map((n) => (REGION_OTHER_COMMON.has(n.id) ? { ...n, parent: REGION_OTHER } : n)),
        ],
        keyFigures: [{ key: 'skattesats-region', label: 'Skattesats till regionen', unit: '%', decimals: 2 }, ...INCOME_STATEMENT_KEY_FIGURES],
        dataPath: 'data/skatter-region-flode',
      },
      years: regionFlowYears,
    });

    // --- Tidsserie: kommunalskatt i riket ---
    const riket = await fetchPxTable('TAB2015', { ContentsCode: ['OE0101F1', 'OE0101F2', 'OE0101F3'], Tid: '*' });
    const getRiket = indexRecords(jsonStatToRecords(riket.data), ['ContentsCode', 'Tid']);
    const riketYears = dimensionLabels(riket.data, 'Tid').map((t) => t.code);
    const series = (code: string, key: string, label: string) => ({
      key,
      label,
      points: riketYears.map((t) => ({ t, v: getRiket(code, t) })),
    });
    outputs.push({
      id: 'skatter-kommunalskatt-riket',
      title: 'Kommunalskatten i Sverige sedan 1930',
      description: 'Genomsnittlig kommunal skattesats i riket, uppdelad på kommun och region (tidigare landsting).',
      category: 'skatter',
      unit: '%',
      frequency: 'year',
      source: source(riket.data, riket.apiUrl, 'TAB2015', 'Kommunalskatteuppgifter, riket'),
      fetchedAt,
      chart: { type: 'line', yFromZero: true, decimals: 2 },
      notes: [
        'Medelskattesatsen är vägd med skatteunderlaget i respektive kommun.',
        'Skatteväxlingar mellan kommuner och regioner (t.ex. när ansvar för kollektivtrafik eller hemsjukvård flyttats) syns som hopp i delserierna utan att totalen ändras.',
      ],
      series: [
        series('OE0101F1', 'total', 'Total kommunal skattesats'),
        series('OE0101F2', 'kommun', 'Till kommunen'),
        series('OE0101F3', 'region', 'Till regionen'),
      ],
    });

    return outputs;
  },
};
