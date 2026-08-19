import { describe, expect, it } from "vitest";
import { buildMediaMessageBody } from "./client";

/**
 * La forma del mensaje con el que sale un archivo ya subido.
 *
 * Se prueba con fixtures y no contra la API porque es la parte que se equivoca
 * **en silencio**: un cuerpo mal armado no falla al compilar, falla cuando un
 * cliente real no recibe el video.
 */

const A = "50255512345";

describe("un archivo ya subido viaja por su id", () => {
  it("la foto va como imagen, con el id y nada más", () => {
    const body = buildMediaMessageBody({
      to: A,
      kind: "image",
      mediaId: "meta-123",
      filename: "antes-despues.jpg",
    });
    expect(body.type).toBe("image");
    expect(body.image).toEqual({ id: "meta-123" });
    expect(body.to).toBe(A);
  });

  it("el video va como video", () => {
    const body = buildMediaMessageBody({
      to: A,
      kind: "video",
      mediaId: "meta-456",
      filename: "testimonio.mp4",
    });
    expect(body.type).toBe("video");
    expect(body.video).toEqual({ id: "meta-456" });
  });

  it("el documento lleva el nombre con el que el cliente lo va a ver", () => {
    // Sin `filename`, WhatsApp le muestra al cliente el id de Meta como nombre
    // del archivo, y así es como se guarda en su teléfono.
    const body = buildMediaMessageBody({
      to: A,
      kind: "document",
      mediaId: "meta-789",
      filename: "ficha-producto.pdf",
    });
    expect(body.document).toEqual({
      id: "meta-789",
      filename: "ficha-producto.pdf",
    });
  });

  it("ningún archivo lleva pie de foto", () => {
    // El texto del vendedor sale como mensaje aparte, con su propio reintento y
    // su propia fila en el hilo. Repetirlo como pie de foto lo mandaría dos
    // veces cuando los dos salen, y a medias cuando uno de los dos falla.
    for (const kind of ["image", "video", "document"] as const) {
      const body = buildMediaMessageBody({
        to: A,
        kind,
        mediaId: "meta-1",
        filename: "x.bin",
      });
      expect(JSON.stringify(body)).not.toContain("caption");
    }
  });

  it("siempre dice que es de WhatsApp y a quién va", () => {
    const body = buildMediaMessageBody({
      to: A,
      kind: "image",
      mediaId: "meta-1",
      filename: "x.jpg",
    });
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.recipient_type).toBe("individual");
  });
});
