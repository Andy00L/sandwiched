"use client";

import { formatUsdc } from "@/lib/game/game-session";
import type { CashOutReceipt } from "@/lib/game/guest-chain";
import { InkButton } from "./InkButton";
import { PaperSheet } from "./PaperSheet";
import styles from "./paper.module.css";
import { useLatestShown } from "./use-latest-shown";

const DEVNET_EXPLORER_TX = "https://explorer.solana.com/tx/";

export type ReceiptSheetProps = { receipt: CashOutReceipt | null; isCashingOut: boolean; onRetry: () => void };

const shortenAddress = (address: string): string => `${address.slice(0, 4)}...${address.slice(-4)}`;

function TransactionLink({ signature }: { signature: string }) {
  return (
    <a className={styles.link} href={`${DEVNET_EXPLORER_TX}${signature}?cluster=devnet`} target="_blank" rel="noreferrer">
      See the transaction
    </a>
  );
}

function ReceiptLines({ receipt, onRetry }: { receipt: CashOutReceipt; onRetry: () => void }) {
  switch (receipt.kind) {
    case "paidOut":
      return (
        <>
          <h2 className={styles.title}>Cashed out</h2>
          <p className={styles.body}>
            {formatUsdc(receipt.units)} test USDC landed in your wallet {shortenAddress(receipt.wallet)} on Solana devnet.
          </p>
          <TransactionLink signature={receipt.signature} />
        </>
      );
    case "withdrawn":
      return (
        <>
          <h2 className={styles.title}>Cashed out</h2>
          <p className={styles.body}>
            {receipt.chips.toString()} chips became {formatUsdc(receipt.units)} test USDC in the test wallet of this browser, on Solana devnet.
          </p>
          {receipt.baseSignature === null ? null : <TransactionLink signature={receipt.baseSignature} />}
          {receipt.payoutFailure === null ? null : (
            <>
              <p className={styles.small}>Sending it on to your wallet did not go through: {receipt.payoutFailure}</p>
              <div className={styles.actions}>
                <InkButton isPrimary onPress={onRetry}>
                  Send it again
                </InkButton>
              </div>
            </>
          )}
        </>
      );
    case "onRollup":
      return (
        <>
          <h2 className={styles.title}>Half way out</h2>
          <p className={styles.body}>
            Your {formatUsdc(receipt.units)} test USDC is in your wallet on the rollup. Moving it to Solana did not go through.
          </p>
          <p className={styles.small}>{receipt.reason}</p>
          <div className={styles.actions}>
            <InkButton isPrimary onPress={onRetry}>
              Try again
            </InkButton>
          </div>
        </>
      );
    case "untouched":
      return (
        <>
          <h2 className={styles.title}>Nothing moved</h2>
          <p className={styles.body}>Your chips are still at the table.</p>
          <p className={styles.small}>{receipt.reason}</p>
          <div className={styles.actions}>
            <InkButton isPrimary onPress={onRetry}>
              Try again
            </InkButton>
          </div>
        </>
      );
  }
}

export function ReceiptSheet({ receipt, isCashingOut, onRetry }: ReceiptSheetProps) {
  const shown = useLatestShown(receipt);
  return (
    <PaperSheet isOpen={receipt !== null || isCashingOut} size="half" seed={73} label="Cash out">
      <p className={styles.label}>Receipt</p>
      {isCashingOut || shown === null ? (
        <h2 className={styles.title}>
          Counting your crumbs
          <span className={styles.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </h2>
      ) : (
        <ReceiptLines receipt={shown} onRetry={onRetry} />
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.link} onClick={() => location.reload()}>
          Back to the park
        </button>
      </div>
    </PaperSheet>
  );
}
