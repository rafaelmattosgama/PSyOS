import type { Metadata } from "next";
import { Playfair_Display, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-body",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-head",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PsyOS",
  description: "Plataforma clinica multi-tenant para psicologos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} ${playfair.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
