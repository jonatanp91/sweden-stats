import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoryBySlug } from '../../src/data/categories.ts';
import {
  DatasetSchema,
  FlowDatasetSchema,
  FlowYearSchema,
  RegionalDatasetSchema,
  RegionalYearSchema,
  TaxCalculatorDatasetSchema,
  type Dataset,
  type DatasetInput,
  type FlowDataset,
  type RegionalDataset,
  type TaxCalculatorDataset,
} from '../../src/lib/types.ts';
import type { CalculatorOutput, FileOutput, FlowOutput, RegionalOutput } from './fetcher.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATASETS_DIR = join(ROOT, 'src/data/datasets');
export const PUBLIC_DIR = join(ROOT, 'public');

function checkCategory(id: string, category: string) {
  if (!categoryBySlug[category]) {
    throw new Error(`Dataset ${id}: okänd kategori "${category}" (se src/data/categories.ts)`);
  }
}

async function writeMeta(id: string, content: string) {
  await mkdir(DATASETS_DIR, { recursive: true });
  await writeFile(join(DATASETS_DIR, `${id}.json`), content, 'utf8');
}

/** Skriver årsfiler till public/<dataPath>/<år>.json; gamla årsfiler tas bort först. */
async function writeYearFiles(dataPath: string, years: { year: string }[]) {
  const dir = join(PUBLIC_DIR, dataPath);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const y of years) {
    await writeFile(join(dir, `${y.year}.json`), JSON.stringify(y), 'utf8');
  }
}

/** Validerar mot DatasetSchema och skriver src/data/datasets/<id>.json. */
export async function writeDataset(input: DatasetInput): Promise<Dataset> {
  const ds = DatasetSchema.parse(input);
  checkCategory(ds.id, ds.category);
  const nonEmpty = ds.series.filter((s) => s.points.some((p) => p.v !== null));
  if (nonEmpty.length === 0) throw new Error(`Dataset ${ds.id}: alla serier saknar värden`);
  await writeMeta(ds.id, serialize(ds));
  return ds;
}

/** Validerar ett regionalt dataset och skriver metadata + årsfiler. */
export async function writeRegionalDataset(out: RegionalOutput): Promise<RegionalDataset> {
  const ds = RegionalDatasetSchema.parse(out.meta);
  checkCategory(ds.id, ds.category);
  const years = out.years.map((y) => RegionalYearSchema.parse(y));
  const yearSet = new Set(years.map((y) => y.year));
  for (const y of ds.years) if (!yearSet.has(y)) throw new Error(`Dataset ${ds.id}: årsfil saknas för ${y}`);
  if (!ds.metrics.some((m) => m.key === ds.defaultMetric)) throw new Error(`Dataset ${ds.id}: okänt defaultMetric`);
  const codes = new Set(ds.regions.map((r) => r.code));
  for (const y of years) {
    for (const code of Object.keys(y.values)) {
      if (!codes.has(code)) throw new Error(`Dataset ${ds.id} ${y.year}: okänd regionkod ${code}`);
    }
  }
  await writeYearFiles(ds.dataPath, years);
  await writeMeta(ds.id, JSON.stringify(ds, null, 2) + '\n');
  return ds;
}

/**
 * Validerar ett flödesdataset och skriver metadata + årsfiler.
 * Kontroll: för varje enhet och år ska summan av inflöden vara lika med summan av utflöden (±0,5 %).
 */
export async function writeFlowDataset(out: FlowOutput): Promise<FlowDataset> {
  const ds = FlowDatasetSchema.parse(out.meta);
  checkCategory(ds.id, ds.category);
  const side = new Map(ds.nodes.map((n) => [n.id, n.side]));
  const byId = new Map(ds.nodes.map((n) => [n.id, n]));
  if (byId.size !== ds.nodes.length) throw new Error(`Dataset ${ds.id}: dubbla nod-id:n`);
  for (const n of ds.nodes) {
    if (!n.parent) continue;
    const p = byId.get(n.parent);
    if (!p || p.role !== 'group' || p.side !== n.side) {
      throw new Error(`Dataset ${ds.id}: nod ${n.id} har ogiltig grupp ${n.parent} (måste vara gruppnod på samma sida)`);
    }
  }
  const figureKeys = new Set(ds.keyFigures.map((k) => k.key));
  const entities = new Set(ds.entities.map((e) => e.code));
  const years = out.years.map((y) => FlowYearSchema.parse(y));
  for (const y of years) {
    for (const [entity, figures] of Object.entries(y.keyFigures ?? {})) {
      if (!entities.has(entity)) throw new Error(`Dataset ${ds.id} ${y.year}: nyckeltal för okänd enhet ${entity}`);
      for (const k of Object.keys(figures)) {
        if (!figureKeys.has(k)) throw new Error(`Dataset ${ds.id} ${y.year}: okänt nyckeltal ${k}`);
      }
    }
    for (const [entity, values] of Object.entries(y.values)) {
      if (!entities.has(entity)) throw new Error(`Dataset ${ds.id} ${y.year}: okänd enhet ${entity}`);
      let sumIn = 0;
      let sumOut = 0;
      for (const [node, v] of Object.entries(values)) {
        const s = side.get(node);
        if (!s) throw new Error(`Dataset ${ds.id} ${y.year} ${entity}: okänd nod ${node}`);
        if (byId.get(node)!.role === 'group') throw new Error(`Dataset ${ds.id} ${y.year} ${entity}: gruppnoden ${node} får inte ha belopp`);
        if (v < 0) throw new Error(`Dataset ${ds.id} ${y.year} ${entity}: negativt belopp för ${node}`);
        if (s === 'in') sumIn += v;
        else sumOut += v;
      }
      if (Math.abs(sumIn - sumOut) > Math.max(sumIn, sumOut) * 0.005 + 0.5) {
        throw new Error(`Dataset ${ds.id} ${y.year} ${entity}: inflöden ${sumIn} ≠ utflöden ${sumOut}`);
      }
    }
  }
  await writeYearFiles(ds.dataPath, years);
  await writeMeta(ds.id, JSON.stringify(ds, null, 2) + '\n');
  return ds;
}

/** Validerar en skattekalkylator och skriver metadata. */
export async function writeCalculatorDataset(out: CalculatorOutput): Promise<TaxCalculatorDataset> {
  const ds = TaxCalculatorDatasetSchema.parse(out.meta);
  checkCategory(ds.id, ds.category);
  for (const y of ds.years) {
    if (!ds.rules[y]) throw new Error(`Dataset ${ds.id}: regler saknas för ${y}`);
    for (const m of ds.municipalities) if (!m.rates[y]) throw new Error(`Dataset ${ds.id}: skattesatser saknas för ${m.code} ${y}`);
  }
  if (!ds.municipalities.some((m) => m.code === ds.defaultMunicipality)) throw new Error(`Dataset ${ds.id}: okänd standardkommun`);
  await writeMeta(ds.id, JSON.stringify(ds, null, 2) + '\n');
  return ds;
}

/** Skriver en statisk fil under public/. */
export async function writePublicFile(out: FileOutput): Promise<string> {
  const file = join(PUBLIC_DIR, out.path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, out.content, 'utf8');
  return out.path;
}

/** JSON med en datapunkt per rad – läsbara diffar i git utan att filerna blir enorma. */
function serialize(ds: Dataset): string {
  const { series, ...meta } = ds;
  const head = JSON.stringify(meta, null, 2).replace(/\n}$/, '');
  const seriesJson = series
    .map((s) => {
      const { points, ...seriesMeta } = s;
      const pts = points.map((p) => `        ${JSON.stringify(p)}`).join(',\n');
      const metaLines = Object.entries(seriesMeta)
        .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`)
        .join('');
      return `    {\n${metaLines}      "points": [\n${pts}\n      ]\n    }`;
    })
    .join(',\n');
  return `${head},\n  "series": [\n${seriesJson}\n  ]\n}\n`;
}
