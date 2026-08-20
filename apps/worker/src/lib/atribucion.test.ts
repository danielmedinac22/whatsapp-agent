import { describe, expect, it } from "vitest";
import { esIdDeUsuario } from "./atribucion";

/**
 * La atribución no puede romper un envío.
 *
 * `sent_by_user_id` está en `null` en los 19.281 salientes de producción porque
 * nadie se lo pasaba al outbox. Al empezar a pasárselo aparece un riesgo nuevo
 * que antes no existía: que un valor mal formado reviente el insert y el asesor
 * vea «no se pudo enviar» por un campo que no tiene nada que ver con enviar.
 */

describe("qué acepta la atribución de un envío", () => {
  it("acepta un uuid, que es lo que el panel manda", () => {
    expect(esIdDeUsuario("3f2a1c4e-9b7d-4e21-8f60-a1b2c3d4e5f6")).toBe(true);
  });

  it("acepta el uuid en mayúsculas", () => {
    expect(esIdDeUsuario("3F2A1C4E-9B7D-4E21-8F60-A1B2C3D4E5F6")).toBe(true);
  });

  it("rechaza lo que no vino, sin ruido", () => {
    // El caso de hoy y el de siempre que el envío no salga del panel.
    expect(esIdDeUsuario(undefined)).toBe(false);
    expect(esIdDeUsuario(null)).toBe(false);
    expect(esIdDeUsuario("")).toBe(false);
  });

  it("rechaza cualquier cosa que no sea un uuid, en vez de dejarla llegar a la base", () => {
    for (const basura of [
      "katherine",
      "12345",
      "3f2a1c4e-9b7d-4e21-8f60-a1b2c3d4e5f", // le falta un dígito
      "3f2a1c4e9b7d4e218f60a1b2c3d4e5f6", // sin guiones
      "'; drop table users; --",
      42,
      true,
      {},
      [],
      { id: "3f2a1c4e-9b7d-4e21-8f60-a1b2c3d4e5f6" },
    ]) {
      expect(esIdDeUsuario(basura), String(basura)).toBe(false);
    }
  });
});
