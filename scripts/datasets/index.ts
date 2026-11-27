/** Register över alla hämtare. Lägg till nya här. */
import type { Fetcher } from '../lib/fetcher.ts';
import { befolkning } from './befolkning.ts';
import { el } from './el.ts';
import { geo } from './geo.ts';
import { klimat } from './klimat.ts';
import { skattekalkyl } from './skattekalkyl.ts';
import { skattekvot } from './skattekvot.ts';
import { skatter } from './skatter.ts';
import { staten } from './staten.ts';
import { statsskuld } from './statsskuld.ts';
import { utslapp } from './utslapp.ts';

// Ordningen spelar roll: skattekalkyl läser flödesdataseten som skatter och staten skriver.
export const fetchers: Fetcher[] = [befolkning, klimat, utslapp, el, geo, skatter, staten, statsskuld, skattekvot, skattekalkyl];
