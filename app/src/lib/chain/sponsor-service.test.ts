import { describe, expect, test } from "bun:test";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { findTableAddress } from "./addresses";
import { buildSitInstructions, createChainPrograms } from "./program";
import { SPONSOR_MIN_LAMPORTS, type SponsorConnection, createSponsorService, readClientIp } from "./sponsor-service";

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

describe("readClientIp", () => {
  test("takes the first forwarded address, then the real IP header, then a shared bucket", () => {
    expect(readClientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(readClientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(readClientIp(new Headers())).toBe("unknown");
  });
});
