import { Connection, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { BASE_RPC_URL, BLOCKHASH_REFRESH_MS, ROLLUP_RPC_URL, ROLLUP_WS_URL } from "./config";
import { type ChainPrograms, createChainPrograms } from "./program";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import { BlockhashCache, type FeePayment } from "./transport";

export type ChainClient = {
  programs: ChainPrograms;
  base: Connection;
  rollup: Connection;
  rollupUrl: string;
  rollupBlockhashes: BlockhashCache;
  feePayment: FeePayment;
};

const installBufferGlobal = (): void => {
  if (globalThis.Buffer === undefined) globalThis.Buffer = Buffer;
};

export const createChainClient = (feePayment: FeePayment): ChainClient => {
  installBufferGlobal();
  const base = new Connection(BASE_RPC_URL, "confirmed");
  const rollup = new Connection(ROLLUP_RPC_URL, { commitment: "processed", wsEndpoint: ROLLUP_WS_URL });
  return {
    programs: createChainPrograms(base),
    base,
    rollup,
    rollupUrl: ROLLUP_RPC_URL,
    rollupBlockhashes: new BlockhashCache(rollup, BLOCKHASH_REFRESH_MS),
    feePayment,
  };
};

export type SponsorStatus = { sponsor: PublicKey; isAccepting: boolean };

export const fetchSponsorStatus = async (routeUrl: string): Promise<Result<SponsorStatus>> => {
  const response = await attempt(() => fetch(routeUrl, { method: "GET" }));
  if (!response.ok) return failure(`[fetchSponsorStatus] transport: ${response.reason}`);
  const body = await attempt((): Promise<unknown> => response.value.json());
  if (!body.ok || typeof body.value !== "object" || body.value === null) return failure("[fetchSponsorStatus] no JSON body");
  const status = body.value;
  if (!("sponsor" in status) || typeof status.sponsor !== "string" || !("isAccepting" in status) || typeof status.isAccepting !== "boolean") {
    return failure("[fetchSponsorStatus] malformed status");
  }
  const sponsorText = status.sponsor;
  const sponsor = attemptSync(() => new PublicKey(sponsorText));
  if (!sponsor.ok) return sponsor;
  return success({ sponsor: sponsor.value, isAccepting: status.isAccepting });
};

export const createSponsoredFeePayment = async (routeUrl: string): Promise<Result<FeePayment>> => {
  const status = await fetchSponsorStatus(routeUrl);
  if (!status.ok) return status;
  if (!status.value.isAccepting) return failure("[createSponsoredFeePayment] the sponsor is not accepting guests, connect a wallet");
  return success({ kind: "sponsor", routeUrl, sponsor: status.value.sponsor });
};
