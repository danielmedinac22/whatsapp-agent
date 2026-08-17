import { describe, expect, it } from "vitest";
import { OperationScopedCache } from "./cache";
import {
  type OperationConnectionRef,
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

  it("sin conexiones registradas no inventa una operación", () => {
    expect(resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, [])).toBeNull();
  });

  it("una conexión sin `phone_number_id` no atribuye nada", () => {
    // Es el estado de una conexión a medio configurar. Desde la `0021` una
    // conexión sin operación ya no puede existir —`operation_id` es obligatoria—
    // pero sí una sin número, que es lo que se prueba aquí.
    expect(
      resolveOperationIdByPhoneNumberId(NUMERO_GUATEMALA, [
        { operationId: COLOMBIA, phoneNumberId: null },
      ]),
    ).toBeNull();
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
      // `null` es lo que devuelve `getSingleActiveOperation()` cuando hay más de
      // una operación activa: la red se desarma sola.
      singleOperationId: null,
    });
    expect(decision.operationId).toBeNull();
    expect(decision.connectionIsUnknown).toBe(true);
    expect(decision.usedSingleOperationFallback).toBe(false);
  });

  it("sin red y sin conexión reconocida, el mensaje sigue su curso sin operación", () => {
    // Es el estado que obliga a que `conversations.operation_id` siga siendo
    // nullable después del contract: la decisión no tiene un caso «descartar»,
    // así que el pipeline guarda el mensaje sin operación en vez de perderlo.
    const decision = decideInboundOperation({
      phoneNumberId: NUMERO_DESCONOCIDO,
      connections: [],
      singleOperationId: null,
    });
    expect(decision.operationId).toBeNull();
    expect(decision.connectionIsUnknown).toBe(true);
  });
});

describe("OperationScopedCache", () => {
  it("lo cacheado para una operación no se le sirve a otra", () => {
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "numero-de-guatemala");
    expect(cache.get(GUATEMALA)?.value).toBe("numero-de-guatemala");
    expect(cache.get(COLOMBIA)).toBeNull();
  });

  it("invalidar una operación no toca la de al lado", () => {
    // Antes había además una clave de «la operación única» que apuntaba a la
    // misma fila y había que invalidar en pareja. El contract la borró junto
    // con el `operationId: null` de los accesores: una fila, una clave.
    const cache = new OperationScopedCache<string>();
    cache.set(GUATEMALA, "gt");
    cache.set(COLOMBIA, "co");

    cache.invalidate(GUATEMALA);

    expect(cache.get(GUATEMALA)).toBeNull();
    expect(cache.get(COLOMBIA)?.value).toBe("co");
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
