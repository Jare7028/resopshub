import FormulaParser from "fast-formula-parser";
import { columnLetterToIndex, toEmployeeInfoColumnKey } from "./employeeInfo";

function stripLeadingReturnWord(value: string) {
  return String(value || "")
    .replace(/^return\s+/i, "")
    .trim()
    .replace(/,$/, "")
    .trim();
}

function toNaturalReference(value: string) {
  const cleaned = String(value || "")
    .replace(/\b(column|entry|value)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return toEmployeeInfoColumnKey(cleaned);
}

function normalizeNaturalCondition(rawCondition: string) {
  let condition = String(rawCondition || "")
    .replace(/\bcolumn\s+entry\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const comparison = condition.match(/^\s*([^<>=!]+?)\s*(==|=|!=|<>|<=|>=|<|>)([\s\S]+)$/);
  if (comparison) {
    const lhs = toNaturalReference(comparison[1]);
    const operator = comparison[2];
    const rhs = comparison[3].trim();
    if (lhs) {
      condition = `${lhs} ${operator} ${rhs}`;
    }
  }
  return condition;
}

function expandComparisonShorthand(expression: string) {
  const shorthandPattern =
    /([A-Za-z_][A-Za-z0-9_]*)\s*(==|=|!=|<>|<=|>=|<|>)\s*("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)((?:\s+(?:OR|AND)\s+(?:"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?))+)/gi;

  return expression.replace(shorthandPattern, (_match, lhs, operator, firstRight, tail) => {
    const conditions = [`${lhs} ${operator} ${firstRight}`];
    const connectors: string[] = [];
    const tailPattern =
      /\s+(OR|AND)\s+("[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)/gi;
    let segment: RegExpExecArray | null = tailPattern.exec(tail);
    while (segment) {
      connectors.push(segment[1].toUpperCase());
      conditions.push(`${lhs} ${operator} ${segment[2]}`);
      segment = tailPattern.exec(tail);
    }
    const firstConnector = connectors[0];
    const hasMixedConnectors = connectors.some((connector) => connector !== firstConnector);
    if (!firstConnector || hasMixedConnectors) {
      return _match;
    }
    return `${firstConnector}(${conditions.join(",")})`;
  });
}

function normalizeFormulaExpression(expression: string) {
  const input = String(expression || "").trim();
  const naturalIfMatch = input.match(/^if\s+(.+?)\s+then\s+(.+?)\s+else\s+(.+)$/i);
  const normalized = !naturalIfMatch
    ? expandComparisonShorthand(input)
    : (() => {
        const condition = normalizeNaturalCondition(naturalIfMatch[1] || "");
        const truthyValue = stripLeadingReturnWord(naturalIfMatch[2] || "");
        const falsyValue = stripLeadingReturnWord(naturalIfMatch[3] || "");
        return expandComparisonShorthand(`IF(${condition}, ${truthyValue}, ${falsyValue})`);
      })();
  return normalized.replace(/==/g, "=").replace(/!=/g, "<>");
}

function isFormulaErrorLike(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { _error?: unknown; name?: unknown };
  if (typeof candidate._error === "string" && candidate._error.startsWith("#")) return true;
  if (typeof candidate.name === "string" && candidate.name.startsWith("#")) return true;
  return false;
}

function toFormulaDisplayValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export function evaluateEmployeeFormula(
  formula: string | null | undefined,
  resolveColumnIndex: (index: number) => unknown,
  resolveNamedReference?: (reference: string) => unknown
) {
  const raw = String(formula || "").trim();
  if (!raw) return null;
  const expression = normalizeFormulaExpression(raw.startsWith("=") ? raw.slice(1) : raw);
  if (!expression.trim()) return null;

  const position = { row: 1, col: 1, sheet: "Sheet1" };
  const virtualColumnByReference = new Map<string, number>();
  const virtualColumnValueByColumnNumber = new Map<number, unknown>();
  let nextVirtualColumn = 12000;

  const getCellValue = (row: unknown, col: unknown): unknown => {
    const columnNumber = Number(col);
    if (!Number.isFinite(columnNumber) || columnNumber < 1) return "";
    const normalizedColumnNumber = Math.trunc(columnNumber);

    const variableValue = virtualColumnValueByColumnNumber.get(normalizedColumnNumber);
    if (variableValue !== undefined) return variableValue;

    const rowNumber = Number.isFinite(Number(row)) ? Math.trunc(Number(row)) : 1;
    if (rowNumber !== 1) return "";
    return resolveColumnIndex(normalizedColumnNumber - 1);
  };

  const parser = new FormulaParser({
    onCell: (reference) => getCellValue(reference.row, reference.col),
    onRange: (reference) => {
      const fromColumn = Math.max(
        1,
        Math.trunc(Number.isFinite(Number(reference.from.col)) ? Number(reference.from.col) : 1)
      );
      const toColumn = Math.max(
        fromColumn,
        Math.trunc(Number.isFinite(Number(reference.to.col)) ? Number(reference.to.col) : fromColumn)
      );

      const requestedFromRow = Number.isFinite(Number(reference.from.row))
        ? Math.trunc(Number(reference.from.row))
        : 1;
      const requestedToRow = Number.isFinite(Number(reference.to.row))
        ? Math.trunc(Number(reference.to.row))
        : 1;
      const fromRow = Math.max(1, Math.min(requestedFromRow, requestedToRow));
      const toRow = Math.max(1, Math.max(requestedFromRow, requestedToRow));
      const effectiveStartRow = Math.max(fromRow, 1);
      const effectiveEndRow = Math.min(toRow, 1);

      const rows: unknown[][] = [];
      if (effectiveStartRow > effectiveEndRow) {
        rows.push(new Array(toColumn - fromColumn + 1).fill(""));
        return rows;
      }

      for (let row = effectiveStartRow; row <= effectiveEndRow; row += 1) {
        const rowValues: unknown[] = [];
        for (let col = fromColumn; col <= toColumn; col += 1) {
          rowValues.push(getCellValue(row, col));
        }
        rows.push(rowValues);
      }
      return rows;
    },
    onVariable: (name) => {
      const cleaned = String(name || "").trim();
      if (!cleaned) return undefined;

      const normalized = cleaned.toLowerCase();
      const existingVirtualColumn = virtualColumnByReference.get(normalized);
      if (existingVirtualColumn !== undefined) {
        return { sheet: "Sheet1", row: 1, col: existingVirtualColumn };
      }

      if (/^[A-Za-z]{1,3}$/.test(cleaned)) {
        const index = columnLetterToIndex(cleaned);
        if (index >= 0) {
          return { sheet: "Sheet1", row: 1, col: index + 1 };
        }
      }

      if (typeof resolveNamedReference !== "function") return undefined;

      const referencedValue = resolveNamedReference(cleaned);
      if (referencedValue === undefined) return undefined;

      if (nextVirtualColumn > 16384) return undefined;
      const virtualColumn = nextVirtualColumn;
      nextVirtualColumn += 1;
      virtualColumnByReference.set(normalized, virtualColumn);
      virtualColumnValueByColumnNumber.set(virtualColumn, referencedValue);
      return { sheet: "Sheet1", row: 1, col: virtualColumn };
    },
  });

  try {
    const result = parser.parse(expression, position);
    if (isFormulaErrorLike(result)) return null;
    return result ?? null;
  } catch {
    return null;
  }
}

export function formatFormulaResult(value: unknown) {
  const normalized = toFormulaDisplayValue(value);
  if (normalized === "") return "";
  if (typeof normalized !== "number") return normalized;
  if (Number.isInteger(normalized)) return String(normalized);
  return normalized.toFixed(2).replace(/\.?0+$/, "");
}
