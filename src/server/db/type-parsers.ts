import "server-only";

import { types, type CustomTypesConfig } from "pg";

// PostgreSQL type OIDs (pg_type.oid).
const INT8_OID = 20;
const INT8_ARRAY_OID = 1016;
const DATE_OID = 1082;
const DATE_ARRAY_OID = 1182;
const TEXT_ARRAY_OID = 1009;

type TextParser = (value: string) => unknown;
type TypeFormat = "text" | "binary";

// pg-types' `TypeId` union omits array OIDs, so look parsers up by plain number. Reads only; never registers.
const builtinParser = types.getTypeParser as (oid: number, format?: TypeFormat) => TextParser;

function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError("bigint value is outside the safe JavaScript integer range");
  }
  return parsed;
}

const parseTextArray = builtinParser(TEXT_ARRAY_OID, "text") as (value: string) => (string | null)[];

function parseSafeIntegerArray(value: string): (number | null)[] {
  return parseTextArray(value).map((entry) => (entry === null ? null : parseSafeInteger(entry)));
}

const TEXT_OVERRIDES: ReadonlyMap<number, TextParser> = new Map<number, TextParser>([
  // Calendar dates stay YYYY-MM-DD so time zones cannot shift them.
  [DATE_OID, (value) => value],
  [DATE_ARRAY_OID, parseTextArray],
  [INT8_OID, parseSafeInteger],
  [INT8_ARRAY_OID, parseSafeIntegerArray],
]);

function getTypeParser(oid: number, format?: TypeFormat): TextParser {
  const override = format === "binary" ? undefined : TEXT_OVERRIDES.get(oid);
  return override ?? builtinParser(oid, format);
}

/**
 * Per-pool parsers (tech-stack "Database driver"): `date` as a string and `bigint` as a safe number.
 * Never registered on the global `pg.types` registry.
 */
export const POOL_TYPES: CustomTypesConfig = Object.freeze({
  getTypeParser: getTypeParser as CustomTypesConfig["getTypeParser"],
});
