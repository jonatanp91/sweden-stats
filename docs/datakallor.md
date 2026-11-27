# Datakällor – teknisk referens

Praktiska anteckningar om källornas API:er: endpoints, tabell-ID:n, egenheter. Uppdatera när du använder en ny
källa eller upptäcker en egenhet.

## SCB – Statistikdatabasen (PxWebApi 2)

- Bas: `https://statistikdatabasen.scb.se/api/v2/` · Licens: CC0 · Ingen nyckel.
- **Sök tabeller:** `GET /tables?query=<sökord>&lang=sv&pageSize=20`
- **Metadata:** `GET /tables/<TAB-ID>/metadata?lang=sv` → JSON-stat2 med variabler och värdekoder.
- **Data:** `GET /tables/<TAB-ID>/data?lang=sv&outputFormat=json-stat2&valueCodes[<Variabel>]=<kod1>,<kod2>`
  - `*` = alla värden för variabeln. Plus-tecken i koder (t.ex. `1+2`) måste URL-kodas (`%2B`).
  - Klient: `scripts/lib/pxweb.ts` (`fetchPxTable`, `jsonStatToRecords`).
- **Gränser:** ca 150 000 celler per anrop, 30 anrop per 10 s per IP.
- **Tidskoder:** `2024` (år), `2024M03` (månad → normaliseras till `2024-03`), `2024K1` (kvartal).
- **`..` i SCB-tabeller** blir `null` i JSON-stat. Betydelsen varierar per tabell (i MI0107 betyder det noll) –
  läs tabellens `note`.
- **Publik länk:** v2 saknar en stabil webbsida per tabell-ID. Vi länkar till statistikproduktens sida
  `https://www.scb.se/<infofile>/` (infofile finns i `extension.px.infofile`, t.ex. `BE0101`).
- `updated` i svaret = när SCB senast uppdaterade tabellen.

### Använda tabeller

| Tabell | Innehåll | Variabler (koder vi använder) | Dataset |
|---|---|---|---|
| TAB4365 | Befolkningsutveckling i riket 1749– | `Kon=1+2`; `ContentsCode`: `000000LV` folkmängd, `0000001H` födda, `0000001F` döda, `000000LX` invandringar, `0000001G` utvandringar | befolkning-* |
| TAB4698 | Växthusgaser per sektor 1990– (MI0107, Naturvårdsverket) | `Vaxthusgaser=CO2-ekv.`; `Sektor`: `0.1` nationell total exkl. LULUCF/utrikes, `1.0`–`9.0` sektorer (`5.0` utrikes transporter och `10.0` LULUCF ingår ej i 0.1); `ContentsCode=0000018Q`. Enhet kt | utslapp-vaxthusgaser-sektor |
| TAB5644 | Elproduktion per produktionsslag, månad 2017– (EN0108) | `Produktionsslag`: `Total`, `Vattenkraft`, `Karnkraft`, `Vindkraft`, `VarmekrF`, `VarmekrEjF`, `Solkraft`; `ContentsCode=000004DF` (GWh) | el-produktion-* |
| TAB2017 | Kommunala skattesatser 2000– per kommun/län | `Region` (4 siffror = kommun, 2 = län, 00 = riket); `ContentsCode` `OE0101D1` total, `D2` kommun, `D3` region. Procent | skatter-kommuner |
| TAB2015 | Kommunalskatteuppgifter, riket 1930– | `ContentsCode` `OE0101F1` total, `F2` kommun, `F3` region, `F4` församling | skatter-kommunalskatt-riket |
| TAB6777 | Resultaträkning för kommuner 1998–, tkr | `Resultatraknposter` 010, 022, 030, 035, 040, 050, 060, 072, 080, 120 (kostnader negativa) | skatter-kommuner, skatter-kommun-flode |
| TAB4201 | Verksamhetsintäkter för kommuner 2011– | `Kontopost` 290 taxor/avgifter, 490 hyror, 590 bidrag, 390+130 försäljning; 886 = summa = RR 010 | skatter-kommun-flode |
| TAB4199 | Kostnader per verksamhetsområde, kommuner 2011– | `Verksomrkom` 190/290/390/490/590/690/890 (totaler); `ContentsCode` `0000005Z` bruttokostnad | skatter-kommun-flode |
| TAB6784 | Resultaträkning för regioner 1999–, mnkr | Som TAB6777 men 054 statsbidrag/utjämning, 026 av-/nedskrivningar; regionkoder `01L` … `25L` | skatter-region-flode |
| TAB4242 | Kostnader per verksamhetsområde, regioner | `Verksomrkom` 0–8 (940–980 service = internt, används ej); `000000A6` bruttokostnad. Data per region från 2019 | skatter-region-flode |
| TAB6574 | Folkmängd per region 2010– | `Region` kommunkod, `Alder=totalt`, `Kon=1+2` | skatter-kommuner (per invånare) |
| TAB6378 | Statsskulden per månad 1970– (Riksgälden) | `Marknad=SSTot`, `ContentsCode=000007J7`; enhet mkr. December = årets slut | skatter-statsskuld, skatter-skuld-bnp, skatter-staten-flode (nyckeltal) |
| TAB5050 | Maastrichtskuld, år 1996– | `Sektor=S13` (offentlig förvaltning), `Kontopost=FL01N`, `ContentsCode=000002KK`; mnkr | skatter-skuld-bnp |
| TAB121 | Skattekvot och BNP, år 1950– | `Skattetyp=101` BNP till marknadspris, `ContentsCode=000000T8` (mnkr; `000000SP` = andel av BNP). Har senaste året, till skillnad från TAB5621 (som används som kontroll) | skatter-skuld-bnp, skatter-staten-flode, skatter-staten-utgifter |
| TAB121 | Skatter per skattetyp, år 1950– | `Skattetyp`: 102 totala skatter, 201+202 D.2 produktion och import (Sverige + EU), 203 D.5 inkomst- och förmögenhetsskatter, 204 D.61C obligatoriska sociala avgifter, 205 D.91 kapitalskatter. `000000SP` (procent av BNP) finns **bara för totalen** – per typ räknas mnkr / BNP; hämtaren kontrollerar mot SCB:s skattekvot (±0,1 pe) | skatter-skattekvot |
| TAB4365 | (se ovan) folkmängd i riket 31 dec | används även för kr/invånare i statens flöde | skatter-staten-flode |

**Resultaträkningens identiteter** (verifierade): 030 = 010 + 022 + avskrivningar; 035 = 030 + 040 + statsbidrag/utjämning;
080 = 035 + 060 + 072; 120 = 080 + extraordinära poster. Se `scripts/lib/flows.ts`.

**Region Gotland** är både kommun och region. SCB uppskattar fördelningen till 65 % kommun och 35 % region. Gotlands
intäktsuppdelning i TAB4201 överstiger RR-intäkterna (~×0,67) och skalas därför.

### Kandidater för framtida dataset

- TAB78 – elproduktion och elanvändning per elområde, månad 2021–
- TAB991 / TAB1218 – elanvändning per användningsområde
- TAB4063 – installerad effekt per elområde
- TAB1733, TAB4717 m.fl. – detaljerade utsläpp per sektor (MI0107)
- TAB4357 – utsläpp till luft per kommun (karta!)
- TAB7084/7085 – konsumtionsbaserad miljöpåverkan

## SMHI – Meteorologiska observationer (metobs)

- Bas: `https://opendata-download-metobs.smhi.se/api/version/1.0/` · Licens: CC BY 4.0 · Ingen nyckel.
- Dokumentation: https://opendata.smhi.se/apidocs/metobs/
- **Parametrar:** `parameter/<id>.json` listar stationer. 2 = dygnsmedeltemperatur, 22 = månadsmedeltemperatur,
  23 = månadsnederbörd m.fl. (se `/parameter.json`).
- **Data:** `parameter/<p>/station/<s>/period/<period>/data.csv`
  - `corrected-archive` = kvalitetskontrollerad historik (utom senaste ~3 månaderna), `latest-months` = senaste 4 mån.
  - CSV med metadatahuvud; datarader efter raden som börjar med `Från Datum Tid`. Semikolonseparerad.
    Kvalitetskod: G = godkänt, Y = misstänkt/aggregerat.
- Klient: `scripts/lib/smhi.ts`.

### Använda stationer

| Station | Namn | Kommentar |
|---|---|---|
| 53430 | Lund | Månadsmedel från 1753, men **lucka 1773–1858** (endast enstaka månader) och 1974 ofullständigt. |

Andra långa serier: 98210 Stockholm-Observatoriekullen (1756–2024, fortsätter som 98230 "A"), 97520 Uppsala
(t.o.m. 1985, fortsätter som 97510 Uppsala Aut). Att skarva stationer kräver en metodbeskrivning i `notes`.

## SCB öppna geodata (WFS)

- `https://geodata.scb.se/geoserver/stat/wfs` – GetCapabilities listar lager (DeSO, RegSO, tätorter, rutnät …).
- Inget färdigt kommunlager. `stat:RegSO_2025` (3 363 områden) har `kommunkod` och `lanskod` och slås ihop till
  kommuner (`scripts/lib/geo.ts`). `outputFormat=application/json&srsName=EPSG:4326` ger GeoJSON i lon/lat (~50 MB).

## Statskontoret – statsbudgetens utfall (öppna data, CC0)

- Sida: https://www.statskontoret.se/analys-och-statistik/oppna-data/arsutfall/ (även Månadsutfall och
  Realekonomisk fördelning under `/analys-och-statistik/oppna-data/`).
- Länkar: `/OpenDataArsUtfallPage/GetFile?documentType=Inkomst|Utgift&fileType=Zip|Excel&fileName=…&Year=…&status=…`.
  Filnamn och status ändras vid varje publicering → `findArsutfallLinks()` läser sidan och tar den **sista** zip-länken per typ.
- Zip med en CSV: semikolon, UTF-8 med BOM, decimalkomma, **mnkr**.
- **Inkomster** (2006–): `Inkomsttyp` 1000 skatter (huvudgrupper 1100 direkta skatter på arbete, 1200 indirekta skatter
  på arbete, 1300 kapital, 1400 konsumtion, 1500 import, 1600 övriga, **1700/1800 avgående poster till EU och andra
  sektorer (negativa)**, 1900 periodiseringar), 2000 statens verksamhet, 3000 försåld egendom, 4000 återbetalda lån,
  5000 kalkylmässiga, 6000 EU-bidrag, 7000 avräkningar i skattesystemet, 8000 utgifter som krediteras på skattekonto
  (negativa). Kolumnen `Utfall`; summan av alla rader = statsbudgetens inkomster.
- **Utgifter** (1997–): `Utgiftsområde` 01–27 per anslag. Rader utan utgiftsområde: Riksgäldskontorets nettoutlåning
  och Kassamässig korrigering **ingår** i budgetsaldot; Utgiftstak, Marginal till utgiftstaket, Ålderspensionssystemet
  vid sidan av statens budget och Förändring av anslagsbehållningar ingår **inte**.
- `skatter-staten-utgifter`: bara rader med utgiftsområde (2006–), de 7 största senaste året + övriga, delat med BNP
  (TAB121). Filen använder dagens UO-indelning även bakåt, så serierna är jämförbara.
- Budgetsaldo (kontrollerat): 2020 −221 mdkr, 2022 +164 mdkr, 2025 −102 mdkr.
- **Vidareföring (inkomsttitlar):** 1711 EU-skatter, 1811 Kommunala skatter (kommuner + regioner i en post – delas
  i flödet efter riksgenomsnittets skattesatser, SCB TAB2015 F2/F3), 1812 Avgifter till AP-fonder, 1813 Avgifter
  till premiepensionssystemet (bara 2006–2007). Okända titlar under 1800 stoppar hämtningen.
- **1811 ≠ kommunernas skatteintäkter:** 1811 är det staten *betalat ut* under året (preliminärt efter prognos för
  skatteunderlaget + slutavräkning för år t−2), medan titel 1115 Kommunal inkomstskatt är skatten på årets inkomster
  (periodiserad). Kommunernas/regionernas bokförda skatteintäkter (SCB:s räkenskapssammandrag) ligger nära 1115.
  2025: 1811 = 984 mdkr, 1115 = 959 mdkr, kommuner + regioner = 963 mdkr. Förklaras i datasetens noter (B-017).
- ESV (esv.se) svarade 404 på alla anrop i november 2026; Statskontoret publicerar samma data i samma format.

## Skatteverket – öppna data (CC0) och regler

- Rowstore-API (entryscape), ingen nyckel. Filtrera med kolumnnamn som query-parametrar, `_limit` ≤ 500, följ `next`.
  - **Skattesatser per församling:** `https://skatteverket.entryscape.net/rowstore/dataset/c67b320b-ffee-4876-b073-dd9236cd2a99?år=2026`
    (kolumner `kommunal-skatt`, `landstings-skatt`, `begravnings-avgift`, `kyrkoavgift`, `församlings-kod` –
    de fyra första siffrorna = kommunkod). Dataportal: https://www.dataportal.se/datasets/9_10. Stäms av mot SCB TAB2017.
  - **Skattetabeller månadslön:** `…/rowstore/dataset/88320397-5c32-4c16-ae79-d36d95b17b95?år=2026&tabellnr=32&antal dgr=30B`
    (`kolumn 1` = lön, under 66 år). Används som kontroll av `src/lib/tax.ts`.
  - Licens CC0 enligt DCAT-metadata (`/store/9/metadata/<id>`).
- **Regler:** "Belopp och procent" per år (`/privat/skatter/beloppochprocent/<år>…`) och **Teknisk beskrivning för
  skattetabeller (SKV 433)**, som anger exakta beräkningsregler: årsinkomst = högsta beloppet i skiktet × 12,
  tabellnumret inkluderar 1,16 procentenheter begravnings-/kyrkoavgift, public service-avgift 1 % (max 1,42 IBB),
  avrundningar. Jobbskatteavdragets formel står i IL 67 kap. 7 § (Riksdagens lagtext).

## Svenska kraftnät

- Mimer: https://mimer.svk.se/ – produktion, förbrukning och utbyte per elområde, timupplöst. Ej integrerat ännu.

## Övriga planerade källor

Se `src/data/sources.ts` för hela listan med länkar (Valmyndigheten, ESV, Riksbanken, Trafikanalys, Brå m.fl.).
