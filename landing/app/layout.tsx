import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({
  src: [
    { path: "./fonts/unbounded-latin-600-normal.woff2", weight: "600" },
    { path: "./fonts/unbounded-latin-800-normal.woff2", weight: "800" },
  ],
  variable: "--font-display",
  display: "swap",
});

const body = localFont({
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://cloudplay.example.com"),
  title: "CloudPlay · PS2, GameCube y Wii en cualquier pantalla",
  description:
    "Emulación de consolas en la nube para tu negocio: juega a PS2, GameCube y Wii en la tele, el móvil o el navegador, desde tus propios servidores.",
  openGraph: {
    title: "CloudPlay",
    description: "Tus clásicos de PS2, GameCube y Wii en cualquier pantalla.",
    images: ["/media/spot-poster.jpg"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} antialiased`}>
      <body className="min-h-full bg-ink text-glass font-body">{children}</body>
    </html>
  );
}
