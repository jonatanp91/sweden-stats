/** Gemensam HTTP-hjälpare: identifierande User-Agent, timeout och återförsök vid 429/5xx. */

const USER_AGENT = 'sweden-stats/0.1 (öppen statistikvisualisering)';

export async function fetchWithRetry(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/csv, */*', ...init.headers },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} för ${url}`);
      } else {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} för ${url}\n${body.slice(0, 500)}`);
      }
    } catch (e) {
      lastError = e;
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message) && !e.message.includes('429')) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  throw lastError;
}
