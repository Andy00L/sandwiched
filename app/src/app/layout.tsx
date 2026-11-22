import type { Metadata } from "next";
import "./globals.css";

// ITF Free Font License, clauses 14 and 53: served from the Fontshare API, never committed to this public repository.
const FONTSHARE_STYLESHEETS = [
  "https://api.fontshare.com/v2/css?f[]=gambarino@400&display=swap",
  "https://api.fontshare.com/v2/css?f[]=sentient@400,500,700&display=swap",
];

export const metadata: Metadata = {
  title: "Sandwich",
  description: "One whale, twenty pigeons, one sandwich. A 45-second party game on Solana.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        {FONTSHARE_STYLESHEETS.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
