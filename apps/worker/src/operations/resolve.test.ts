import { describe, expect, it } from "vitest";
import { OperationScopedCache } from "./cache";
import {
  type OperationConnectionRef,
  canUseSingleOperationFallback,
  decideInboundOperation,
  resolveOperationIdByPhoneNumberId,
} from "./resolve";

// Los uuid son inventados a propósito: la operación se resuelve por la conexión
// que recibió el mensaje, nunca por un id escrito a mano. El `phone_number_id`
// sí es el de producción — es la clave de ruteo que se está probando.
const GUATEMALA = "11111111-1111-4111-8111-111111111111";
const COLOMBIA = "22222222-2222-4222-8222-222222222222";

const NUMERO_GUATEMALA = "1226267277233200";
const NUMERO_COLOMBIA = "9988776655443322";
/** El del fixture de `kapso/inbound.test.ts`: real, y no es el de producción. */
const NUMERO_DESCONOCIDO = "1129137660293996";

const conexionGuatemala: OperationConnectionRef = {
  operationId: GUATEMALA,
  phoneNumberId: NUMERO_GUATEMALA,
};

describe("resolveOperationIdByPhoneNumberId", () => {
  it("un entrante por la conexión de Guatemala resuelve a Guatemala", () => {
    expect(
      resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, [conexionGuatemala]),
    ).toBe(GUATEMALA);
  });

  it("una conexión desconocida no resuelve a ninguna operación", () => {
    expect(
      resolveOperationIdByPhoneNumberId(NUMERO_DESCONOCIDO, [
        conexionGuatemala,
      ]),
    ).toBeNull();
  });

  it("con dos conexiones, cada número resuelve a la suya y no a la primera", () => {
    const conexiones = [
      conexionGuatemala,
      { operationId: COLOMBIA, phoneNumberId: NUMERO_COLOMBIA },
    ];
    expect(resolveOperationIdByPhoneNumberId(NUMERO_COLOMBIA, conexiones)).toBe(
      COLOMBIA,
    );
    expect(resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, conexiones)).toBe(
      GUATEMALA,
    );
  });

  it("una conexión sin operación declarada no atribuye el mensaje a nadie", () => {
    expect(
      resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, [
        { operationId: null, phoneNumberId: NUMERO_GUATEMALA },
      ]),
    ).toBeNull();
  });

  it("sin conexiones registradas no inventa una operación", () => {
    expect(resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, [])).toBeNull();
  });
});

describe("decideInboundOperation", () => {
  it("el mensaje de una conexión desconocida no se descarta: lo atiende la operación única", () => {
    const decision = decideInboundOperation({
      phoneNumberId: NUMERO_DESCONOCIDO,
      connections: [conexionGuatemala],
      singleOperationId: GUATEMALA,
    });
    expect(decision.operationId).toBe(GUATEMALA);
    expect(decision.connectionIsUnknown).toBe(true);
    expect(decision.usedSingleOperationFallback).toBe(true);
  });

  it("un entrante por la conexión de Guatemala no usa la red de seguridad", () => {
    const decision = decideInboundOperation({
      phoneNumberId: NUMERO_GUATEMALA,
      connections: [conexionGuatemala],
      singleOperationId: GUATEMALA,
    });
    expect(decision.operationId).toBe(GUATEMALA);
    expect(decision.connectionIsUnknown).toBe(false);
    expect(decision.usedSingleOperationFallback).toBe(false);
  });

  it("con una segunda operación viva, una conexión desconocida deja la conversación sin operación en vez de adivinar", () => {
    const decision = decideInboundOperation({
      phoneNumberId: NUMERO_DESCONOCIDO,
      connections: [
        conexionGuatemala,
        { operationId: COLOMBIA, phoneNumberId: NUMERO_COLOMBIA },
      ],
      // `null` es lo que devuelve `getSingleOperationId()` cuando hay más de
      // una operación activa: la red se desarma sola.
      singleOperationId: null,
    });
    expect(decision.operationId).toBeNull();
    expect(decision.connectionIsUnknown).toBe(true);
    expect(decision.usedSingleOperationFallback).toBe(false);
  });

  it("una conexión conocida sin operación declarada no se reporta como número desconocido", () => {
    const decision = decideInboundOperation({
      phoneNumberId: NUMERO_GUATEMALA,
      connections: [{ operationId: null, phoneNumberId: NUMERO_GUATEMALA }],
      singleOperationId: GUATEMALA,
    });
    expect(decision.connectionIsUnknown).toBe(false);
    expect(decision.operationId).toBe(GUATEMALA);
  });
});

describe("canUseSingleOperationFallback", () => {
  it("la operación única sin conexión etiquetada se atiende con la fila singleton", () => {
    expect(canUseSingleOperationFallback(GUATEMALA, GUATEMALA)).toBe(true);
  });

  it("no atiende a una operación con la conexión de otra", () => {
    expect(canUseSingleOperationFallback(COLOMBIA, GUATEMALA)).toBe(false);
  });

  it("con dos operaciones activas la red se desarma sola", () => {
    // `null` es lo que devuelve `getSingleOperationId()` con más de una activa.
    expect(canUseSingleOperationFallback(GUATEMALA, null)).toBe(false);
  });

  it("quien ya pide la operación única no tiene de dónde caer", () => {
    expect(canUseSingleOperationFallback(null, GUATEMALA)).toBe(false);
  });
});

describe("OperationScopedCache", () => {
  it("lo cacheado para una operación no se le sirve a otra", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "numero-de-guatemala");
    expect(cache.get(GUATEMALA)?.value).toBe("numero-de-guatemala");
    expect(cache.get(COLOMBIA)).toBeNull();
  });

  it("la operación única tiene su propia entrada y no la comparte", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(null, "fila-singleton");
    expect(cache.get(null)?.value).toBe("fila-singleton");
    expect(cache.get(GUATEMALA)).toBeNull();
  });

  it("invalidar una operación limpia también la de la operación única, que puede ser la misma fila", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "misma-fila");
    cache.set(null, "misma-fila");
    cache.set(COLOMBIA, "otra-fila");

    cache.invalidate(GUATEMALA);

    expect(cache.get(GUATEMALA)).toBeNull();
    expect(cache.get(null)).toBeNull();
    expect(cache.get(COLOMBIA)?.value).toBe("otra-fila");
  });

  it("invalidar sin argumento borra la caché entera", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "a");
    cache.set(COLOMBIA, "b");

    cache.invalidate();

    expect(cache.get(GUATEMALA)).toBeNull();
    expect(cache.get(COLOMBIA)).toBeNull();
  });

  it("una entrada vencida no se sirve", async () => {
    const cache = new OperationScopedCache<string>(1);
    cache.set(GUATEMALA, "vieja");
    await new Promise((r) => setTimeout(r, 5));
    expect(cache.get(GUATEMALA)).toBeNull();
  });

  it("cachear null es un valor, no un fallo de caché", () => {
    const cache = new OperationScopedCache<string | null>();
    cache.set(GUATEMALA, null);
    // Una operación sin conexión no debe re-consultar la base cada vez.
    expect(cache.get(GUATEMALA)).toEqual({ value: null });
  });
});
