import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookwrap Studio — AI book cover extension",
  description: "Create a matched, print-ready back cover and spine from your finished front cover.",
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
