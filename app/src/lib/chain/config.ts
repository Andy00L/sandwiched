import gplSessionIdl from "@magicblock-labs/gum-sdk/lib/idl/gpl_session.json";
import { PublicKey } from "@solana/web3.js";
import sandwichIdl from "./idl/sandwich.json";

export const SANDWICH_PROGRAM_ID = new PublicKey(sandwichIdl.address);
export const SESSION_PROGRAM_ID = new PublicKey(gplSessionIdl.address);

export const BASE_RPC_URL = "https://rpc.magicblock.app/devnet";
export const ROLLUP_RPC_URL = "https://devnet-us.magicblock.app";
export const ROLLUP_WS_URL = "wss://devnet-us.magicblock.app";
export const SPONSOR_ROUTE_PATH = "/api/sponsor";

export const SESSION_VALIDITY_S = 3_600;
export const SESSION_RENEW_MARGIN_S = 300;
export const BASE_COMPUTE_UNITS = 400_000;
export const BLOCKHASH_REFRESH_MS = 1_000;

export const RPC_REQUEST_TIMEOUT_MS = 8_000;
export const SPONSOR_REQUEST_TIMEOUT_MS = 20_000;
export const BASE_CONFIRM_TIMEOUT_MS = 90_000;
export const SLOT_REGRESSION_SLOTS = 1_000;
