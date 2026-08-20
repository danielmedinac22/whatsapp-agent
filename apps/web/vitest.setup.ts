import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cada prueba abre la pantalla desde cero: sin esto, la segunda encuentra dos
// bandejas montadas y `getByText` falla por ambigüedad en vez de por el bug.
afterEach(cleanup);
