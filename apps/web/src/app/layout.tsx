import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WhatsApp Agent",
  description: "Self-hosted WhatsApp dashboard with Shopify follow-up",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
