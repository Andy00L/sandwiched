import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PROGRAM_BUILD = join(import.meta.dir, "../../target");
const APP_COPY = join(import.meta.dir, "../src/lib/chain/idl");
const COPIED_FILES = [
  ["idl/sandwich.json", "sandwich.json"],
  ["types/sandwich.ts", "sandwich.ts"],
] as const;

for (const [buildFile, copyFile] of COPIED_FILES) {
  const buildPath = join(PROGRAM_BUILD, buildFile);
  if (!existsSync(buildPath)) {
    console.error(`[syncIdl] ${buildPath} is missing, run anchor build first`);
    process.exit(1);
  }
  copyFileSync(buildPath, join(APP_COPY, copyFile));
  console.log(`[syncIdl] copied target/${buildFile}`);
}
