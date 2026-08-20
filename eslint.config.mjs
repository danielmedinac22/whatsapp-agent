// Config de la raíz: cubre `scripts/` y los propios archivos de config.
//
// `apps/*` y `packages/*` quedan afuera a propósito: cada uno tiene su
// `eslint.config.mjs` y se lintea solo cuando corre `pnpm -r lint`.

import { base } from "./eslint.config.base.mjs";

const config = [
  {
    ignores: [
      // Cada workspace se lintea con su propia config.
      "apps/**",
      "packages/**",
      // Skills de terceros, ancladas por hash en skills-lock.json:
      // no las escribimos nosotros y se reinstalan pisadas.
      ".agents/**",
    ],
  },
  ...base,
];

export default config;
