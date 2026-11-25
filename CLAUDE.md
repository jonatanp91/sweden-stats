# CLAUDE.md – Sverige i siffror

Kontext för kodagenter (och människor) som arbetar i projektet. **Håll filen uppdaterad**: när du lägger till
ett dataset, en kategori, en källa eller fattar ett arkitekturbeslut – uppdatera "Status" nedan,
`docs/datakallor.md` och/eller `docs/beslut.md` i samma ändring.

## Syfte

En webbplats för att utforska officiell svensk statistik per kategori (befolkning, klimat, utsläpp, energi, el,
ekonomi, skatter, politik, geografi m.fl.) med interaktiva visualiseringar. Projektet byggs stegvis utifrån vad
ägaren finner intressant. Långsiktigt mål: publicera sajten publikt.

## Principer (måste följas)

1. **Endast officiella primärkällor.** Myndigheter och officiell statistik (SCB, SMHI, Svenska kraftnät,
   Naturvårdsverket, Energimyndigheten, Valmyndigheten, ESV, Riksbanken …). Intresseorganisationer
   (Ekonomifakta, Naturskyddsföreningen) är *referenser/inspiration* – leta upp primärkällan bakom deras siffror,
   visa aldrig deras siffror direkt. Se `src/data/sources.ts` (`kind: 'primär' | 'referens'`).
2. **Spårbarhet.** Varje dataset har källa, publik länk, API-anrop, tabell-ID, licens, `fetchedAt` och (om källan
   anger det) `updated`. Allt detta visas under diagrammet (`SourceNote.astro`).
3. **Öppen bearbetning.** All bearbetning (summering till helår, sammanslagning av grupper, glidande medel)
   görs i hämtningsskripten och beskrivs i datasetets `notes`. Lägg in summakontroller mot källans totaler
   när serier slås ihop (se `scripts/datasets/utslapp.ts`, `el.ts`).
4. **Ingen data hårdkodad i komponenter.** Data finns bara i `src/data/datasets/*.json`, genererad av skript.
5. **Svenskt UI**, svensk talformatering via `src/lib/format.ts` (`sv-SE`).
6. **Visualiseringsregler:** max 8 serier per diagram (fast färgordning `--series-1..8` i `global.css`, validerad
   för färgblindhet – ändra inte ordningen); fler kategorier slås ihop till "Övrigt". Aldrig dubbla y-axlar.
   Legend vid ≥2 serier. Tabellvy + CSV-nedladdning finns alltid (inbyggt i `Chart.tsx`).

## Kommandon

```bash
npm install
npm run dev            # utvecklingsserver, http://localhost:4321
npm run fetch:data     # hämta ALLA dataset från källorna → src/data/datasets/*.json
npm run fetch -- el    # hämta bara en hämtare (namn) eller ett dataset-id
npm test               # enhetstester (vitest) för parsning/transformering
npm run check          # typkontroll (astro check)
npm run build          # statisk build → dist/
npm run preview        # förhandsgranska dist/
```

**Windows-fallgrop:** kör alltid via `npm run …` (inte `npx astro …`/`npx vitest …`). Skripten går via
`scripts/run.mjs`, som normaliserar drive-bokstaven. Med `c:\` (liten bokstav, vanligt i VS Code) tappar
Astro-bygget annars all CSS och Vitest kraschar. Se `docs/beslut.md` (B-004).

## Arkitektur

- **Astro 7** (statisk sajt) + **React 19**-öar för interaktiva diagram + **Apache ECharts 6** (SVG-renderare).
- **Data-pipeline:** `scripts/datasets/<namn>.ts` (en *hämtare*) → hämtar från API → transformerar →
  `writeDataset()` validerar mot zod-schemat och skriver `src/data/datasets/<id>.json` → checkas in i git.
  Sajten läser JSON-filerna vid build (`src/lib/datasets.ts`, validerar igen).
- **Dataset-schema:** `src/lib/types.ts` – kontraktet mellan skript och sajt. Fyra typer (`kind`):
  `timeseries` (`DatasetSchema`), `regional` (värden per kommun/region och år → karta), `flow`
  (Sankey: inflöden → enhet → (grupper) → utflöden) och `calculator` (skattekalkylatorn: regler och
  skattesatser, beräkning i `src/lib/tax.ts`). Regionala dataset och flödesdataset har bara **metadata** i
  `src/data/datasets/<id>.json`; värdena ligger i `public/data/<id>/<år>.json` och hämtas av ön i webbläsaren
  (annars skulle flera MB bäddas in i HTML:en). Se `docs/beslut.md` B-007.
- **Kartgeometri:** `public/geo/kommuner.json` (290 kommuner, genereras av hämtaren `geo` från SCB:s RegSO).
- **Kategorier:** `src/data/categories.ts` styr startsida, navigering och genererade sidor (`src/pages/[kategori]/`).
- **Källor:** `src/data/sources.ts`.

```
scripts/
  fetch-all.ts             CLI som kör hämtare
  run.mjs                  wrapper för astro/vitest (Windows drive-bokstav)
  lib/pxweb.ts             SCB PxWebApi 2-klient + JSON-stat2 → poster
  lib/smhi.ts              SMHI metobs-klient (CSV) + årsmedel/glidande medel
  lib/http.ts              fetch med retry/timeout
  lib/write-dataset.ts     validering + skrivning (writeDataset/writeRegionalDataset/writeFlowDataset/writePublicFile)
  lib/flows.ts             buildFlow(): resultaträkning → balanserat Sankey-flöde (kommuner/regioner)
  lib/flows.ts             … och incomeStatementFigures(): nyckeltal ur resultaträkningen (karta + flöden)
  lib/statskontoret.ts     Statskontorets årsutfall (zip/CSV) → statens flöde med grupper
  lib/scb-series.ts        delade SCB-årsserier: folkmängd riket, BNP, statsskuld (dec), Maastrichtskuld
  lib/geo.ts               RegSO → kommungränser (mapshaper dissolve + simplify)
  datasets/index.ts        register över hämtare
  datasets/*.ts            en hämtare per ämne
  fixtures/                riktiga API-svar (utdrag) för tester
src/
  data/categories.ts, sources.ts, datasets/*.json (genererade)
  lib/types.ts, datasets.ts, series.ts, format.ts, url.ts
  lib/tax.ts, tax-flow.ts  skatteberäkning (Skatteverkets regler) och kalkylatorns Sankey-poster
  components/Chart.tsx, RegionMap.tsx, FlowSankey.tsx, TaxSankey.tsx (React-öar),
             chart-shared.ts (tema, tooltip, CSV, URL-parametrar), sankey-shared.ts (Sankey med grupper),
             KeyFigureRow.tsx (nyckeltal ovanför diagram),
             DatasetCard.astro (väljer ö efter kind), SourceNote.astro, KeyFigure.astro, CategoryCard.astro
  layouts/Base.astro       header, kategorirad, temaväxlare, footer
  pages/index.astro, [kategori]/index.astro, om.astro, 404.astro
  styles/global.css        design-tokens (ljust/mörkt), diagramfärger
public/
  geo/kommuner.json        kartgeometri (genererad)
  data/<id>/<år>.json      värden för regionala dataset och flödesdataset (genererade)
docs/
  datakallor.md            API:er, tabell-ID:n, egenheter
  beslut.md                beslutslogg
```

## Recept: lägg till ett nytt dataset

1. Hitta tabellen. SCB: `https://statistikdatabasen.scb.se/api/v2/tables?query=<sökord>&lang=sv` och
   metadata via `/tables/<TAB-ID>/metadata?lang=sv` (variabelkoder och värdekoder). Se `docs/datakallor.md`.
2. Skapa eller utöka en hämtare i `scripts/datasets/<namn>.ts` som returnerar `DatasetInput[]`
   (kopiera mönstret från `befolkning.ts` för SCB, `klimat.ts` för SMHI). Fyll i `source`, `notes`, `chart`.
3. Registrera nya hämtare i `scripts/datasets/index.ts`.
4. Kör `npm run fetch -- <namn>` och granska JSON-filen (rimliga värden, perioder, inga oväntade null).
5. Lägg till dataset-id:t i rätt kategori i `src/data/categories.ts` (`datasets: [...]`).
6. Ev. nyckeltal på startsidan: `<KeyFigure dataset=… series=… />` i `src/pages/index.astro`.
7. Lägg till tester om du skriver ny parsningslogik. Kör `npm test && npm run check && npm run build`.
8. Uppdatera **Status** nedan och `docs/datakallor.md`.

## Recept: regionalt dataset (karta) eller flödesdataset (Sankey)

- **Regionalt:** returnera `{ output: 'regional', meta, years }` från hämtaren (se `scripts/datasets/skatter.ts`,
  `skatter-kommuner`). `meta.metrics[]` anger mått; `scale: 'sequential' | 'diverging'` gör måttet valbart för
  kartans färgsättning (divergerande för värden kring noll). `regions` = kommuner med `group` = län.
- **Flöde:** returnera `{ output: 'flow', meta, years }`. Alla enheter delar `meta.nodes` (side `in`/`out`);
  per enhet och år lagras bara nod-id → belopp (mnkr, positiva). `writeFlowDataset` stoppar om in ≠ ut (±0,5 %).
  För kommuner/regioner: använd `buildFlow()` i `scripts/lib/flows.ts`, som härleder poster ur
  resultaträkningens delsummor så att flödet alltid balanserar.
- **Mellansteg i Sankey:** lägg till en nod med `role: 'group'` och sätt `parent` på noderna som ingår (samma
  sida). Gruppen har inget eget belopp – klienten summerar barnen. Löv utan `parent` hamnar i yttersta kolumnen.
- **Per invånare och nyckeltal:** årsfilen kan ha `population` (enhet → folkmängd) och `keyFigures`
  (enhet → nyckel → värde); definiera nycklarna i `meta.keyFigures`. `writeFlowDataset` validerar båda.
- Kartklick skickar `SELECT_ENTITY_EVENT` (`chart-shared.ts`); en `FlowSankey` med samma `entityParam`
  (`kommun`) byter då enhet. Sankey-valet speglas i URL:en (`?kommun=0180&kommun-ar=2025`).

## Recept: lägg till en ny kategori

Lägg till ett objekt i `src/data/categories.ts` (slug, namn, beskrivning, `sources`, `ideas`, `datasets: []`).
Sidan genereras automatiskt och visas som "Planerad" tills den har dataset. Saknas källan i
`src/data/sources.ts`, lägg till den där.

## Diagramtyper

`chart.type` i datasetet: `line`, `area` (en serie, tonad yta), `bar`, `stacked-bar`, `stacked-area`.
Serier kan ha `role: 'muted'` (nedtonad, t.ex. brusiga årsvärden bakom ett glidande medel).
Karta: `kind: 'regional'` → `RegionMap.tsx` (kommunnivå; geometri för län/regioner finns inte ännu).
Sankey: `kind: 'flow'` → `FlowSankey.tsx` (färg efter roll: intäkter blå, kostnader orange, saldo grå).
Skattekalkylator: `kind: 'calculator'` → `TaxSankey.tsx` (färg per mottagare; nettolön grå).

## Status

| Kategori | Dataset | Källa |
|---|---|---|
| Befolkning | `befolkning-folkmangd`, `befolkning-forandringar` | SCB TAB4365 |
| Klimat & väder | `klimat-temperatur-lund` | SMHI metobs param 22, station 53430 |
| Utsläpp & miljö | `utslapp-vaxthusgaser-sektor` | SCB TAB4698 (Naturvårdsverket) |
| El | `el-produktion-kraftslag`, `el-produktion-manad` | SCB TAB5644 (Energimyndigheten) |
| Skatter & offentliga finanser | `skatter-kalkylator` (skattekalkylator), `skatter-kommuner` (karta), `skatter-kommun-flode`, `skatter-region-flode`, `skatter-staten-flode` (Sankey med nyckeltal och kr/inv), `skatter-statsskuld`, `skatter-skuld-bnp`, `skatter-kommunalskatt-riket` | SCB TAB2017, TAB2015, TAB6777, TAB4201, TAB4199, TAB6784, TAB4242, TAB6574, TAB4365, TAB6378 (Riksgälden), TAB5050, TAB121; Statskontoret årsutfall (statsbudgeten); Skatteverket (skattesatser, regler, skattetabeller); geometri SCB RegSO |
| Övriga 11 kategorier | – (planerade, med idéer och källor) | – |

Statens Sankey (`scripts/datasets/staten.ts`, `scripts/lib/statskontoret.ts`) visar skatterna **brutto** (ägarens
val); det staten för vidare till kommuner, regioner, pensionssystemet och EU är en egen utgiftspost. Negativa
poster flyttas till motsatt sida (nod-id `<id>-motsatt`), och budgetsaldot balanserar flödet. Två mellansteg:
"Skatter som förs vidare" (kommuner, regioner – 1811 delad efter skattesatsandelar –, pension, EU) och
"Statsbudgetens utgifter" (utgiftsområden).

Regionens Sankey har mellanstegen "Hälso- och sjukvård" och "Övrig verksamhet och finansiering".

**Skattekalkylatorn** (`scripts/datasets/skattekalkyl.ts`): reglerna (prisbasbelopp, skiktgräns, avgifter,
jobbskatteavdragets parametrar) står i skriptet per inkomstår med källa. **Nytt inkomstår:** lägg till en post i
`RULES` (värden från Skatteverkets "Belopp och procent" och SKV 433, ev. lagändringar i IL 63:3/67:7) och kör
`npm run fetch -- skattekalkyl` – hämtaren stoppar om beräkningen avviker mer än 2 kr/mån från Skatteverkets
skattetabeller. Hämtaren läser flödesdataseten, så `skatter` och `staten` måste ha körts först.

**Nästa steg (förslag):** publicering (GitHub Pages via Actions + schemalagd datauppdatering), Svenska kraftnät-data (timvis el per elområde), valresultat, BNP/inflation (SCB/Riksbanken), skattekvot över tid (SCB TAB121), kalkylatorn för fler inkomstår och för pensionärer (66+).
