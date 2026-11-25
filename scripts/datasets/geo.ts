/**
 * Kartgeometri – Sveriges 290 kommuner, sammanslagna från SCB:s RegSO 2025 (öppna geodata, CC0).
 * Producerar: public/geo/kommuner.json (används av src/components/RegionMap.tsx)
 */
import type { Fetcher } from '../lib/fetcher.ts';
import { annotateMunicipalities, dissolveToMunicipalities, fetchRegso } from '../lib/geo.ts';
import { fetchPxMetadata, dimensionLabels } from '../lib/pxweb.ts';

export const geo: Fetcher = {
  name: 'geo',
  produces: ['geo/kommuner.json'],
  async run() {
    // Kommunnamn från SCB:s skattesatstabell (kommunkoder är fyrsiffriga)
    const meta = await fetchPxMetadata('TAB2017');
    const names = new Map(
      dimensionLabels(meta, 'Region')
        .filter((r) => /^\d{4}$/.test(r.code))
        .map((r) => [r.code, r.label]),
    );
    const { geojson } = await fetchRegso();
    const dissolved = await dissolveToMunicipalities(geojson);
    const { content, count } = annotateMunicipalities(dissolved, names);
    if (count !== 290) throw new Error(`Förväntade 290 kommuner, fick ${count}`);
    return [{ output: 'file', path: 'geo/kommuner.json', content }];
  },
};
