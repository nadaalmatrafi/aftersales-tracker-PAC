import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Business Performance", template: "%s · Business Performance" },
  description: "Executive action plan and performance management for PAC, PCVC and DEX.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
