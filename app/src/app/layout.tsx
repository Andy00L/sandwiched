import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sandwich",
  description: "One whale, twenty pigeons, one sandwich. A 45-second party game on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
