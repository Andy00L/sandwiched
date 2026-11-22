import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { ChainClient } from "../src/lib/chain/client";
import { createChainPrograms } from "../src/lib/chain/program";
import { createBlockhashCache } from "../src/lib/chain/transport";

type FakeBase = { isConfirming: boolean; hasAccounts: boolean; sentTransactions: Transaction[] };

const UNREACHABLE_URL = "http://127.0.0.1:1";

export function createFakeChainClient(base: FakeBase): ChainClient {
  const connection = new Connection(UNREACHABLE_URL);
  connection.getLatestBlockhash = async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 });
  connection.sendRawTransaction = async (raw) => {
    base.sentTransactions.push(Transaction.from(Buffer.from(raw)));
    return `base-signature-${base.sentTransactions.length}`;
  };
  connection.confirmTransaction = async () => {
    if (!base.isConfirming) return Promise.reject(new Error("block height exceeded"));
    return { context: { slot: 1 }, value: { err: null } };
  };
  connection.getAccountInfo = async () =>
    base.hasAccounts ? { data: Buffer.alloc(8), owner: Keypair.generate().publicKey, lamports: 1, executable: false, rentEpoch: 0 } : null;
  return {
    programs: createChainPrograms(connection),
    base: connection,
    rollup: connection,
    rollupUrl: UNREACHABLE_URL,
    rollupBlockhashes: createBlockhashCache(connection, 1_000),
    feePayment: { kind: "wallet" },
  };
}
