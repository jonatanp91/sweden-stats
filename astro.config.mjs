// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

// Windows: normalisera drive-bokstaven till versal. Om terminalen startar i "c:\..." (t.ex. VS Code)
// tappar Astro/Vite annars kopplingen mellan sidor och CSS, och bygget saknar stilmallar. Se docs/beslut.md.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase());

// Publicering (GitHub Pages, .github/workflows/deploy.yml): arbetsflödet sätter SITE_URL och BASE_PATH,
// t.ex. https://<användare>.github.io och /sweden-stats. Lokalt är de tomma → sajten ligger i roten.
// All intern länkning går via `url()` i src/lib/url.ts så att `base` fungerar. Se docs/beslut.md B-018.
export default defineConfig({
  root,
  site: process.env.SITE_URL || undefined,
  base: process.env.BASE_PATH || '/',
  integrations: [react()],
  trailingSlash: 'always',
});
