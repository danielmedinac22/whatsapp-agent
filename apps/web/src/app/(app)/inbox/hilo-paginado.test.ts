/**
 * La mezcla del hilo por páginas, sin pantalla.
 *
 * Lo que se cuida: que volver a pedir la ventana reciente —lo que hace cada
 * `message.created`— no borre lo que el asesor ya cargó subiendo.
 */
import { describe, expect, it } from "vitest";
import { anteponerPagina, mezclarVentana } from "./hilo-paginado";

/** El mensaje n, un segundo después del anterior. */
const m = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `m-${n}`,
  createdAt: new Date(Date.UTC(2026, 9, 28, 10, 0, n)).toISOString(),
  ...extra,
});
const rango = (desde: number, hasta: number) =>
  Array.from({ length: hasta - desde }, (_, i) => m(desde + i));
const ids = (msgs: Array<{ id: string }>) => msgs.map((x) => x.id);

describe("la ventana reciente", () => {
  it("la primera vez es el hilo", () => {
    const ventana = { msgs: rango(50, 100), hasMore: true };
    expect(mezclarVentana({ msgs: [], hasMore: false }, ventana)).toEqual(
      ventana,
    );
  });

  it("no borra lo cargado hacia arriba cuando llega un mensaje nuevo", () => {
    // El asesor subió dos páginas: tiene del 0 al 99. Llega el 100 y la
    // ventana nueva es del 51 al 100.
    const cargado = { msgs: rango(0, 100), hasMore: false };
    const ventana = { msgs: rango(51, 101), hasMore: true };
    const mezcla = mezclarVentana(cargado, ventana);
    expect(ids(mezcla.msgs)).toEqual(ids(rango(0, 101)));
    // Ya había llegado al primero: sigue sin haber nada más arriba.
    expect(mezcla.hasMore).toBe(false);
  });

  it("conserva el mensaje que la ventana empujó fuera", () => {
    // Solo la primera página cargada (50..99) y llega el 100: el 50 queda fuera
    // de la ventana nueva y no puede desaparecer del hilo.
    const cargado = { msgs: rango(50, 100), hasMore: true };
    const mezcla = mezclarVentana(cargado, {
      msgs: rango(51, 101),
      hasMore: true,
    });
    expect(ids(mezcla.msgs)).toEqual(ids(rango(50, 101)));
    expect(mezcla.hasMore).toBe(true);
  });

  it("lo que cae dentro de la ventana lo manda el servidor", () => {
    const cargado = {
      msgs: [...rango(0, 60), m(60, { status: "sent" })],
      hasMore: false,
    };
    const ventana = {
      msgs: [...rango(11, 60), m(60, { status: "failed" })],
      hasMore: true,
    };
    const mezcla = mezclarVentana(cargado, ventana);
    expect(mezcla.msgs).toHaveLength(61);
    expect(new Set(ids(mezcla.msgs)).size).toBe(61);
    expect(mezcla.msgs.at(-1)).toMatchObject({ id: "m-60", status: "failed" });
  });

  it("si la ventana es el hilo entero, reemplaza", () => {
    const cargado = { msgs: rango(0, 10), hasMore: false };
    const ventana = { msgs: rango(3, 11), hasMore: false };
    expect(mezclarVentana(cargado, ventana)).toEqual(ventana);
  });

  it("un cargado del mismo milisegundo que el primero de la ventana se conserva", () => {
    const mismo = m(50).createdAt;
    const cargado = {
      msgs: [{ id: "m-gemelo", createdAt: mismo }, ...rango(50, 100)],
      hasMore: true,
    };
    const mezcla = mezclarVentana(cargado, {
      msgs: rango(50, 100),
      hasMore: true,
    });
    expect(ids(mezcla.msgs)[0]).toBe("m-gemelo");
  });
});

describe("la página anterior", () => {
  it("se antepone, sin repetir, y trae su propio hasMore", () => {
    const cargado = { msgs: rango(50, 100), hasMore: true };
    const pagina = { msgs: rango(0, 51), hasMore: false };
    const junto = anteponerPagina(cargado, pagina);
    expect(ids(junto.msgs)).toEqual(ids(rango(0, 100)));
    expect(junto.hasMore).toBe(false);
  });
});
