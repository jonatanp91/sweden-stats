# Sverige i siffror

Utforska officiell svensk statistik – befolkning, klimat, utsläpp, energi, el, ekonomi och mer – med
interaktiva diagram. All data hämtas från officiella källor (SCB, SMHI, Svenska kraftnät m.fl.) och varje
diagram visar källa, tabell och hämtdatum.

## Kom igång

```bash
npm install
npm run dev          # http://localhost:4321
```

Uppdatera datan från källorna:

```bash
npm run fetch:data
```

Mer om arkitektur, principer och hur man lägger till nya dataset finns i [CLAUDE.md](CLAUDE.md),
[docs/datakallor.md](docs/datakallor.md) och [docs/beslut.md](docs/beslut.md).

## Licens för data

Datan tillhör respektive källa: SCB (CC0), SMHI (CC BY 4.0). Se källhänvisningen under varje diagram.
