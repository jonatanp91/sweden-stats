# Beslutslogg

Korta anteckningar om arkitektur- och designbeslut. Nyaste sist. Format: kontext → beslut → konsekvens.

## B-001 Astro + React-öar, statisk sajt (2026-11-22)

Sajten ska vara snabb, billig att publicera (GitHub Pages/Netlify) och lätt att bygga ut sida för sida.
**Beslut:** Astro (statisk build) med React endast för interaktiva diagram (`client:visible`).
**Konsekvens:** Ingen server behövs. All data måste finnas vid build-tid.

## B-002 Data hämtas med skript och checkas in som JSON (2026-11-22)

Live-anrop från webbläsaren gör sajten beroende av att API:erna svarar och tillåter CORS, och ger ingen historik.
**Beslut:** Hämtningsskript (`npm run fetch:data`) skriver validerad JSON till `src/data/datasets/`, som checkas in.
**Konsekvens:** Varje dataändring syns i git-diffen. Uppdatering kräver att skripten körs (senare: schemalagt i CI).

## B-003 Endast primärkällor; Ekonomifakta/Naturskyddsföreningen som referens (2026-11-22)

Ekonomifakta och Naturskyddsföreningen är intresseorganisationer och saknar öppna API:er.
**Beslut:** De listas som `kind: 'referens'` i `src/data/sources.ts`; siffror hämtas alltid från myndighetskällan.

## B-004 Normalisera Windows-drive-bokstaven (2026-11-22)

Om terminalen startar i `c:\…` (liten bokstav, vanligt i VS Code) laddar Vite moduler under både `c:` och `C:`.
Symptom: `astro build` lyckas men sidorna saknar alla `<link rel="stylesheet">` (ostylad sajt), och Vitest kraschar
med "Cannot read properties of undefined (reading 'config')". `process.chdir()` hjälper inte – Windows behåller
skiftläget.
**Beslut:** npm-skripten kör `astro`/`vitest` via `scripts/run.mjs`, som startar CLI:t i en barnprocess med
`cwd` normaliserad till versal. `astro.config.mjs` och `vitest.config.ts` sätter dessutom `root` normaliserat som
extra skydd.
**Konsekvens:** Använd `npm run …`, inte `npx astro …` direkt.

## B-005 Validerad färgpalett, max 8 serier (2026-11-22)

**Beslut:** Diagramfärgerna är en fast, färgblindhetsvaliderad kategorisk palett (8 färger, separata steg för
ljust/mörkt läge) i `src/styles/global.css`. Serier tilldelas färg i fast ordning efter position. Fler än 8
kategorier slås ihop ("Övrigt") i hämtningsskriptet.
**Konsekvens:** Exempel: utsläppssektorerna avfall + lösningsmedel → "Övrigt".

## B-006 Kategorisidor på rotnivå (2026-11-22)

**Beslut:** Kategorier ligger på `/<slug>/` (t.ex. `/befolkning/`). `getStaticPaths` stoppar bygget om en slug
krockar med en befintlig sida (`om`, `404`).

## B-007 Stora dataset som årsfiler i public/data (2026-11-24)

Kommundata (290 kommuner × 17 år × 12 mått) och Sankey-flöden skulle bli flera MB om de skickades som props till
React-öarna och bäddades in i HTML:en.
**Beslut:** De nya datasettyperna `regional` och `flow` har metadata i `src/data/datasets/` men värdena i
`public/data/<id>/<år>.json`, som ön hämtar när användaren väljer år.
**Konsekvens:** Sidan laddar bara valt år (~30–80 kB). Värdefilerna valideras när de skrivs, inte vid build.

## B-008 Kommungränser från SCB:s RegSO (2026-11-24)

SCB:s öppna WFS saknar ett kommunlager; Lantmäteriets geodata kräver inloggning.
**Beslut:** Hämta `stat:RegSO_2025` (CC0), slå ihop områdena per `kommunkod` med mapshaper och förenkla till 3 %
(~470 kB). Hämtaren kontrollerar att exakt 290 kommuner med koder enligt SCB:s kommunlista finns.

## B-009 Sankey: fördelning av kostnader och färg efter roll (2026-11-24)

Resultaträkningen har kostnaderna som en klump; driftredovisningen har dem per verksamhet men innehåller interna
poster och summerar inte till resultaträkningen.
**Beslut:** Resultaträkningen styr totalen; kostnaderna fördelas efter verksamhetsområdenas *andel* av
bruttokostnaden. Avskrivningar, statsbidrag/utjämning och extraordinära poster härleds ur delsummorna så att
flödet balanserar exakt. Överskott/underskott och nettoavgift till utjämningssystemet blir egna noder.
Om intäktsuppdelningen (TAB4201) överstiger resultaträkningens intäkter (främst Gotland) skalas den proportionellt
och loggas. Noderna färgas efter roll (intäkt/kostnad/saldo) eftersom varje nod har egen etikett – därför gäller
inte 8-färgsgränsen.

## B-010 Statens budget från Statskontoret, bruttoperspektiv (2026-11-24)

esv.se svarade 404 (även i ägarens webbläsare). Statskontoret publicerar statsbudgetens utfall som öppna data (CC0)
i samma format som ESV tidigare gjorde.
**Beslut:** Statens Sankey bygger på Statskontorets årsutfall. Enligt ägarens val visas skatterna **brutto**: det
som staten för vidare (kommunal inkomstskatt, ålderspensionsavgifter, tullar till EU – avgående poster 1700/1800)
blir en egen utgiftspost i stället för att nettas bort. De 12 största utgiftsområdena senaste året är egna noder,
resten "Övriga". Negativa poster flyttas till motsatt sida; budgetsaldot balanserar flödet.
**Konsekvens:** Totalen (~2,9 biljoner kr 2025) är större än "statens budget" i officiell mening (~1,3 biljoner);
detta förklaras i datasetets noter.

## B-011 Mellansteg, per invånare och nyckeltal i Sankey (2026-11-25)

Ägaren ville ha nyckeltal (som i kartan) och kr per invånare i budgetdiagrammen samt mellansteg (regionen:
hälso- och sjukvård/övrigt; staten: vidareföring/statsbudget → mottagare/utgiftsområden).
**Beslut:** Flödesschemat får gruppnoder (`role: 'group'`, barn med `parent`) som klienten summerar, och årsfilerna
får `population` och `keyFigures` per enhet. Sankey-ritningen ligger i `sankey-shared.ts` och delas med
skattekalkylatorn. Med grupper blir etiketterna tvåradiga och gruppetiketten placeras i luckan mot centrum.
Nyckeltalen räknas av samma funktion (`incomeStatementFigures`) som kartan, så siffrorna alltid stämmer överens.

## B-012 Skuld i procent av BNP – två mått (2026-11-25)

**Beslut:** Visa både statsskulden (Riksgälden) och Maastrichtskulden i % av BNP i samma diagram. Procent av BNP
gör skulden jämförbar över tid; Maastrichtskulden är det officiella måttet (EU 60 %, skuldankaret 35 %) medan
statsskulden är det mest kända. BNP hämtas från TAB121 (har senaste året) och stäms av mot TAB5621.

## B-013 Skattekalkylatorns regler i skriptet, kontrollerade mot Skatteverket (2026-11-25)

Det finns inget API för skattereglerna (grundavdrag, jobbskatteavdrag m.m.), bara webbsidor, lagtext och SKV 433.
**Beslut:** Parametrarna skrivs in per inkomstår i `scripts/datasets/skattekalkyl.ts` med källhänvisning;
formlerna ligger i `src/lib/tax.ts`. Hämtaren jämför beräkningen med Skatteverkets skattetabeller (öppna data) för
alla inkomstskikt upp till 200 000 kr/mån i fyra tabeller och stoppar vid mer än 2 kr/mån i avvikelse.
Kalkylatorns andra steg fördelar kommunens/regionens/statens del proportionellt efter deras senaste budgetutfall.
Skattereduktionerna redovisas som statens kostnad (kommunerna får hela kommunalskatten); blir statens netto negativt
visas det som ett inflöde. Moms ingår inte (ägarens val).
