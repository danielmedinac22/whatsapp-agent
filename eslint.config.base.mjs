// Base de ESLint compartida por los cuatro workspaces del monorepo.
//
// Cada workspace la importa desde su propio `eslint.config.mjs`, así que
// `pnpm -r lint` lintea cada paquete con la misma vara y hay un solo lugar
// donde cambiar las reglas.
//
// Qué quedó apagado, con cuántos hallazgos y cómo volver a prenderlo:
// docs/linter.md. Si vas a apagar algo más, anotalo ahí también.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Carpetas generadas o de terceros: no son código nuestro y no se lintean. */
export const ignoresComunes = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
];

export const base = tseslint.config(
  { ignores: ignoresComunes },

  js.configs.recommended,

  // `recommended` a secas, no `recommendedTypeChecked`: las reglas con tipos
  // exigen levantar el programa de TypeScript por archivo y son mucho más
  // lentas. El typecheck ya corre aparte (`pnpm -r typecheck`) y cubre eso.
  ...tseslint.configs.recommended,

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // Un argumento que empieza con `_` está sin usar a propósito —
      // convención de siempre, no un permiso nuevo.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // Los helpers de test arman payloads crudos a mano (los de Kapso, por
    // ejemplo) y ahí `any` es la herramienta correcta: pedirles `unknown`
    // obliga a castear en cada aserción y no aporta seguridad.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);

export default base;
