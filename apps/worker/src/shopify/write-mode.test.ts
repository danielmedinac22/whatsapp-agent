import { describe, expect, it } from "vitest";
import { classifyStoreFailure, unexpectedFailure } from "./failure";
import {
  resolveStoreWriteMode,
  STORE_WRITE_MODE_ENV,
  storeWriteMode,
} from "./write-mode";
import {
  hasCapability,
  REQUESTED_SCOPES,
  resolveStoreCapabilities,
} from "./scopes";
import { extractOrderTags } from "./extract";

// ── El interruptor ──────────────────────────────────────────────────────────

describe("resolveStoreWriteMode · el modo seco arranca puesto", () => {
  it("sin variable, no se escribe en la tienda", () => {
    expect(resolveStoreWriteMode(undefined)).toBe("dry_run");
    expect(resolveStoreWriteMode(null)).toBe("dry_run");
    expect(resolveStoreWriteMode("")).toBe("dry_run");
  });

  it("solo `live` enciende la escritura", () => {
    expect(resolveStoreWriteMode("live")).toBe("live");
    expect(resolveStoreWriteMode("  LIVE  ")).toBe("live");
  });

  it("un valor que no entendemos NO enciende la escritura", () => {
    // Es al revés de lo que suele hacerse, y es deliberado: la dirección segura
    // del error es no escribir en la tienda de un cliente. `true` y `1` parecen
    // «encendido» y no lo son.
    for (const raro of ["true", "1", "on", "si", "yes", "liv", "production"]) {
      expect(resolveStoreWriteMode(raro)).toBe("dry_run");
    }
  });

  it("el proceso arranca en seco mientras nadie ponga la variable", () => {
    const antes = process.env[STORE_WRITE_MODE_ENV];
    delete process.env[STORE_WRITE_MODE_ENV];
    try {
      expect(storeWriteMode()).toBe("dry_run");
    } finally {
      if (antes !== undefined) process.env[STORE_WRITE_MODE_ENV] = antes;
    }
  });
});

// ── Reintentar, o llamar a una persona ──────────────────────────────────────

describe("classifyStoreFailure · qué se reintenta y qué no", () => {
  it("sin respuesta de la tienda se reintenta", () => {
    expect(classifyStoreFailure({ kind: "network" }).disposition).toBe("retry");
  });

  it("la tienda saturada o caída se reintenta", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(classifyStoreFailure({ kind: "http", status }).disposition).toBe(
        "retry",
      );
    }
  });

  it("un token muerto o un permiso que falta llaman a una persona", () => {
    // Parece transitorio —«ya se refrescará»— y no lo es: los tokens de app
    // privada no rotan solos. Un 401 significa que alguien lo revocó, y eso se
    // arregla en el panel de conexión, no esperando.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyStoreFailure({ kind: "http", status }).disposition).toBe(
        "human",
      );
    }
  });

  it("«bajá el ritmo» viaja con 200 y aun así se reintenta", () => {
    // La trampa clásica de esta API: el throttling no llega como 429 sino como
    // un error de GraphQL dentro de una respuesta exitosa.
    const f = classifyStoreFailure({ kind: "graphql", codes: ["THROTTLED"] });
    expect(f.disposition).toBe("retry");
    expect(f.reason).toContain("ritmo");
  });

  it("otros errores de la consulta llaman a una persona", () => {
    expect(
      classifyStoreFailure({ kind: "graphql", codes: ["ACCESS_DENIED"] })
        .disposition,
    ).toBe("human");
  });

  it("un pedido rechazado no mejora reintentando", () => {
    // Una variante que no existe seguirá sin existir dentro de seis intentos.
    // Lo único que logra reintentar es que el cliente espere seis veces más
    // antes de que alguien mire.
    const f = classifyStoreFailure({
      kind: "user_errors",
      messages: ["variantId: no existe"],
    });
    expect(f.disposition).toBe("human");
    expect(f.reason).toContain("variantId");
  });

  it("un fallo sin clasificar se reintenta antes que descartar la venta", () => {
    expect(unexpectedFailure(new Error("boom")).disposition).toBe("retry");
  });
});

// ── Los permisos de la tienda ───────────────────────────────────────────────

describe("resolveStoreCapabilities · qué habilita el token", () => {
  it("con los tres permisos pedidos se puede crear pedidos", () => {
    const r = resolveStoreCapabilities([...REQUESTED_SCOPES]);
    expect(hasCapability(r, "product_context")).toBe(true);
    expect(hasCapability(r, "order_lookup")).toBe(true);
    expect(hasCapability(r, "order_create")).toBe(true);
    expect(r.excess).toEqual([]);
  });

  it("el token de hoy —solo lectura de productos— no puede crear pedidos", () => {
    // Es el estado del token que el panel viene pidiendo desde antes de este
    // ticket: `read_products` y `read_orders`. Alcanza para conversar, no para
    // cerrar.
    const r = resolveStoreCapabilities(["read_products", "read_orders"]);
    expect(hasCapability(r, "product_context")).toBe(true);
    expect(hasCapability(r, "order_lookup")).toBe(true);
    expect(hasCapability(r, "order_create")).toBe(false);
    expect(
      r.capabilities.find((c) => c.capability === "order_create")?.missing,
    ).toEqual(["write_orders"]);
  });

  it("escribir pedidos concede también leerlos", () => {
    // Sin esta expansión, un token con `write_orders` y sin `read_orders` en la
    // lista diría que falta un permiso que sí está, y bloquearía la creación
    // por un dato mal leído.
    const r = resolveStoreCapabilities(["read_products", "write_orders"]);
    expect(hasCapability(r, "order_lookup")).toBe(true);
    expect(hasCapability(r, "order_create")).toBe(true);
  });

  it("un permiso de más se ve, y no bloquea nada", () => {
    // Es lo que hace verificable el «no más de lo necesario» del ticket:
    // `write_products` sobre la tienda que factura es capacidad de escritura
    // que nadie pidió.
    const r = resolveStoreCapabilities([...REQUESTED_SCOPES, "write_products"]);
    expect(r.excess).toEqual(["write_products"]);
    expect(hasCapability(r, "order_create")).toBe(true);
  });

  it("un token sin nada no habilita nada, y dice qué le falta", () => {
    const r = resolveStoreCapabilities([]);
    expect(r.capabilities.every((c) => !c.granted)).toBe(true);
    expect(
      r.capabilities.find((c) => c.capability === "order_create")?.missing,
    ).toEqual(["read_orders", "write_orders"]);
  });
});

// ── Las etiquetas del pedido, tal como llegan ───────────────────────────────

describe("extractOrderTags · el origen se lee de la carga cruda", () => {
  it("el webhook manda una cadena separada por comas", () => {
    // Forma real, medida en producción: los 1.732 pedidos guardados traen
    // `tags`, todos con `releasit_cod_form`.
    expect(extractOrderTags({ tags: "releasit_cod_form" })).toEqual([
      "releasit_cod_form",
    ]);
    expect(extractOrderTags({ tags: "origen-ventas, vendedor:Sebastián" })).toEqual(
      ["origen-ventas", "vendedor:Sebastián"],
    );
  });

  it("la API de administración manda un arreglo", () => {
    // Leer solo una de las dos formas haría que el origen se resolviera bien en
    // un camino y mal en el otro — y mal significa auto-confirmar un pedido de
    // ventas que nadie confirmó.
    expect(extractOrderTags({ tags: ["origen-ventas", "  "] })).toEqual([
      "origen-ventas",
    ]);
  });

  it("un pedido sin etiquetas no rompe nada", () => {
    expect(extractOrderTags({})).toEqual([]);
    expect(extractOrderTags(null)).toEqual([]);
    expect(extractOrderTags({ tags: "" })).toEqual([]);
    expect(extractOrderTags({ tags: 42 })).toEqual([]);
  });
});
