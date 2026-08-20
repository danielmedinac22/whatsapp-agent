// Reemplaza a `next lint`, que Next 16 quitó. Ver docs/linter.md.

import next from "eslint-config-next/core-web-vitals";
import { base } from "../../eslint.config.base.mjs";

const config = [
  {
    ignores: [
      // Bundle minificado de opus-recorder: es de terceros y viaja tal cual.
      "public/**",
      // Lo genera Next en cada build.
      "next-env.d.ts",
    ],
  },
  ...base,
  ...next,
  {
    rules: {
      // Las dos reglas del React Compiler (eslint-plugin-react-hooks v7) que
      // hoy no pueden pasar en verde. Están apagadas con la lista completa de
      // ocurrencias en docs/linter.md — son 8, todas anotadas por archivo.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
];

export default config;
