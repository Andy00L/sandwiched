import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROGRAM_BUILD = join(import.meta.dir, "../../../../target");
const APP_COPY = join(import.meta.dir, "idl");
const COPIED_FILES = [
  ["idl/sandwich.json", "sandwich.json"],
  ["types/sandwich.ts", "sandwich.ts"],
] as const;

describe("the app copy of the program IDL", () => {
  for (const [buildFile, copyFile] of COPIED_FILES) {
    const buildPath = join(PROGRAM_BUILD, buildFile);
    test.skipIf(!existsSync(buildPath))(`matches target/${buildFile} (run app/scripts/sync-idl.ts after anchor build)`, () => {
      expect(readFileSync(join(APP_COPY, copyFile), "utf8")).toBe(readFileSync(buildPath, "utf8"));
    });
  }
});
