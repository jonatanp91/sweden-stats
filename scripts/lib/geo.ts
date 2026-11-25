/**
 * Kartgeometri för Sveriges kommuner.
 *
 * SCB:s öppna WFS-tjänst saknar ett färdigt kommunlager, men RegSO (regionala statistikområden) delar in
 * varje kommun utan överlapp och har attributet `kommunkod`. Vi hämtar RegSO och slår ihop (dissolve)
 * områdena per kommun med mapshaper, förenklar linjerna och sparar som GeoJSON i WGS84.
 */
import mapshaper from 'mapshaper';
import { fetchWithRetry } from './http.ts';

export const SCB_WFS = 'https://geodata.scb.se/geoserver/stat/wfs';
export const REGSO_LAYER = 'stat:RegSO_2025';

export function regsoUrl(): string {
  const p = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: REGSO_LAYER,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    propertyName: 'kommunkod,lanskod,sp_geometry',
  });
  return `${SCB_WFS}?${p}`;
}

export async function fetchRegso(): Promise<{ geojson: string; apiUrl: string }> {
  const apiUrl = regsoUrl();
  const res = await fetchWithRetry(apiUrl);
  return { geojson: await res.text(), apiUrl };
}

/**
 * Slår ihop RegSO-områden till kommuner och förenklar. `simplify` anges i procent av punkterna som behålls.
 * Returnerar GeoJSON-text med egenskaperna kommunkod och lanskod.
 */
export async function dissolveToMunicipalities(regsoGeojson: string, simplify = '3%'): Promise<string> {
  const out = await mapshaper.applyCommands(
    `-i regso.json -dissolve kommunkod copy-fields=lanskod -simplify ${simplify} keep-shapes -clean -o kommuner.json format=geojson precision=0.0005`,
    { 'regso.json': regsoGeojson },
  );
  return out['kommuner.json'].toString();
}

interface Feature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
}

/** Lägger till namn på varje kommun och kontrollerar att koderna matchar förväntad lista. */
export function annotateMunicipalities(geojson: string, names: Map<string, string>): { content: string; count: number } {
  const fc = JSON.parse(geojson) as { type: string; features: Feature[] };
  const seen = new Set<string>();
  for (const f of fc.features) {
    const code = String(f.properties.kommunkod);
    const name = names.get(code);
    if (!name) throw new Error(`Kommunkod ${code} i geometrin saknas i SCB:s kommunlista`);
    seen.add(code);
    f.properties = { code, name, lan: String(f.properties.lanskod) };
  }
  const missing = [...names.keys()].filter((c) => !seen.has(c));
  if (missing.length) throw new Error(`Geometri saknas för kommunerna ${missing.join(', ')}`);
  return { content: JSON.stringify(fc), count: fc.features.length };
}
