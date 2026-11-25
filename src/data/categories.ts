/**
 * Kategoriregistret styr startsidans rutnät, navigeringen och vilka kategorisidor som genereras
 * (src/pages/[kategori]/index.astro). Lägg till en kategori genom att lägga till ett objekt här.
 *
 * - `datasets`: id:n i src/data/datasets/<id>.json som visas på sidan, i ordning.
 * - `sources`: id:n i src/data/sources.ts – planerade/använda primärkällor.
 * - `ideas`: idéer på vad som kan visualiseras härnäst (visas som "på gång" på sidan).
 */
export interface Category {
  slug: string;
  name: string;
  description: string;
  datasets: string[];
  sources: string[];
  ideas: string[];
}

export const categories: Category[] = [
  {
    slug: 'befolkning',
    name: 'Befolkning',
    description: 'Hur många vi är, hur vi föds, dör och flyttar – från 1749 till idag.',
    datasets: ['befolkning-folkmangd', 'befolkning-forandringar'],
    sources: ['scb'],
    ideas: [
      'Befolkningspyramid efter ålder och kön',
      'Folkmängd per län och kommun (karta)',
      'Utrikes födda över tid',
      'Medellivslängd och fruktsamhet',
    ],
  },
  {
    slug: 'klimat',
    name: 'Klimat & väder',
    description: 'Temperatur, nederbörd och långa mätserier från SMHI:s stationer.',
    datasets: ['klimat-temperatur-lund'],
    sources: ['smhi'],
    ideas: [
      'Jämförelse mellan stationer från norr till söder',
      'Nederbörd och snötäcke över tid',
      'Isläggning och islossning',
      'Antal sommardagar och tropiska nätter',
    ],
  },
  {
    slug: 'utslapp',
    name: 'Utsläpp & miljö',
    description: 'Sveriges växthusgasutsläpp per sektor och utvecklingen mot klimatmålen.',
    datasets: ['utslapp-vaxthusgaser-sektor'],
    sources: ['naturvardsverket', 'scb'],
    ideas: [
      'Konsumtionsbaserade utsläpp jämfört med territoriella',
      'Utsläpp per invånare och per län',
      'Kolsänkan i skog och mark (LULUCF)',
      'Avfall och återvinning',
    ],
  },
  {
    slug: 'energi',
    name: 'Energi',
    description: 'Energitillförsel och energianvändning – bränslen, sektorer och förnybart.',
    datasets: [],
    sources: ['energimyndigheten', 'scb'],
    ideas: ['Energibalans (Sankey-diagram)', 'Andel förnybar energi', 'Bränslepriser över tid'],
  },
  {
    slug: 'el',
    name: 'El',
    description: 'Elproduktion per kraftslag, elanvändning och elområden.',
    datasets: ['el-produktion-kraftslag', 'el-produktion-manad'],
    sources: ['scb', 'energimyndigheten', 'svk'],
    ideas: [
      'Timvis produktion och förbrukning (Svenska kraftnät)',
      'Elpriser per elområde',
      'Import och export av el',
      'Installerad effekt per kraftslag',
    ],
  },
  {
    slug: 'ekonomi',
    name: 'Ekonomi',
    description: 'BNP, inflation, räntor, handel och hushållens ekonomi.',
    datasets: [],
    sources: ['scb', 'riksbanken'],
    ideas: ['BNP och BNP per capita', 'Inflation (KPIF)', 'Styrränta', 'Export och import per land'],
  },
  {
    slug: 'skatter',
    name: 'Skatter & offentliga finanser',
    description:
      'Kommunalskatt, kommunernas, regionernas och statens budgetar, och statsskulden. Räkna ut vart din egen skatt går, utforska din kommun på kartan och se vart skattepengarna tar vägen.',
    datasets: [
      'skatter-kalkylator',
      'skatter-kommuner',
      'skatter-kommun-flode',
      'skatter-region-flode',
      'skatter-staten-flode',
      'skatter-statsskuld',
      'skatter-skuld-bnp',
      'skatter-kommunalskatt-riket',
    ],
    sources: ['scb', 'statskontoret', 'riksgalden', 'skatteverket'],
    ideas: [
      'Statens utgifter per utgiftsområde över tid',
      'Skattetryck: skatternas andel av BNP över tid',
      'Kommunernas skulder och investeringar per invånare',
    ],
  },
  {
    slug: 'arbetsmarknad',
    name: 'Arbetsmarknad',
    description: 'Sysselsättning, arbetslöshet och löner.',
    datasets: [],
    sources: ['scb', 'af'],
    ideas: ['Arbetslöshet (AKU)', 'Löner per yrke', 'Sysselsättning per bransch'],
  },
  {
    slug: 'boende',
    name: 'Boende',
    description: 'Bostadsbyggande, bostadspriser och boendeformer.',
    datasets: [],
    sources: ['scb'],
    ideas: ['Påbörjade bostäder', 'Fastighetsprisindex', 'Upplåtelseformer'],
  },
  {
    slug: 'politik',
    name: 'Politik & val',
    description: 'Valresultat, valdeltagande och mandatfördelning.',
    datasets: [],
    sources: ['val', 'scb'],
    ideas: ['Riksdagsvalen sedan 1921', 'Valdeltagande över tid', 'Partisympatiundersökningen (SCB)'],
  },
  {
    slug: 'geografi',
    name: 'Geografi',
    description: 'Län, kommuner, markanvändning och tätorter.',
    datasets: [],
    sources: ['lantmateriet', 'scb'],
    ideas: ['Karta över län och kommuner', 'Markanvändning', 'Tätorternas tillväxt'],
  },
  {
    slug: 'utbildning',
    name: 'Utbildning',
    description: 'Utbildningsnivå, skolresultat och högre utbildning.',
    datasets: [],
    sources: ['scb', 'skolverket'],
    ideas: ['Befolkningens utbildningsnivå', 'Behörighet till gymnasiet', 'Antal studenter'],
  },
  {
    slug: 'halsa',
    name: 'Hälsa',
    description: 'Livslängd, dödsorsaker och vård.',
    datasets: [],
    sources: ['socialstyrelsen', 'folkhalsomyndigheten', 'scb'],
    ideas: ['Medellivslängd per län', 'Dödsorsaker över tid', 'Väntetider i vården'],
  },
  {
    slug: 'transporter',
    name: 'Transporter',
    description: 'Fordonsflottan, elbilar, kollektivtrafik och resvanor.',
    datasets: [],
    sources: ['trafikanalys', 'scb'],
    ideas: ['Nyregistrerade bilar per drivmedel', 'Kollektivtrafikresor', 'Trafikolyckor'],
  },
  {
    slug: 'brott',
    name: 'Brott & rättsväsende',
    description: 'Anmälda brott, lagföringar och trygghet.',
    datasets: [],
    sources: ['bra'],
    ideas: ['Anmälda brott per brottstyp', 'Nationella trygghetsundersökningen'],
  },
  {
    slug: 'jord-skog',
    name: 'Jord- & skogsbruk',
    description: 'Åkermark, skördar, djurhållning och skogens tillväxt och avverkning.',
    datasets: [],
    sources: ['jordbruksverket', 'skogsstyrelsen', 'scb'],
    ideas: ['Skörd per gröda', 'Antal mjölkkor', 'Avverkning och tillväxt i skogen'],
  },
];

export const categoryBySlug = Object.fromEntries(categories.map((c) => [c.slug, c])) as Record<
  string,
  Category
>;
