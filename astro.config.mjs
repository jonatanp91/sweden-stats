// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import { fileURLToPath } from 'node:url';

// Windows: normalisera drive-bokstaven till versal. Om terminalen startar i "c:\..." (t.ex. VS Code)
// tappar Astro/Vite annars kopplingen mellan sidor och CSS, och bygget saknar stilmallar. Se docs/beslut.md.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase());

// När sajten publiceras (t.ex. GitHub Pages) sätts `site` och ev. `base` här.
// All intern länkning går via `url()` i src/lib/url.ts så att `base` fungerar.
export default defineConfig({
  root,
  integrations: [react()],
  trailingSlash: 'always',
});
