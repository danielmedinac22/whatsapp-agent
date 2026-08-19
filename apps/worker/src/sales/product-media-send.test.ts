import { describe, expect, it } from "vitest";
import {
  etiquetaDeEnvio,
  parseProductMediaRef,
  productMediaRef,
} from "@wa/shared";
import { sendableProductMedia, type Operation } from "@wa/db";
import {
  MAX_APOYOS_POR_TURNO,
  apoyoDedupKey,
  decidirApoyosDelTurno,
} from "./product-media-send";

/**
 * Qué archivos del producto le llegan al lead durante la conversación.
 *
 * Los cuatro criterios del ticket viven acá: **sale solo lo que el admin
 * marcó**, **un archivo sale una sola vez por conversación**, **un archivo de
 * otra operación no sale nunca** y **lo que no cabe en el turno queda para el
 * siguiente en vez de perderse**.
 */

const MB = 1024 * 1024;

const GUATEMALA_ID = "11111111-1111-4111-8111-111111111111";
const COLOMBIA_ID = "22222222-2222-4222-8222-222222222222";

function operacion(id: string, countryCode: string, currency: string): Operation {
  return {
    id,
    name: countryCode,
    countryCode,
    currency,
    status: "active",
    capiDatasetId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const GUATEMALA = operacion(GUATEMALA_ID, "GT", "GTQ");
const COLOMBIA = operacion(COLOMBIA_ID, "CO", "COP");

const DHT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERUM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVERSACION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTRA_CONVERSACION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function archivo(over: {
  id: string;
  filename?: string;
  mime?: string;
  byteSize?: number;
  sendable?: boolean;
  operationId?: string;
  productId?: string;
}) {
  return {
    id: over.id,
    operationId: over.operationId ?? GUATEMALA_ID,
    productId: over.productId ?? DHT,
    filename: over.filename ?? `${over.id}.jpg`,
    mime: over.mime ?? "image/jpeg",
    byteSize: over.byteSize ?? 900 * 1024,
    sendable: over.sendable ?? true,
  };
}

describe("qué archivos manda el vendedor en un turno", () => {
  it("manda los archivos en el orden en que el admin los subió", () => {
    // El orden de la lista es el de la ficha del producto. Que sea ese y no
    // otro es lo que le da al admin control sobre qué ve primero el cliente sin
    // ninguna perilla nueva: reordena subiendo.
    const { envia } = decidirApoyosDelTurno({
      archivos: [archivo({ id: "1" }), archivo({ id: "2" })],
      yaEncolados: new Set(),
    });
    expect(envia.map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("un archivo que ya salió en esta conversación no se vuelve a mandar", () => {
    const { envia } = decidirApoyosDelTurno({
      archivos: [archivo({ id: "1" }), archivo({ id: "2" })],
      yaEncolados: new Set(["1"]),
    });
    expect(envia.map((a) => a.id)).toEqual(["2"]);
  });

  it("cuando ya salieron todos, el turno no manda nada", () => {
    // Es el caso normal de una conversación larga: el lead sigue preguntando y
    // Sebastián sigue contestando, sin repetirle las fotos en cada mensaje.
    const { envia, pendientes } = decidirApoyosDelTurno({
      archivos: [archivo({ id: "1" }), archivo({ id: "2" })],
      yaEncolados: new Set(["1", "2"]),
    });
    expect(envia).toEqual([]);
    expect(pendientes).toEqual([]);
  });

  it("con más archivos que el tope del turno, el resto queda pendiente y no se pierde", () => {
    // Seis mensajes seguidos apenas el lead dice «hola» no es mostrar el
    // producto, es una ráfaga. El tope reparte; no recorta.
    const archivos = ["1", "2", "3", "4", "5"].map((id) => archivo({ id }));
    const { envia, pendientes } = decidirApoyosDelTurno({
      archivos,
      yaEncolados: new Set(),
    });
    expect(envia).toHaveLength(MAX_APOYOS_POR_TURNO);
    expect(pendientes.map((a) => a.id)).toEqual(["4", "5"]);
  });

  it("lo que quedó pendiente sale en el turno siguiente", () => {
    const archivos = ["1", "2", "3", "4", "5"].map((id) => archivo({ id }));
    const primero = decidirApoyosDelTurno({ archivos, yaEncolados: new Set() });
    const segundo = decidirApoyosDelTurno({
      archivos,
      yaEncolados: new Set(primero.envia.map((a) => a.id)),
    });
    expect(segundo.envia.map((a) => a.id)).toEqual(["4", "5"]);
    expect(segundo.pendientes).toEqual([]);
  });
});

describe("de los archivos cargados a los que de verdad salen", () => {
  it("el desmarcado no sale, aunque esté cargado en el producto", () => {
    // El criterio del ticket, entero: lo que decide es el interruptor del
    // panel, no el hecho de que el archivo exista.
    const archivos = [
      archivo({ id: "ficha", filename: "ficha-producto.pdf", mime: "application/pdf" }),
      archivo({ id: "margen", filename: "margen-interno.xlsx", sendable: false }),
    ];
    const enviables = sendableProductMedia(archivos, GUATEMALA, DHT);
    const { envia } = decidirApoyosDelTurno({ archivos: enviables, yaEncolados: new Set() });
    expect(envia.map((a) => a.id)).toEqual(["ficha"]);
  });

  it("un archivo de otra operación no sale, ni aunque llegue en la lista", () => {
    // La clave foránea compuesta ya lo impide en la base. Esto es la misma
    // garantía en el código, que es donde el id viaja suelto.
    const archivos = [
      archivo({ id: "gt" }),
      archivo({ id: "co", operationId: COLOMBIA_ID }),
    ];
    const { envia } = decidirApoyosDelTurno({
      archivos: sendableProductMedia(archivos, GUATEMALA, DHT),
      yaEncolados: new Set(),
    });
    expect(envia.map((a) => a.id)).toEqual(["gt"]);
    expect(
      sendableProductMedia(archivos, COLOMBIA, DHT).map((a) => a.id),
    ).toEqual(["co"]);
  });

  it("un archivo de otro producto de la misma operación tampoco sale", () => {
    const archivos = [archivo({ id: "dht" }), archivo({ id: "serum", productId: SERUM })];
    const { envia } = decidirApoyosDelTurno({
      archivos: sendableProductMedia(archivos, GUATEMALA, DHT),
      yaEncolados: new Set(),
    });
    expect(envia.map((a) => a.id)).toEqual(["dht"]);
  });

  it("un video que excede el límite de WhatsApp no sale, y los demás sí", () => {
    // El rechazo por tamaño ya ocurrió al subir; esta es la última pregunta
    // antes de mandar, para el día en que Meta baje el límite y filas ya
    // guardadas dejen de caber sin que nadie las toque. Lo que el ticket pide
    // es que ese archivo no rompa el turno: los otros salen igual.
    const archivos = [
      archivo({ id: "pesado", filename: "testimonio.mp4", mime: "video/mp4", byteSize: 27 * MB }),
      archivo({ id: "liviano", filename: "antes-despues.jpg" }),
    ];
    const { envia } = decidirApoyosDelTurno({
      archivos: sendableProductMedia(archivos, GUATEMALA, DHT),
      yaEncolados: new Set(),
    });
    expect(envia.map((a) => a.id)).toEqual(["liviano"]);
  });
});

describe("un archivo, una vez por conversación", () => {
  it("el mismo archivo en la misma conversación produce siempre la misma llave", () => {
    // De esto depende que el índice único del outbox sea el que impide el
    // duplicado, y no un chequeo nuestro que dos turnos cruzados podrían saltar.
    expect(apoyoDedupKey(CONVERSACION, "archivo-1")).toBe(
      apoyoDedupKey(CONVERSACION, "archivo-1"),
    );
  });

  it("el mismo archivo en otra conversación sí vuelve a salir", () => {
    // Un lead nuevo tiene que ver las fotos aunque otro ya las haya visto.
    expect(apoyoDedupKey(CONVERSACION, "archivo-1")).not.toBe(
      apoyoDedupKey(OTRA_CONVERSACION, "archivo-1"),
    );
  });
});

describe("cómo el envío dice que lleva un archivo del catálogo", () => {
  it("un envío de archivo se reconoce por su referencia", () => {
    expect(parseProductMediaRef(productMediaRef("archivo-1"))).toBe("archivo-1");
  });

  it("un envío corriente no se confunde con un archivo", () => {
    // En esa misma columna viajan ids de pedido y de conversación desde antes
    // de que existiera esto. Confundir uno sería mandarle al cliente un archivo
    // que nadie eligió.
    expect(parseProductMediaRef(CONVERSACION)).toBeNull();
    expect(parseProductMediaRef(null)).toBeNull();
    expect(parseProductMediaRef("product_media:")).toBeNull();
  });
});

describe("cómo se ve en el hilo lo que recibió el cliente", () => {
  it("la burbuja dice qué archivo recibió, con su nombre", () => {
    // El asesor que abre el chat necesita saber cuál de los tres videos le
    // llegó, no que le llegó «un video».
    expect(etiquetaDeEnvio("antes-despues.jpg", "image/jpeg")).toContain(
      "antes-despues.jpg",
    );
  });

  it("cada tipo de archivo se distingue de un vistazo", () => {
    expect(etiquetaDeEnvio("antes.jpg", "image/jpeg")).toBe("📷 antes.jpg");
    expect(etiquetaDeEnvio("demo.mp4", "video/mp4")).toBe("🎥 demo.mp4");
    expect(etiquetaDeEnvio("ficha.pdf", "application/pdf")).toBe("📄 ficha.pdf");
  });
});
