import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CostFlow · Inventory & Menu Costing",
  description: "Current-cost inventory, recipe costing, and menu pricing for food businesses.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
