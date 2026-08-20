import { describe, expect, it } from "vitest";
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

// Las pruebas de `OperationScopedCache` se mudaron a `cache.test.ts` cuando
// PRO-15 subió la clase a `@wa/db` y le pasó el reloj por parámetro. La del
// vencimiento estaba escrita con un `setTimeout` de 5 ms y ahora es una resta.
