/**
 * Register över datakällor. `kind: 'primär'` = myndighet/officiell statistik som får användas som datakälla.
 * `kind: 'referens'` = intresseorganisationer m.fl. som används för inspiration och för att hitta primärkällan –
 * deras siffror visas ALDRIG direkt på sajten. Se CLAUDE.md § Principer.
 */
export interface SourceOrg {
  id: string;
  name: string;
  url: string;
  kind: 'primär' | 'referens';
  description: string;
  /** Öppet API eller nedladdningstjänst, om sådan finns. */
  api?: string;
}

export const sources: SourceOrg[] = [
  {
    id: 'scb',
    name: 'SCB – Statistiska centralbyrån',
    url: 'https://www.scb.se/',
    kind: 'primär',
    description: 'Sveriges officiella statistik: befolkning, ekonomi, miljö, energi, val m.m. Statistikdatabasen har ett öppet API (PxWebApi 2).',
    api: 'https://statistikdatabasen.scb.se/api/v2/',
  },
  {
    id: 'smhi',
    name: 'SMHI – Sveriges meteorologiska och hydrologiska institut',
    url: 'https://www.smhi.se/',
    kind: 'primär',
    description: 'Meteorologiska observationer (temperatur, nederbörd, vind m.m.), hydrologi och oceanografi. Öppna data under CC BY 4.0.',
    api: 'https://opendata-download-metobs.smhi.se/api/',
  },
  {
    id: 'svk',
    name: 'Svenska kraftnät',
    url: 'https://www.svk.se/',
    kind: 'primär',
    description: 'Stamnätet för el: produktion, förbrukning, utbyte och kraftbalans per elområde. Data via Mimer.',
    api: 'https://mimer.svk.se/',
  },
  {
    id: 'naturvardsverket',
    name: 'Naturvårdsverket',
    url: 'https://www.naturvardsverket.se/',
    kind: 'primär',
    description: 'Ansvarar för Sveriges växthusgasinventering och miljömålsuppföljning. Utsläppsdatan publiceras även via SCB.',
  },
  {
    id: 'energimyndigheten',
    name: 'Energimyndigheten',
    url: 'https://www.energimyndigheten.se/',
    kind: 'primär',
    description: 'Energibalanser, energistatistik och prognoser. Officiell energistatistik publiceras även via SCB.',
  },
  {
    id: 'val',
    name: 'Valmyndigheten',
    url: 'https://www.val.se/',
    kind: 'primär',
    description: 'Valresultat för riksdags-, region- och kommunval samt EU-val.',
  },
  {
    id: 'esv',
    name: 'ESV – Ekonomistyrningsverket',
    url: 'https://www.esv.se/',
    kind: 'primär',
    description:
      'Prognoser för offentliga finanser. Webbplatsen var inte nåbar i november 2026; statsbudgetens utfall hämtas i stället från Statskontoret.',
  },
  {
    id: 'statskontoret',
    name: 'Statskontoret',
    url: 'https://www.statskontoret.se/',
    kind: 'primär',
    description: 'Publicerar statsbudgetens utfall – inkomster per inkomsttitel och utgifter per utgiftsområde och anslag – som öppna data (CC0).',
    api: 'https://www.statskontoret.se/analys-och-statistik/oppna-data/arsutfall/',
  },
  {
    id: 'skatteverket',
    name: 'Skatteverket',
    url: 'https://www.skatteverket.se/',
    kind: 'primär',
    description:
      'Skattesatser per kommun och församling, skattetabeller och regler (belopp och procent). Öppna data (CC0) via skatteverket.entryscape.net.',
  },
  {
    id: 'riksgalden',
    name: 'Riksgälden',
    url: 'https://www.riksgalden.se/',
    kind: 'primär',
    description: 'Statens internbank. Ansvarar för statens upplåning och den officiella statistiken över statsskulden (publiceras även via SCB).',
  },
  {
    id: 'riksbanken',
    name: 'Sveriges riksbank',
    url: 'https://www.riksbank.se/',
    kind: 'primär',
    description: 'Styrränta, växelkurser och finansiell statistik. Öppet API (SWEA).',
    api: 'https://api.riksbank.se/',
  },
  {
    id: 'lantmateriet',
    name: 'Lantmäteriet',
    url: 'https://www.lantmateriet.se/',
    kind: 'primär',
    description: 'Kartor, gränser för län och kommuner, höjddata. Öppna geodata.',
  },
  {
    id: 'trafikanalys',
    name: 'Trafikanalys',
    url: 'https://www.trafa.se/',
    kind: 'primär',
    description: 'Officiell statistik om fordon, trafik och resvanor. Öppet API.',
    api: 'https://api.trafa.se/',
  },
  {
    id: 'socialstyrelsen',
    name: 'Socialstyrelsen',
    url: 'https://www.socialstyrelsen.se/',
    kind: 'primär',
    description: 'Hälso- och sjukvårdsstatistik, dödsorsaker, läkemedel.',
  },
  {
    id: 'folkhalsomyndigheten',
    name: 'Folkhälsomyndigheten',
    url: 'https://www.folkhalsomyndigheten.se/',
    kind: 'primär',
    description: 'Folkhälsodata, smittskydd och levnadsvanor.',
  },
  {
    id: 'bra',
    name: 'Brå – Brottsförebyggande rådet',
    url: 'https://bra.se/',
    kind: 'primär',
    description: 'Kriminalstatistik: anmälda brott, lagförda personer, Nationella trygghetsundersökningen.',
  },
  {
    id: 'skolverket',
    name: 'Skolverket',
    url: 'https://www.skolverket.se/',
    kind: 'primär',
    description: 'Statistik om förskola, skola och vuxenutbildning.',
  },
  {
    id: 'jordbruksverket',
    name: 'Jordbruksverket',
    url: 'https://jordbruksverket.se/',
    kind: 'primär',
    description: 'Jordbruksstatistik: arealer, skördar, djurhållning.',
  },
  {
    id: 'skogsstyrelsen',
    name: 'Skogsstyrelsen',
    url: 'https://www.skogsstyrelsen.se/',
    kind: 'primär',
    description: 'Skogsstatistik: avverkning, skogsmark, virkespriser.',
  },
  {
    id: 'af',
    name: 'Arbetsförmedlingen',
    url: 'https://arbetsformedlingen.se/',
    kind: 'primär',
    description: 'Inskrivna arbetslösa, lediga jobb. Öppna data och API:er (JobTech).',
  },
  {
    id: 'ekonomifakta',
    name: 'Ekonomifakta',
    url: 'https://www.ekonomifakta.se/',
    kind: 'referens',
    description: 'Drivs av Svenskt Näringsliv. Bra översikter och inspiration; används för att hitta den underliggande officiella källan, inte som datakälla.',
  },
  {
    id: 'naturskyddsforeningen',
    name: 'Naturskyddsföreningen',
    url: 'https://www.naturskyddsforeningen.se/',
    kind: 'referens',
    description: 'Miljöorganisation. Rapporter och analyser används som inspiration; siffror hämtas från primärkällan.',
  },
];

export const sourceById = Object.fromEntries(sources.map((s) => [s.id, s])) as Record<string, SourceOrg>;
