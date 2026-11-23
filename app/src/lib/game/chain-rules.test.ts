import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAUCET_UNITS } from "./chain-rules";

test("the faucet amount matches the program's devnet faucet", () => {
  const programSource = readFileSync(join(import.meta.dir, "../../../../programs/sandwich/src/test_usdc.rs"), "utf8");
  const declared = /pub const FAUCET_UNITS: u64 = ([\d_]+);/.exec(programSource)?.[1];
  expect(declared === undefined ? null : BigInt(declared.replaceAll("_", ""))).toBe(FAUCET_UNITS);
});
