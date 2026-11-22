import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STYLED_FOLDERS = [join(import.meta.dir, "../../components"), join(import.meta.dir, "../../app")];
const STYLED_FILE = /\.(css|tsx)$/;
const PURE_BLACK_OR_WHITE = /#000(000)?\b|#fff(fff)?\b|\brgb\(\s*0[\s,]+0[\s,]+0\b|\brgb\(\s*255[\s,]+255[\s,]+255\b|(?<![-\w])(black|white)(?![-\w])/i;
const MASK_LINE = /mask-image/;

const listStyledFiles = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return listStyledFiles(path);
    return STYLED_FILE.test(entry.name) ? [path] : [];
  });

describe("ink and cream only", () => {
  test("no style or component uses pure black or pure white outside a mask (plan/09 section 4)", () => {
    const offending = STYLED_FOLDERS.flatMap(listStyledFiles).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) => (PURE_BLACK_OR_WHITE.test(line) && !MASK_LINE.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [])),
    );
    expect(offending).toEqual([]);
  });
});
