import { SolanaSignTransaction, type SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { type Result, attempt, attemptSync, failure, success } from "./result";
import type { TransactionSigner } from "./transport";

const WALLET_CHAIN = "solana:devnet";

type SignFeature = SolanaSignTransactionFeature[typeof SolanaSignTransaction];
type ConnectFeature = StandardConnectFeature[typeof StandardConnect];

export type WalletChoice = { name: string; icon: string; wallet: Wallet };

const hasMethod = (feature: unknown, method: string): boolean =>
  typeof feature === "object" && feature !== null && typeof Reflect.get(feature, method) === "function";

const isConnectFeature = (feature: unknown): feature is ConnectFeature => hasMethod(feature, "connect");

const isLegacySignFeature = (feature: unknown): feature is SignFeature => {
  if (!hasMethod(feature, "signTransaction")) return false;
  const versions: unknown = Reflect.get(Object(feature), "supportedTransactionVersions");
  return Array.isArray(versions) && versions.includes("legacy");
};

const listUsableWallets = (wallets: readonly Wallet[]): readonly WalletChoice[] =>
  wallets
    .filter((wallet) => wallet.chains.includes(WALLET_CHAIN) && isConnectFeature(wallet.features[StandardConnect]) && isLegacySignFeature(wallet.features[SolanaSignTransaction]))
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

function createWalletSigner(publicKey: PublicKey, account: WalletAccount, feature: SignFeature, onPrompt: (isWaiting: boolean) => void): TransactionSigner {
  let declinedReason: string | null = null;
  let previousTurn: Promise<unknown> = Promise.resolve();
  const signNow = async (transaction: Transaction): Promise<Result<Transaction>> => {
    if (declinedReason !== null) return failure(declinedReason);
    const unsigned = attemptSync(() => transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
    if (!unsigned.ok) return failure(`[signWithBrowserWallet] ${unsigned.reason}`);
    onPrompt(true);
    const signed = await attempt(() => feature.signTransaction({ account, transaction: Uint8Array.from(unsigned.value), chain: WALLET_CHAIN }));
    onPrompt(false);
    if (!signed.ok) {
      declinedReason = `[signWithBrowserWallet] the wallet declined: ${signed.reason}`;
      return failure(declinedReason);
    }
    const [output] = signed.value;
    if (output === undefined) return failure("[signWithBrowserWallet] the wallet returned no transaction");
    return attemptSync(() => Transaction.from(output.signedTransaction));
  };
  return {
    publicKey,
    signTransaction: (transaction) => {
      const turn = previousTurn.then(() => signNow(transaction));
      previousTurn = turn;
      return turn;
    },
    readDecline: () => declinedReason,
  };
}

export async function connectBrowserWallet(choice: WalletChoice, onPrompt: (isWaiting: boolean) => void): Promise<Result<TransactionSigner>> {
  const connect = choice.wallet.features[StandardConnect];
  const sign = choice.wallet.features[SolanaSignTransaction];
  if (!isConnectFeature(connect) || !isLegacySignFeature(sign)) return failure(`[connectBrowserWallet] ${choice.name} cannot sign Solana transactions`);
  onPrompt(true);
  const connected = await attempt(() => connect.connect());
  onPrompt(false);
  if (!connected.ok) return failure(`[connectBrowserWallet] ${choice.name} did not connect: ${connected.reason}`);
  const account = connected.value.accounts.find((candidate) => candidate.chains.includes(WALLET_CHAIN)) ?? connected.value.accounts[0];
  if (account === undefined) return failure(`[connectBrowserWallet] ${choice.name} shared no account`);
  const publicKey = attemptSync(() => new PublicKey(account.publicKey));
  if (!publicKey.ok) return failure(`[connectBrowserWallet] ${publicKey.reason}`);
  return success(createWalletSigner(publicKey.value, account, sign, onPrompt));
}
