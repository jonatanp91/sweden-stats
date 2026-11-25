/**
 * Kör ett paket-CLI (astro, vitest) med normaliserad arbetskatalog: `node scripts/run.mjs <paket> [argument...]`.
 *
 * Varför: på Windows kan terminalen (t.ex. i VS Code) starta i "c:\..." med liten drive-bokstav. Då laddar
 * Vite/Vitest moduler under två olika sökvägar ("c:" och "C:") – Astro-bygget tappar alla <link rel="stylesheet">
 * och Vitest kraschar med "Cannot read properties of undefined (reading 'config')". process.chdir() hjälper inte
 * (Windows behåller skiftläget), men en barnprocess som startas med explicit `cwd` får rätt sökväg.
 * Se docs/beslut.md.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [pkg, ...args] = process.argv.slice(2);
if (!pkg) {
  console.error('Användning: node scripts/run.mjs <paket> [argument...]');
  process.exit(1);
}

const cwd = process.platform === 'win32' ? process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase()) : process.cwd();
const pkgDir = join(cwd, 'node_modules', pkg);
const { bin } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const binPath = join(pkgDir, typeof bin === 'string' ? bin : bin[pkg]);

const result = spawnSync(process.execPath, [binPath, ...args], { stdio: 'inherit', cwd });
process.exit(result.status ?? 1);
