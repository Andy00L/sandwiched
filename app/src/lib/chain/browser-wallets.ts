import { PublicKey } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { type Result, attempt, attemptSync, failure, success } from "./result";

const WALLET_CHAIN = "solana:devnet";

type ConnectFeature = StandardConnectFeature[typeof StandardConnect];

export type WalletChoice = { name: string; icon: string; wallet: Wallet };

const isConnectFeature = (feature: unknown): feature is ConnectFeature =>
  typeof feature === "object" && feature !== null && typeof Reflect.get(feature, "connect") === "function";

const listUsableWallets = (wallets: readonly Wallet[]): readonly WalletChoice[] =>
  wallets
    .filter((wallet) => wallet.chains.includes(WALLET_CHAIN) && isConnectFeature(wallet.features[StandardConnect]))
    .map((wallet) => ({ name: wallet.name, icon: wallet.icon, wallet }));

const NO_WALLETS: readonly WalletChoice[] = [];
let usableWallets: readonly WalletChoice[] | null = null;

export const walletDirectory = {
  subscribe: (listener: () => void) => {
    const wallets = getWallets();
    const refresh = () => {
      usableWallets = listUsableWallets(wallets.get());
      listener();
    };
    const stopRegister = wallets.on("register", refresh);
    const stopUnregister = wallets.on("unregister", refresh);
    return () => {
      stopRegister();
      stopUnregister();
    };
  },
  getSnapshot: (): readonly WalletChoice[] => (usableWallets ??= listUsableWallets(getWallets().get())),
  getServerSnapshot: (): readonly WalletChoice[] => NO_WALLETS,
};

export async function connectPayoutWallet(choice: WalletChoice, onPrompt: (isWaiting: boolean) => void): Promise<Result<PublicKey>> {
  const connect = choice.wallet.features[StandardConnect];
  if (!isConnectFeature(connect)) return failure(`[connectPayoutWallet] ${choice.name} cannot connect`);
  onPrompt(true);
  const connected = await attempt(() => connect.connect());
  onPrompt(false);
  if (!connected.ok) return failure(`[connectPayoutWallet] ${choice.name} did not connect: ${connected.reason}`);
  const account = connected.value.accounts.find((candidate) => candidate.chains.includes(WALLET_CHAIN)) ?? connected.value.accounts[0];
  if (account === undefined) return failure(`[connectPayoutWallet] ${choice.name} shared no account`);
  const publicKey = attemptSync(() => new PublicKey(account.publicKey));
  return publicKey.ok ? success(publicKey.value) : failure(`[connectPayoutWallet] ${publicKey.reason}`);
}
