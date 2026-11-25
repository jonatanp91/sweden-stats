import { z } from 'zod';

/**
 * Dataset-schemat är kontraktet mellan hämtningsskripten (scripts/) och sajten (src/).
 * Varje fil i src/data/datasets/<id>.json följer detta schema och valideras både när
 * den skrivs (scripts/lib/write-dataset.ts) och när sajten byggs (src/lib/datasets.ts).
 */

export const SourceSchema = z.object({
  /** Organisation som publicerar datan, t.ex. "SCB" eller "SMHI". */
  org: z.string(),
  /** Om datan ursprungligen tas fram av annan myndighet, t.ex. Naturvårdsverket via SCB. */
  producer: z.string().optional(),
  /** Tabellens/tjänstens namn hos källan. */
  name: z.string(),
  /** Publik länk till källan som en människa kan följa. */
  url: z.url(),
  /** API-anrop som användes (för spårbarhet). */
  apiUrl: z.url().optional(),
  /** Tabell-ID, stationsnummer el. dyl. */
  tableId: z.string().optional(),
  license: z.string(),
  /** När källan senast uppdaterade datan (om källan anger det). */
  updated: z.string().optional(),
});

export const PointSchema = z.object({
  /** Tidpunkt som sträng: "2024", "2024-03" (månad) eller "2024K1" (kvartal). */
  t: z.string(),
  /** Värde; null = saknas/sekretess. */
  v: z.number().nullable(),
});

export const SeriesSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** 'muted' = visas nedtonat (t.ex. brusiga årsvärden bakom ett glidande medel). */
  role: z.enum(['muted']).optional(),
  points: z.array(PointSchema),
});

export const ChartTypeSchema = z.enum(['line', 'area', 'bar', 'stacked-bar', 'stacked-area']);

/** Fält som alla datasettyper delar. */
const baseFields = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  description: z.string(),
  /** Slug för kategorin i src/data/categories.ts. */
  category: z.string(),
  /** Huvudkälla. */
  source: SourceSchema,
  /** Ytterligare källor när datasetet kombinerar flera tabeller. */
  extraSources: z.array(SourceSchema).default([]),
  /** ISO-tidsstämpel för när hämtningsskriptet körde. */
  fetchedAt: z.string(),
  /** Fria anteckningar om metod/bearbetning som visas under diagrammet. */
  notes: z.array(z.string()).default([]),
};

/** Tidsserier – linje-, yt- och stapeldiagram (src/components/Chart.tsx). */
export const DatasetSchema = z.object({
  ...baseFields,
  kind: z.literal('timeseries').default('timeseries'),
  /** Enhet för värdena, t.ex. "personer", "kt CO₂-ekv.", "°C", "GWh". */
  unit: z.string(),
  frequency: z.enum(['year', 'quarter', 'month', 'day']),
  /** Visningsinställningar – data och presentation hålls ihop men kan skrivas över per sida. */
  chart: z.object({
    type: ChartTypeSchema,
    /** Börja y-axeln på noll (standard true för stapel/yta). */
    yFromZero: z.boolean().optional(),
    /** Antal decimaler i tooltip/tabell. */
    decimals: z.number().int().min(0).max(3).optional(),
  }),
  series: z.array(SeriesSchema).min(1),
});

/**
 * Regionala dataset – värden per kommun eller region och år (karta, src/components/RegionMap.tsx).
 * Metadata ligger här; själva värdena i public/<dataPath>/<år>.json (se RegionalYearSchema).
 */
export const RegionalMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  decimals: z.number().int().min(0).max(3).default(0),
  /** Kan måttet färgsätta kartan? 'sequential' = en nyans ljus→mörk, 'diverging' = två nyanser kring noll. */
  scale: z.enum(['sequential', 'diverging']).optional(),
  /** År där måttet har värden. */
  years: z.array(z.string()),
});

export const RegionalDatasetSchema = z.object({
  ...baseFields,
  kind: z.literal('regional'),
  level: z.enum(['kommun', 'region']),
  years: z.array(z.string()).min(1),
  metrics: z.array(RegionalMetricSchema).min(1),
  /** Mått som kartan visar från början. */
  defaultMetric: z.string(),
  regions: z.array(z.object({ code: z.string(), name: z.string(), group: z.string().optional() })),
  /** Sökväg under public/ där årsfilerna ligger, t.ex. "data/skatter-kommuner". */
  dataPath: z.string(),
});

export const RegionalYearSchema = z.object({
  year: z.string(),
  /** regionkod → måttnyckel → värde */
  values: z.record(z.string(), z.record(z.string(), z.number().nullable())),
});

/**
 * Flödesdataset – Sankey: inflöden → enhet (kommun/region/staten) → utflöden (src/components/FlowSankey.tsx).
 * Alla flöden har samma nodlista; per enhet och år lagras bara nodernas belopp. Summan av
 * inflöden ska vara lika med summan av utflöden (kontrolleras i writeFlowDataset).
 */
export const FlowNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  side: z.enum(['in', 'out']),
  /**
   * 'balance' = över-/underskott, visas nedtonat. 'group' = mellansteg (t.ex. "Hälso- och sjukvård") som
   * saknar egna belopp – klienten summerar noderna som har den som `parent`.
   */
  role: z.enum(['balance', 'group']).optional(),
  /** Id för gruppnoden (samma sida) som posten ingår i. */
  parent: z.string().optional(),
  description: z.string().optional(),
});

/** Nyckeltal som visas ovanför ett diagram, t.ex. skattesats eller kostnad per invånare. */
export const KeyFigureDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  decimals: z.number().int().min(0).max(3).default(0),
});

export const FlowDatasetSchema = z.object({
  ...baseFields,
  kind: z.literal('flow'),
  /** Enhet för beloppen. */
  unit: z.enum(['mnkr']),
  /** Vad användaren väljer, t.ex. "Kommun" – används i dropdown och URL (?kommun=0180). */
  entityLabel: z.string(),
  entityParam: z.string(),
  entities: z.array(z.object({ code: z.string(), name: z.string(), group: z.string().optional() })).min(1),
  defaultEntity: z.string(),
  years: z.array(z.string()).min(1),
  nodes: z.array(FlowNodeSchema).min(2),
  /** Nyckeltal per enhet och år (värdena ligger i årsfilernas `keyFigures`). */
  keyFigures: z.array(KeyFigureDefSchema).default([]),
  dataPath: z.string(),
});

export const FlowYearSchema = z.object({
  year: z.string(),
  /** enhetskod → nod-id → belopp (positivt; noder med 0 och gruppnoder utelämnas) */
  values: z.record(z.string(), z.record(z.string(), z.number())),
  /** enhetskod → folkmängd (31 december), för belopp per invånare. */
  population: z.record(z.string(), z.number()).optional(),
  /** enhetskod → nyckeltal → värde */
  keyFigures: z.record(z.string(), z.record(z.string(), z.number().nullable())).optional(),
});

/**
 * Skattekalkylator – personlig Sankey över vart skatten på en lön går (src/components/TaxSankey.tsx).
 * Regler (belopp/procentsatser) och skattesatser per kommun kommer från Skatteverket; beräkningen görs i
 * src/lib/tax.ts. Andra steget fördelar kommunens, regionens och statens del efter deras budgetandelar,
 * hämtade ur flödesdatasetens årsfiler (`breakdowns`).
 */
export const TaxRulesSchema = z.object({
  year: z.string(),
  pbb: z.number(),
  ibb: z.number(),
  grundavdrag: z.object({
    lowLimit: z.number(),
    low: z.number(),
    upRate: z.number(),
    midStart: z.number(),
    mid: z.number(),
    highStart: z.number(),
    downRate: z.number(),
    highEnd: z.number(),
    high: z.number(),
  }),
  jobbskatteavdrag: z.object({
    step1: z.number(),
    step2: z.number(),
    step3: z.number(),
    rate2: z.number(),
    base3: z.number(),
    rate3: z.number(),
    max: z.number(),
  }),
  forvarvsreduktion: z.object({ lower: z.number(), upper: z.number(), rate: z.number() }),
  skiktgrans: z.number(),
  statligSkatt: z.number(),
  pensionsavgift: z.object({ rate: z.number(), capIbb: z.number(), minPbb: z.number() }),
  publicService: z.object({ rate: z.number(), capIbb: z.number() }),
  pensionCapIbb: z.number(),
  pensionSplit: z.object({ inkomstpension: z.number(), premiepension: z.number() }),
  arbetsgivaravgifter: z.array(
    z.object({ key: z.string(), label: z.string(), rate: z.number(), description: z.string().optional() }),
  ),
});

export const LocalRatesSchema = z.object({
  kommun: z.number(),
  region: z.number(),
  begravning: z.number(),
  kyrka: z.number(),
});

/** Hur en mottagares del (kommun/region/stat) fördelas på verksamheter i diagrammets andra steg. */
export const BreakdownSchema = z.object({
  /** Flödesdataset och år som andelarna hämtas från (public/<dataPath>/<year>.json). */
  dataPath: z.string(),
  year: z.string(),
  /** Noder i flödet som ingår i fördelningen (övriga, t.ex. överskott, ignoreras). */
  include: z.array(z.string()),
  groups: z.array(z.object({ id: z.string(), label: z.string(), nodes: z.array(z.string()), description: z.string().optional() })),
  otherLabel: z.string(),
});

export const TaxCalculatorDatasetSchema = z.object({
  ...baseFields,
  kind: z.literal('calculator'),
  years: z.array(z.string()).min(1),
  rules: z.record(z.string(), TaxRulesSchema),
  municipalities: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      group: z.string().optional(),
      /** Enhetskod i regionflödet (t.ex. "12L"). */
      region: z.string(),
      regionName: z.string(),
      /** år → skattesatser */
      rates: z.record(z.string(), LocalRatesSchema),
    }),
  ),
  defaultMunicipality: z.string(),
  defaultSalary: z.number(),
  breakdowns: z.object({ kommun: BreakdownSchema, region: BreakdownSchema, staten: BreakdownSchema }),
});

/** Alla datasettyper. Filer utan `kind` tolkas som tidsserier (bakåtkompatibelt). */
export const AnyDatasetSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('kind' in v) ? { ...v, kind: 'timeseries' } : v),
  z.discriminatedUnion('kind', [DatasetSchema, RegionalDatasetSchema, FlowDatasetSchema, TaxCalculatorDatasetSchema]),
);

export type Source = z.infer<typeof SourceSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Series = z.infer<typeof SeriesSchema>;
export type ChartType = z.infer<typeof ChartTypeSchema>;
/** Tidsseriedataset (historiskt namn). */
export type Dataset = z.infer<typeof DatasetSchema>;
export type DatasetInput = z.input<typeof DatasetSchema>;
export type RegionalMetric = z.infer<typeof RegionalMetricSchema>;
export type RegionalDataset = z.infer<typeof RegionalDatasetSchema>;
export type RegionalDatasetInput = z.input<typeof RegionalDatasetSchema>;
export type RegionalYear = z.infer<typeof RegionalYearSchema>;
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowDataset = z.infer<typeof FlowDatasetSchema>;
export type FlowDatasetInput = z.input<typeof FlowDatasetSchema>;
export type FlowYear = z.infer<typeof FlowYearSchema>;
export type TaxRules = z.infer<typeof TaxRulesSchema>;
export type LocalRates = z.infer<typeof LocalRatesSchema>;
export type Breakdown = z.infer<typeof BreakdownSchema>;
export type TaxCalculatorDataset = z.infer<typeof TaxCalculatorDatasetSchema>;
export type TaxCalculatorDatasetInput = z.input<typeof TaxCalculatorDatasetSchema>;
export type AnyDataset = Dataset | RegionalDataset | FlowDataset | TaxCalculatorDataset;
