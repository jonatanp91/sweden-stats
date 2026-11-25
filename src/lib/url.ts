/** Bygger interna länkar som respekterar `base` i astro.config.mjs (viktigt vid publicering under en undersökväg). */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = path.replace(/^\//, '');
  return `${base}/${p}`;
}
