import { describe, expect, test } from "bun:test";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { findTableAddress } from "./addresses";
import { buildSitInstructions, createChainPrograms } from "./program";
import {
  loadSponsorKeypair,
  SPONSOR_BALANCE_CACHE_MS,
  SPONSOR_MIN_LAMPORTS,
  SPONSOR_SPEND_RULES,
  type SponsorConnection,
  createSponsorService,
  readClientIp,
} from "./sponsor-service";

const programs = createChainPrograms(new Connection("http://127.0.0.1:8899"));
const sponsor = Keypair.generate();
const RECENT_BLOCKHASH = Keypair.generate().publicKey.toBase58();

const createStubConnection = (lamports: number) => {
  const sent: Buffer[] = [];
  const connection: SponsorConnection = {
    getBalance: async () => lamports,
    sendRawTransaction: async (rawTransaction) => {
      sent.push(Buffer.from(rawTransaction));
      return `signature-${sent.length}`;
    },
  };
  return { connection, sent };
};

const encodeSit = async (guest: Keypair, isGuestSigning = true) => {
  const instructions = await buildSitInstructions(programs.sandwich, sponsor.publicKey, guest.publicKey, findTableAddress(1n));
  const transaction = new Transaction({ feePayer: sponsor.publicKey, recentBlockhash: RECENT_BLOCKHASH }).add(...instructions);
  if (isGuestSigning) transaction.partialSign(guest);
  return { transaction: Buffer.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64") };
};

describe("createSponsorService", () => {
  test("co-signs and sends an allowlisted transaction the guest signed", async () => {
    const stub = createStubConnection(SPONSOR_MIN_LAMPORTS);
    const reply = await createSponsorService(sponsor, stub.connection).sponsor(await encodeSit(Keypair.generate()), "1.1.1.1");
    expect(reply).toEqual({ status: 200, body: { signature: "signature-1" } });
    const sentTransaction = Transaction.from(stub.sent[0] ?? Buffer.alloc(0));
    expect(sentTransaction.verifySignatures()).toBe(true);
  });

  test("refuses below the balance floor and sends nothing", async () => {
    const stub = createStubConnection(SPONSOR_MIN_LAMPORTS - 1);
    const reply = await createSponsorService(sponsor, stub.connection).sponsor(await encodeSit(Keypair.generate()), "1.1.1.1");
    expect(reply.status).toBe(503);
    expect(stub.sent).toHaveLength(0);
  });

  test("refuses a transaction off the allowlist before reading the balance", async () => {
    const stub = createStubConnection(SPONSOR_MIN_LAMPORTS);
    let balanceReads = 0;
    const connection: SponsorConnection = { ...stub.connection, getBalance: async () => ++balanceReads };
    const transfer = new Transaction({ feePayer: sponsor.publicKey, recentBlockhash: RECENT_BLOCKHASH }).add(
      SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
    );
    const body = { transaction: Buffer.from(transfer.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64") };
    const reply = await createSponsorService(sponsor, connection).sponsor(body, "1.1.1.1");
    expect(reply.status).toBe(400);
    expect(balanceReads).toBe(0);
  });

  test("refuses a transaction the guest did not sign", async () => {
    const stub = createStubConnection(SPONSOR_MIN_LAMPORTS);
    const reply = await createSponsorService(sponsor, stub.connection).sponsor(await encodeSit(Keypair.generate(), false), "1.1.1.1");
    expect(reply.status).toBe(400);
    expect(stub.sent).toHaveLength(0);
  });

  test("limits one wallet to twelve sponsored transactions an hour", async () => {
    const stub = createStubConnection(SPONSOR_MIN_LAMPORTS);
    const service = createSponsorService(sponsor, stub.connection, () => 1_000);
    const guest = Keypair.generate();
    const statuses: number[] = [];
    for (let index = 0; index < 13; index += 1) statuses.push((await service.sponsor(await encodeSit(guest), `10.0.0.${index}`)).status);
    expect(statuses.slice(0, 12).every((status) => status === 200)).toBe(true);
    expect(statuses[12]).toBe(429);
  });
});

describe("createSponsorService spending", () => {
  const [hourlyRule] = SPONSOR_SPEND_RULES;
  const hourlyLimit = hourlyRule?.limitLamports ?? 0;

  test("stops co-signing once the sponsor's balance fell by the hourly budget, and signs nothing more", async () => {
    const startLamports = 100 * SPONSOR_MIN_LAMPORTS;
    let lamports = startLamports;
    let nowMs = 0;
    const stub = createStubConnection(0);
    const connection: SponsorConnection = { ...stub.connection, getBalance: async () => lamports };
    const service = createSponsorService(sponsor, connection, () => nowMs);
    expect((await service.sponsor(await encodeSit(Keypair.generate()), "1.1.1.1")).status).toBe(200);

    lamports = startLamports - hourlyLimit;
    nowMs += SPONSOR_BALANCE_CACHE_MS;
    const refused = await service.sponsor(await encodeSit(Keypair.generate()), "2.2.2.2");
    expect(refused.status).toBe(503);
    expect(stub.sent).toHaveLength(1);
  });

  test("reads the balance once per cache period", async () => {
    let balanceReads = 0;
    let nowMs = 0;
    const stub = createStubConnection(0);
    const connection: SponsorConnection = {
      ...stub.connection,
      getBalance: async () => {
        balanceReads += 1;
        return 10 * SPONSOR_MIN_LAMPORTS;
      },
    };
    const service = createSponsorService(sponsor, connection, () => nowMs);
    for (let index = 0; index < 3; index += 1) await service.sponsor(await encodeSit(Keypair.generate()), `10.0.0.${index}`);
    await service.describe();
    expect(balanceReads).toBe(1);
    nowMs += SPONSOR_BALANCE_CACHE_MS;
    await service.describe();
    expect(balanceReads).toBe(2);
  });
});

describe("readClientIp", () => {
  test("trusts the Vercel proxy's x-real-ip, then the last forwarded hop, and ignores a client-written first hop", () => {
    expect(readClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(readClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(readClientIp(new Headers())).toBe("unknown");
  });
});

describe("loadSponsorKeypair", () => {
  test("reads the key from its JSON bytes in the environment before looking for a file", () => {
    const sponsor = Keypair.generate();
    const loaded = loadSponsorKeypair({ SANDWICH_SPONSOR_SECRET_KEY: JSON.stringify(Array.from(sponsor.secretKey)), SANDWICH_SPONSOR_KEYPAIR_PATH: "/missing" });
    expect(loaded.ok && loaded.value.publicKey.equals(sponsor.publicKey)).toBe(true);
  });

  test("refuses a malformed key and a missing configuration without echoing the value", () => {
    const malformed = loadSponsorKeypair({ SANDWICH_SPONSOR_SECRET_KEY: "[1,2,3]" });
    expect(malformed.ok ? "" : malformed.reason).toBe("SANDWICH_SPONSOR_SECRET_KEY does not hold a keypair");
    expect(loadSponsorKeypair({}).ok).toBe(false);
  });
});
