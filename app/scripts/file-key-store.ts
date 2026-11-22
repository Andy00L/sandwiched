import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { KeyStore } from "../src/lib/chain/key-store";
import { attemptSync } from "../src/lib/chain/result";

export const createFileKeyStore = (path: string): KeyStore => {
  const readAll = (): Record<string, string> => {
    if (!existsSync(path)) return {};
    const parsed = attemptSync((): unknown => JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return {};
    return Object.fromEntries(Object.entries(parsed.value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  };
  const writeAll = (values: Record<string, string>) => writeFileSync(path, JSON.stringify(values), { mode: 0o600 });
  return {
    isDurable: true,
    read: (key) => readAll()[key] ?? null,
    write: (key, value) => attemptSync(() => writeAll({ ...readAll(), [key]: value })).ok,
    remove: (key) => attemptSync(() => writeAll(Object.fromEntries(Object.entries(readAll()).filter(([storedKey]) => storedKey !== key)))).ok,
    listKeys: (prefix) => Object.keys(readAll()).filter((key) => key.startsWith(prefix)),
  };
};
