import type { Metadata } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";

import { SnowplowProvider } from "@/components/Analytics/SnowplowProvider";
import { CartProvider } from "@/components/Cart/CartProvider";
import { DemoModeProvider } from "@/components/Demo/DemoModeProvider";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { StylistNudge } from "@/components/Interventions/StylistNudge";
import { SignalsBootstrap } from "@/components/Signals/SignalsBootstrap";
import { SignalsProvider } from "@/components/Signals/SignalsProvider";
import "./globals.css";

const display = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Atelier Signals",
  description:
    "A high-end fashion ecommerce demo for Snowplow Signals with luxury personalization workflows, interventions, and demo observability.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} antialiased`}>
        <DemoModeProvider>
          <CartProvider>
            <SignalsProvider>
              <SnowplowProvider>
                <SignalsBootstrap />
                <StylistNudge />
                <Header />
                <main className="min-h-screen">{children}</main>
                <Footer />
              </SnowplowProvider>
            </SignalsProvider>
          </CartProvider>
        </DemoModeProvider>
      </body>
    </html>
  );
}
