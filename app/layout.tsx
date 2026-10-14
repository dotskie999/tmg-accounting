import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TMG Accounting · Inventory & Menu Costing",
  description: "Current-cost inventory, recipe costing, and menu pricing for food businesses.",
  icons: {
    icon: "/tmg-accounting.png",
    shortcut: "/tmg-accounting.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
