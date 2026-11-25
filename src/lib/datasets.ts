/**
 * Läser in alla dataset (metadata + tidsserier) vid build-tid och validerar dem mot schemat.
 * Ett ogiltigt dataset får bygget att fallera – hellre det än att fel data publiceras.
 * Regionala dataset och flödesdataset har sina värden i public/<dataPath>/<år>.json; de hämtas av
 * respektive React-ö i webbläsaren.
 */
import { AnyDatasetSchema, type AnyDataset, type Dataset } from './types';

const modules = import.meta.glob<{ default: unknown }>('../data/datasets/*.json', { eager: true });

const all: Record<string, AnyDataset> = {};
for (const [path, mod] of Object.entries(modules)) {
  const parsed = AnyDatasetSchema.safeParse(mod.default);
  if (!parsed.success) {
    throw new Error(`Ogiltigt dataset ${path}:\n${parsed.error.message}`);
  }
  all[parsed.data.id] = parsed.data;
}

export function getDataset(id: string): AnyDataset | undefined {
  return all[id];
}

export function requireDataset(id: string): AnyDataset {
  const ds = all[id];
  if (!ds) throw new Error(`Dataset "${id}" saknas – kör \`npm run fetch:data\` eller kontrollera src/data/categories.ts`);
  return ds;
}

/** Som requireDataset men kräver en tidsserie (för nyckeltal m.m.). */
export function requireTimeSeries(id: string): Dataset {
  const ds = requireDataset(id);
  if (ds.kind !== 'timeseries') throw new Error(`Dataset "${id}" är inte en tidsserie (kind=${ds.kind})`);
  return ds;
}

export function allDatasets(): AnyDataset[] {
  return Object.values(all);
}
