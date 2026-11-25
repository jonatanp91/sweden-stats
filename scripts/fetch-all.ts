/**
 * Kör hämtare och skriver dataset till src/data/datasets/.
 *   npm run fetch:data            → alla hämtare
 *   npm run fetch -- el klimat    → bara angivna hämtare (namn eller dataset-id)
 */
import { fetchers } from './datasets/index.ts';
import {
  writeCalculatorDataset,
  writeDataset,
  writeFlowDataset,
  writePublicFile,
  writeRegionalDataset,
} from './lib/write-dataset.ts';

const args = process.argv.slice(2);
const selected = args.length
  ? fetchers.filter((f) => args.includes(f.name) || f.produces.some((id) => args.includes(id)))
  : fetchers;

if (selected.length === 0) {
  console.error(`Inga hämtare matchar: ${args.join(', ')}\nTillgängliga: ${fetchers.map((f) => f.name).join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const f of selected) {
  const start = Date.now();
  try {
    const outputs = await f.run();
    for (const o of outputs) {
      if (!('output' in o)) {
        const written = await writeDataset(o);
        const pts = written.series.reduce((a, s) => a + s.points.length, 0);
        console.log(`✓ ${written.id} (${written.series.length} serier, ${pts} punkter)`);
      } else if (o.output === 'regional') {
        const written = await writeRegionalDataset(o);
        console.log(`✓ ${written.id} (${written.regions.length} regioner, ${written.years.length} år, ${written.metrics.length} mått)`);
      } else if (o.output === 'flow') {
        const written = await writeFlowDataset(o);
        console.log(`✓ ${written.id} (${written.entities.length} enheter, ${written.years.length} år, ${written.nodes.length} noder)`);
      } else if (o.output === 'calculator') {
        const written = await writeCalculatorDataset(o);
        console.log(`✓ ${written.id} (${written.municipalities.length} kommuner, år ${written.years.join(', ')})`);
      } else {
        const path = await writePublicFile(o);
        console.log(`✓ public/${path} (${(o.content.length / 1024).toFixed(0)} kB)`);
      }
    }
    console.log(`  ${f.name} klar på ${((Date.now() - start) / 1000).toFixed(1)} s`);
  } catch (e) {
    failed++;
    console.error(`✗ ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exit(failed ? 1 : 0);
