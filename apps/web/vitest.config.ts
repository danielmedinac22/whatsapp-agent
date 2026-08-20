import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * El arnés de pruebas del panel.
 *
 * `apps/web` no tenía ninguno hasta hoy: las 878 pruebas del repo viven en
 * `apps/worker` y cubren lógica pura de servidor, así que **ninguna pantalla
 * estaba cubierta**. Lo que se prueba acá es lo que el asesor percibe —el
 * borrador que sobrevive, la vista que no se mueve—, no cómo está armado el
 * árbol de React.
 *
 * Corre en `jsdom` porque lo que se afirma son cosas del documento. El alias
 * `@/` es el de `tsconfig.json`, escrito otra vez porque vitest no lee los
 * `paths` de TypeScript.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
