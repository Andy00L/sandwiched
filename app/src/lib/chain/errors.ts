import gplSessionIdl from "@magicblock-labs/gum-sdk/lib/idl/gpl_session.json";
import sandwichIdl from "./idl/sandwich.json";

const ERROR_NAMES = new Map<number, string>([
  ...sandwichIdl.errors.map((entry): [number, string] => [entry.code, entry.name]),
  ...gplSessionIdl.errors.map((entry): [number, string] => [entry.code, `session.${entry.name}`]),
]);

const HEX_ERROR_PATTERN = /custom program error: 0x([0-9a-f]+)/i;
const DECIMAL_ERROR_PATTERN = /"Custom":(\d+)/;

export const readProgramErrorCode = (errorText: string): number | null => {
  const hexMatch = HEX_ERROR_PATTERN.exec(errorText);
  if (hexMatch?.[1] !== undefined) return Number.parseInt(hexMatch[1], 16);
  const decimalMatch = DECIMAL_ERROR_PATTERN.exec(errorText);
  return decimalMatch?.[1] === undefined ? null : Number.parseInt(decimalMatch[1], 10);
};

export const nameProgramError = (errorCode: number | null): string =>
  errorCode === null ? "unknown" : (ERROR_NAMES.get(errorCode) ?? `code ${errorCode}`);
