import type {
  DatasetInput,
  FlowDatasetInput,
  FlowYear,
  RegionalDatasetInput,
  RegionalYear,
  TaxCalculatorDatasetInput,
} from '../../src/lib/types.ts';

/** Regionalt dataset: metadata + en värdefil per år. */
export interface RegionalOutput {
  output: 'regional';
  meta: RegionalDatasetInput;
  years: RegionalYear[];
}

/** Flödesdataset (Sankey): metadata + en värdefil per år. */
export interface FlowOutput {
  output: 'flow';
  meta: FlowDatasetInput;
  years: FlowYear[];
}

/** Skattekalkylator: bara metadata (regler, skattesatser, fördelningar). */
export interface CalculatorOutput {
  output: 'calculator';
  meta: TaxCalculatorDatasetInput;
}

/** Statisk fil under public/, t.ex. kartgeometri. */
export interface FileOutput {
  output: 'file';
  /** Sökväg relativt public/, t.ex. "geo/kommuner.json". */
  path: string;
  content: string;
}

/** Tidsserier returneras som ett vanligt DatasetInput (utan `output`). */
export type FetcherOutput = DatasetInput | RegionalOutput | FlowOutput | CalculatorOutput | FileOutput;

/**
 * En hämtare hämtar från en källa och producerar ett eller flera dataset.
 * Lägg nya hämtare i scripts/datasets/ och registrera dem i scripts/datasets/index.ts.
 */
export interface Fetcher {
  /** Kort namn som används på kommandoraden: `npm run fetch -- <name>`. */
  name: string;
  /** Dataset-id:n (eller filer) som hämtaren producerar (för dokumentation och filtrering). */
  produces: string[];
  run(): Promise<FetcherOutput[]>;
}

export const now = () => new Date().toISOString();
