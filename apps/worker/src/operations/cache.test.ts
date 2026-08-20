import { describe, expect, it } from "vitest";
import { OPERATION_CACHE_MS, OperationScopedCache } from "./cache";

/**
 * La caché por operación, probada **como función pura del tiempo**.
 *
 * Estas pruebas vivían en `resolve.test.ts` y la del vencimiento estaba escrita
 * con un TTL de 1 ms y un `setTimeout` de 5: un test que depende de que la
 * máquina no se distraiga entre dos líneas, o sea un test que falla los martes
 * y que nadie sabe leer cuando falla. Desde PRO-15 el reloj entra por parámetro
 * y el vencimiento es lo que de verdad es — una resta entre dos números.
 *
 * Se quedan en el worker porque los tests del proyecto corren solo acá, aunque
 * la clase ya viva en `@wa/db`: una prueba en `packages/db` no la correría
 * nadie, y una red que no corre promete una garantía que nadie verifica.
 */

// Los uuid son inventados: lo que se prueba es la clave, no la fila.
const GUATEMALA = "11111111-1111-4111-8111-111111111111";
const COLOMBIA = "22222222-2222-4222-8222-222222222222";

/** Un instante cualquiera. Que sea fijo es todo el punto. */
const T0 = 1_700_000_000_000;

describe("OperationScopedCache · la llave", () => {
  it("lo cacheado para una operación no se le sirve a otra", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "numero-de-guatemala", T0);
    expect(cache.get(GUATEMALA, T0)?.value).toBe("numero-de-guatemala");
    expect(cache.get(COLOMBIA, T0)).toBeNull();
  });

  it("invalidar una operación no toca la de al lado", () => {
    // Antes había además una clave de «la operación única» que apuntaba a la
    // misma fila y había que invalidar en pareja. El contract la borró junto
    // con el `operationId: null` de los accesores: una fila, una clave.
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "gt", T0);
    cache.set(COLOMBIA, "co", T0);

    cache.invalidate(GUATEMALA);

    expect(cache.get(GUATEMALA, T0)).toBeNull();
    expect(cache.get(COLOMBIA, T0)?.value).toBe("co");
  });

  it("invalidar sin argumento borra la caché entera", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "a", T0);
    cache.set(COLOMBIA, "b", T0);

    cache.invalidate();

    expect(cache.get(GUATEMALA, T0)).toBeNull();
    expect(cache.get(COLOMBIA, T0)).toBeNull();
  });

  it("cachear null es un valor, no un fallo de caché", () => {
    const cache = new OperationScopedCache<string | null>();
    cache.set(GUATEMALA, null, T0);
    // Una operación sin conexión no debe re-consultar la base cada vez.
    expect(cache.get(GUATEMALA, T0)).toEqual({ value: null });
  });
});

describe("OperationScopedCache · el vencimiento", () => {
  it("una entrada sirve hasta el último milisegundo de su TTL", () => {
    const cache = new OperationScopedCache<string>(1_000);
    cache.set(GUATEMALA, "fresca", T0);
    expect(cache.get(GUATEMALA, T0 + 999)?.value).toBe("fresca");
  });

  it("cumplido el TTL exacto ya no sirve", () => {
    // El borde va en `>=` y no en `>`: con `>` una entrada de TTL cero sería
    // eterna, que es lo contrario de lo que ese número pide.
    const cache = new OperationScopedCache<string>(1_000);
    cache.set(GUATEMALA, "vieja", T0);
    expect(cache.get(GUATEMALA, T0 + 1_000)).toBeNull();
  });

  it("el TTL por defecto es el que ya usaban los accesores", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "x", T0);
    expect(cache.get(GUATEMALA, T0 + OPERATION_CACHE_MS - 1)?.value).toBe("x");
    expect(cache.get(GUATEMALA, T0 + OPERATION_CACHE_MS)).toBeNull();
  });

  it("volver a guardar corre el vencimiento desde el nuevo momento", () => {
    const cache = new OperationScopedCache<string>(1_000);
    cache.set(GUATEMALA, "primera", T0);
    cache.set(GUATEMALA, "segunda", T0 + 900);
    expect(cache.get(GUATEMALA, T0 + 1_100)?.value).toBe("segunda");
  });
});

describe("OperationScopedCache · recordar", () => {
  /** Una fuente que dice cuántas veces la fueron a buscar. */
  function fuente(valor: string) {
    let veces = 0;
    return {
      cargar: async () => {
        veces += 1;
        return `${valor}-${veces}`;
      },
      get veces() {
        return veces;
      },
    };
  }

  it("entrega lo guardado antes del vencimiento, sin volver a la fuente", async () => {
    const cache = new OperationScopedCache<string>(1_000);
    const gt = fuente("plantillas");

    expect(await cache.recordar(GUATEMALA, gt.cargar, T0)).toBe("plantillas-1");
    expect(await cache.recordar(GUATEMALA, gt.cargar, T0 + 999)).toBe(
      "plantillas-1",
    );
    expect(gt.veces).toBe(1);
  });

  it("vuelve a la fuente después del vencimiento", async () => {
    const cache = new OperationScopedCache<string>(1_000);
    const gt = fuente("plantillas");

    await cache.recordar(GUATEMALA, gt.cargar, T0);
    expect(await cache.recordar(GUATEMALA, gt.cargar, T0 + 1_000)).toBe(
      "plantillas-2",
    );
    expect(gt.veces).toBe(2);
  });

  it("la invalidación explícita la vacía de inmediato", async () => {
    // Es la mitad que hace que la caché no mienta: quien escribe invalida, y el
    // siguiente lector tiene que ver lo que se escribió, no lo que quedaba.
    const cache = new OperationScopedCache<string>(1_000);
    const gt = fuente("plantillas");

    await cache.recordar(GUATEMALA, gt.cargar, T0);
    cache.invalidate(GUATEMALA);

    expect(await cache.recordar(GUATEMALA, gt.cargar, T0 + 1)).toBe(
      "plantillas-2",
    );
  });

  it("nunca le sirve a una operación lo que cargó para otra", async () => {
    // **La fuga silenciosa que esta clase existe para impedir**: con una sola
    // entrada, Guatemala le mostraría a Colombia sus plantillas aprobadas sin
    // que nada falle ni deje de compilar.
    const cache = new OperationScopedCache<string>(1_000);
    const gt = fuente("plantillas-gt");
    const co = fuente("plantillas-co");

    expect(await cache.recordar(GUATEMALA, gt.cargar, T0)).toBe(
      "plantillas-gt-1",
    );
    expect(await cache.recordar(COLOMBIA, co.cargar, T0)).toBe(
      "plantillas-co-1",
    );
    // Y la segunda lectura de cada una sigue siendo la suya.
    expect(await cache.recordar(GUATEMALA, co.cargar, T0 + 1)).toBe(
      "plantillas-gt-1",
    );
    expect(co.veces).toBe(1);
  });

  it("invalidar una operación no manda a la otra a la base", async () => {
    const cache = new OperationScopedCache<string>(1_000);
    const gt = fuente("gt");
    const co = fuente("co");
    await cache.recordar(GUATEMALA, gt.cargar, T0);
    await cache.recordar(COLOMBIA, co.cargar, T0);

    cache.invalidate(GUATEMALA);

    await cache.recordar(GUATEMALA, gt.cargar, T0 + 1);
    await cache.recordar(COLOMBIA, co.cargar, T0 + 1);
    expect(gt.veces).toBe(2);
    expect(co.veces).toBe(1);
  });
});
