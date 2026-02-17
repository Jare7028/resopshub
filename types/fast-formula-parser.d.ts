declare module "fast-formula-parser" {
  export type FormulaPosition = {
    row: number;
    col: number;
    sheet: string;
  };

  export type CellReference = {
    sheet?: string;
    row?: number;
    col: number;
  };

  export type RangeReference = {
    sheet?: string;
    from: {
      row?: number;
      col: number;
    };
    to: {
      row?: number;
      col: number;
    };
  };

  export type FormulaParserOptions = {
    functions?: Record<string, (...args: unknown[]) => unknown>;
    functionsNeedContext?: Record<string, (context: unknown, ...args: unknown[]) => unknown>;
    onVariable?: (name: string, sheetName?: string) => CellReference | RangeReference | undefined;
    onCell?: (reference: CellReference) => unknown;
    onRange?: (reference: RangeReference) => unknown[][];
  };

  export default class FormulaParser {
    constructor(options?: FormulaParserOptions);
    parse(formula: string, position?: FormulaPosition, allowArray?: boolean): unknown;
    parseAsync(formula: string, position?: FormulaPosition, allowArray?: boolean): Promise<unknown>;
  }
}
