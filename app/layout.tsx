import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const title = "Ghost Monitor — AI Compute Narrative Intelligence";
  const description = "Detect market-moving AI infrastructure narratives and map their impact across the compute supply chain.";
  return {
    metadataBase: new URL(`${protocol}://${host}`), title, description,
    icons: { icon: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "Ghost Monitor AI compute narrative intelligence" }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${sans.variable} ${mono.variable}`}>{children}</body></html>;
}
