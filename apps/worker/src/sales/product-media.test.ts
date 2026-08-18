import { describe, expect, it } from "vitest";
import {
  conteoDeEnviables,
  excedeLimiteDeWhatsapp,
  formatoDeTamano,
  interruptorHabilitado,
  mediaKind,
  puedeEnviarse,
  rechazoDeSubida,
  whatsappLimitBytes,
  PANEL_UPLOAD_MAX_BYTES,
} from "@wa/shared";
import {
  groupMediaByProduct,
  resolveProductMedia,
  sendableProductMedia,
  type Operation,
} from "@wa/db";

/**
 * Los archivos enviables por producto: qué se acepta al subir, qué le llega al
 * cliente, y qué no puede cruzar de una operación a otra.
 *
 * Los dos criterios que estas pruebas sostienen son observables y del ticket:
 * **un archivo que excede el límite se rechaza al subir y no al enviar**, y
 * **un archivo desmarcado no sale, aunque esté cargado**.
 */

const MB = 1024 * 1024;

// UUIDs inventados, igual que en el accesor hermano: la operación se resuelve
// por su fila y nunca por un identificador de producción escrito a mano.
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

function archivo(
  operationId: string,
  productId: string,
  filename: string,
  mime: string,
  byteSize: number,
  sendable: boolean,
) {
  return { operationId, productId, filename, mime, byteSize, sendable };
}

describe("el rechazo por tamaño ocurre al subir, no al enviar", () => {
  it("el video de 27 MB no se sube, y el motivo nombra el límite que rompe", () => {
    // El caso del ticket, con el archivo que lo nombra. Que el motivo diga el
    // límite es lo que convierte «no se pudo» en «recomprimilo a menos de 16».
    const motivo = rechazoDeSubida({
      filename: "testimonio.mp4",
      mime: "video/mp4",
      byteSize: 27 * MB,
    });
    expect(motivo?.motivo).toBe("excede_whatsapp");
    expect(motivo?.texto).toContain("testimonio.mp4");
    expect(motivo?.texto).toContain("16 MB");
  });

  it("una imagen de 8 MB también se rechaza, aunque un video de 8 MB pase", () => {
    // El límite no es uno solo. Tratar todo como 16 MB dejaría subir un JPG que
    // el panel muestra enviable y que Meta rechaza al mandarlo — el mismo error
    // del ticket, movido al momento en que el admin ya no puede hacer nada.
    const imagen = { filename: "antes.jpg", mime: "image/jpeg", byteSize: 8 * MB };
    const video = { filename: "clip.mp4", mime: "video/mp4", byteSize: 8 * MB };
    expect(rechazoDeSubida(imagen)?.motivo).toBe("excede_whatsapp");
    expect(rechazoDeSubida(video)?.motivo).not.toBe("excede_whatsapp");
  });

  it("cuando rompe los dos límites, el motivo que se dice es el de WhatsApp", () => {
    // 27 MB no cabe ni en WhatsApp ni en la subida del panel. El de WhatsApp es
    // el que significa «este archivo no se puede enviar nunca»; el del panel es
    // «hoy no se puede subir por acá». Decirle el segundo lo manda a resolver
    // el problema equivocado.
    const motivo = rechazoDeSubida({
      filename: "testimonio.mp4",
      mime: "video/mp4",
      byteSize: 27 * MB,
    });
    expect(motivo?.motivo).toBe("excede_whatsapp");
  });

  it("un archivo que WhatsApp aceptaría pero la subida del panel no, tiene su propio motivo", () => {
    // El techo real de hoy: el panel corre en Vercel y su función corta el
    // cuerpo de la petición. Es un tope de dónde está alojado el panel, no del
    // archivo, y se arregla distinto — por eso no comparte motivo.
    const motivo = rechazoDeSubida({
      filename: "dermatologo.mp4",
      mime: "video/mp4",
      byteSize: 8 * MB,
    });
    expect(motivo?.motivo).toBe("excede_la_subida_del_panel");
    expect(8 * MB).toBeGreaterThan(PANEL_UPLOAD_MAX_BYTES);
    expect(8 * MB).toBeLessThan(whatsappLimitBytes("video/mp4"));
  });

  it("la ficha en PDF y la foto del producto suben sin ruido", () => {
    expect(
      rechazoDeSubida({
        filename: "ficha-producto.pdf",
        mime: "application/pdf",
        byteSize: 480 * 1024,
      }),
    ).toBeNull();
    expect(
      rechazoDeSubida({
        filename: "antes-despues.jpg",
        mime: "image/jpeg",
        byteSize: Math.round(1.2 * MB),
      }),
    ).toBeNull();
  });

  it("un archivo de cero bytes es una subida cortada, no un archivo", () => {
    expect(
      rechazoDeSubida({ filename: "vacio.pdf", mime: "application/pdf", byteSize: 0 }),
    ).toMatchObject({ motivo: "vacio" });
  });

  it("lo que no es imagen, video ni audio viaja como documento", () => {
    // Es también como lo trata la API: el PDF de la ficha y la hoja de cálculo
    // de márgenes internos van por el mismo camino.
    expect(mediaKind("application/pdf")).toBe("document");
    expect(
      mediaKind(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("document");
    expect(mediaKind("image/png")).toBe("image");
    expect(mediaKind("VIDEO/MP4")).toBe("video");
  });
});

describe("solo llega al cliente lo que el admin marcó", () => {
  const ficha = archivo(GUATEMALA_ID, DHT, "ficha.pdf", "application/pdf", 480 * 1024, true);
  const margenes = archivo(GUATEMALA_ID, DHT, "margen-interno.xlsx", "application/vnd.ms-excel", 44 * 1024, false);

  it("un archivo cargado y desmarcado no se envía", () => {
    // La hoja de márgenes internos es el caso: está cargada a propósito, para
    // tenerla a mano, y mandársela al cliente no se deshace.
    expect(puedeEnviarse(margenes)).toBe(false);
    expect(puedeEnviarse(ficha)).toBe(true);
  });

  it("un archivo marcado que excede el límite tampoco se envía", () => {
    // No debería existir —el rechazo al subir lo ataja—, pero el límite es de
    // Meta: si baja, filas ya guardadas caen de este lado sin que nadie las
    // toque. La última pregunta antes de mandar es la que decide.
    const grande = archivo(GUATEMALA_ID, DHT, "viejo.mp4", "video/mp4", 20 * MB, true);
    expect(grande.sendable).toBe(true);
    expect(puedeEnviarse(grande)).toBe(false);
    expect(interruptorHabilitado(grande)).toBe(false);
  });

  it("el conteo de la cabecera cuenta lo que llega, no lo que está marcado", () => {
    // «2 de 4 enviables» tiene que poder leerse como «al cliente le llegan 2».
    const grande = archivo(GUATEMALA_ID, DHT, "viejo.mp4", "video/mp4", 20 * MB, true);
    const foto = archivo(GUATEMALA_ID, DHT, "antes.jpg", "image/jpeg", MB, true);
    const conteo = conteoDeEnviables([ficha, foto, grande, margenes]);
    expect(conteo).toMatchObject({ enviables: 2, total: 4 });
    expect(conteo.texto).toBe("2 de 4 enviables");
  });

  it("un producto sin archivos dice cero de cero, no se rompe", () => {
    expect(conteoDeEnviables([])).toMatchObject({ enviables: 0, total: 0 });
  });
});

describe("un archivo no puede cruzar de una operación a otra", () => {
  const rows = [
    archivo(GUATEMALA_ID, DHT, "ficha-gt.pdf", "application/pdf", 480 * 1024, true),
    archivo(COLOMBIA_ID, SERUM, "ficha-co.pdf", "application/pdf", 480 * 1024, true),
  ];

  it("los archivos de la operación vecina no aparecen", () => {
    // La clave foránea compuesta lo impide en la base. Esto es la misma regla
    // donde se puede probar sin base, y la que sostiene la garantía cuando las
    // filas no vienen de una consulta.
    expect(resolveProductMedia(rows, GUATEMALA, DHT).map((r) => r.filename)).toEqual([
      "ficha-gt.pdf",
    ]);
    expect(resolveProductMedia(rows, GUATEMALA, SERUM)).toEqual([]);
  });

  it("pedir los enviables de un producto ajeno devuelve vacío, nunca los de otro", () => {
    // El daño de preferir «algunos archivos» a «ninguno» es concreto: el
    // vendedor guatemalteco mandándole al cliente la ficha del producto
    // colombiano, con su precio y su moneda.
    expect(sendableProductMedia(rows, GUATEMALA, SERUM)).toEqual([]);
    expect(sendableProductMedia(rows, COLOMBIA, SERUM).map((r) => r.filename)).toEqual([
      "ficha-co.pdf",
    ]);
  });

  it("agrupar por producto descarta lo ajeno y lo huérfano", () => {
    const huerfano = archivo(
      GUATEMALA_ID,
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "suelto.pdf",
      "application/pdf",
      1024,
      true,
    );
    const grupos = groupMediaByProduct([...rows, huerfano], GUATEMALA, [DHT]);
    expect(grupos.get(DHT)?.map((r) => r.filename)).toEqual(["ficha-gt.pdf"]);
    expect(grupos.size).toBe(1);
  });

  it("un producto sin archivos queda con su lista vacía, no ausente", () => {
    // La ficha necesita distinguir «no cargó nada» de «este producto no está»:
    // sin la entrada, la pantalla tendría que adivinar cuál de las dos es.
    const grupos = groupMediaByProduct(rows, GUATEMALA, [DHT, SERUM]);
    expect(grupos.get(SERUM)).toEqual([]);
  });
});

describe("los tamaños se leen como los lee una persona", () => {
  it("el peso se escribe como en la ficha", () => {
    expect(formatoDeTamano(480 * 1024)).toBe("480 KB");
    expect(formatoDeTamano(Math.round(1.2 * MB))).toBe("1,2 MB");
    expect(formatoDeTamano(27 * MB)).toBe("27 MB");
  });

  it("el límite de cada tipo es el de Meta, no uno inventado acá", () => {
    expect(whatsappLimitBytes("image/jpeg")).toBe(5 * MB);
    expect(whatsappLimitBytes("video/mp4")).toBe(16 * MB);
    expect(whatsappLimitBytes("audio/ogg")).toBe(16 * MB);
    expect(whatsappLimitBytes("application/pdf")).toBe(100 * MB);
    expect(excedeLimiteDeWhatsapp("image/jpeg", 5 * MB)).toBe(false);
    expect(excedeLimiteDeWhatsapp("image/jpeg", 5 * MB + 1)).toBe(true);
  });
});
