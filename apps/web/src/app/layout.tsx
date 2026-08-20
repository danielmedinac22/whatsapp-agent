import "./globals.css";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";

/**
 * **Figtree, y cargada de verdad.**
 *
 * Hasta el 20-ago-2026 el panel no cargaba ninguna fuente: `--font-body` era una
 * lista de familias *instaladas* (`"Avenir Next", "Segoe UI", "Helvetica Neue"`),
 * así que cada sistema operativo dibujaba el panel con una tipografía distinta y
 * ninguno con la que el diseño eligió.
 *
 * **Eso rompía las negritas, y ese es el motivo real de este archivo.** La escala
 * del nivel 1 pide pesos 500, 600, 700 y 800; Avenir Next no tiene 800, así que el
 * navegador lo sintetizaba engordando el trazo del 700. Se veía sucio justo donde
 * más se repite: los chips de estado de la fila (`.state-chip`) van a 800.
 *
 * Figtree es variable y trae el rango 300-900 continuo, así que cada peso que el
 * diseño nombra existe de verdad y ninguno se sintetiza.
 *
 * `next/font` la descarga **en el build** y la sirve desde nuestro dominio: sin
 * viaje a `fonts.googleapis.com` en cada carga, y con el fallback ajustado por
 * métrica que evita el salto de maquetación mientras llega. `display: "swap"`
 * porque el panel se lee, y esperar a la fuente para pintar texto que ya está en
 * el HTML es peor que un cambio de tipografía a los 100 ms.
 *
 * La variable la consume `globals.css` desde `--font-body` y `--font-display`,
 * que siguen valiendo lo mismo: el veredicto del nivel 1 fue que faltaba escala,
 * no una segunda familia.
 */
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

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
    <html lang="es" className={figtree.variable}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
