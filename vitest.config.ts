import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Windows: normalisera drive-bokstaven (samma problem som i astro.config.mjs – se docs/beslut.md).
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase());

export default defineConfig({
  root,
  test: { include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'] },
});
