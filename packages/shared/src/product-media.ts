/**
 * Las reglas de los archivos enviables de un producto. **Todo esto es puro**:
 * no toca la base, ni la red, ni el reloj.
 *
 * Vive en `@wa/shared` y no en el panel por la misma razón que los otros
 * `*Input`: **el navegador rechaza antes de subir y la ruta rechaza antes de
 * escribir**, y las dos tienen que estar de acuerdo sobre qué se acepta. Dos
 * copias de esa respuesta se desincronizan en cuanto una se toque, y lo que
 * sale de esa desincronización es un archivo que el panel muestra enviable y
 * WhatsApp rechaza — o sea, el problema apareciendo cuando el admin ya no
 * puede resolverlo, que es exactamente lo que el ticket 02 prohíbe.
 *
 * El criterio del ticket, escrito una sola vez: **el rechazo por tamaño se
 * hace al subir, no al enviar**, «para que el problema aparezca cuando el admin
 * puede resolverlo» — recomprimiendo el video, que es algo que se hace sentado
 * frente al panel y no en medio de una conversación con un cliente.
 */

/**
 * Lo que la API de WhatsApp acepta, por tipo de archivo.
 *
 * **No es un solo número.** La forma decidida en el nivel 2 nombra 16 MB, que
 * es el límite del caso que usó de ejemplo —un video— y no el de todos los
 * tipos: una imagen corta mucho antes. Poner 16 MB para todo dejaría pasar un
 * JPG de 8 MB que el panel muestra enviable y que Meta rechaza en el momento
 * del envío, o sea el mismo error del ticket movido de lugar. Son límites de
 * Meta, no decisiones de este proyecto.
 */
export const WHATSAPP_MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
} as const;

export type MediaKind = keyof typeof WHATSAPP_MEDIA_LIMITS;

/**
 * Hasta dónde llega **la subida del panel**, que es un límite distinto y más
 * bajo que el de WhatsApp.
 *
 * `apps/web` corre en Vercel, y una función serverless de Vercel corta el
 * cuerpo de la petición en 4,5 MB. No es una decisión de este módulo ni algo
 * que se pueda subir desde acá: es dónde está alojado el panel. Un archivo por
 * encima de esto se rechaza **con su propio motivo**, distinto del de WhatsApp,
 * porque se arreglan distinto — uno recomprimiendo, el otro cambiando por dónde
 * viaja el archivo.
 *
 * **Es el techo real de hoy**: un video de 8 MB que WhatsApp aceptaría no se
 * puede subir por el panel todavía. El día que la subida vaya directo del
 * navegador al worker —que corre en Railway y no tiene este tope—, esta
 * constante desaparece y el único límite vuelve a ser el de WhatsApp.
 */
export const PANEL_UPLOAD_MAX_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * De qué tipo es un archivo, a los ojos de WhatsApp.
 *
 * Todo lo que no es imagen, video ni audio es documento, que es también como lo
 * trata la API: el PDF de la ficha, el instructivo y la hoja de cálculo de
 * márgenes internos viajan por el mismo camino.
 */
export function mediaKind(mime: string): MediaKind {
  const m = mime.trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

/** El límite de WhatsApp que le toca a este archivo. */
export function whatsappLimitBytes(mime: string): number {
  return WHATSAPP_MEDIA_LIMITS[mediaKind(mime)];
}

/**
 * Si este archivo **nunca** va a poder salir por WhatsApp.
 *
 * Es la pregunta que contesta el interruptor: un archivo que excede el límite
 * no se puede marcar enviable, y el camino de lectura lo vuelve a preguntar
 * antes de ofrecerlo. La segunda pregunta no sobra: el límite es de Meta y
 * puede bajar, y entonces filas que se guardaron enviables dejan de serlo sin
 * que nadie las toque.
 */
export function excedeLimiteDeWhatsapp(mime: string, byteSize: number): boolean {
  return byteSize > whatsappLimitBytes(mime);
}

/** Un tamaño como lo lee una persona: `480 KB`, `1,2 MB`, `27 MB`. */
export function formatoDeTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  // Con un decimal hasta 10 MB y entero de ahí en adelante: «1,2 MB» informa,
  // «27,0 MB» solo agrega un dígito. La coma es la decimal del idioma.
  const texto = mb < 10 ? mb.toFixed(1).replace(".", ",") : String(Math.round(mb));
  return `${texto} MB`;
}

/** Lo mínimo que hay que saber de un archivo para decidir si se acepta. */
export interface ArchivoPropuesto {
  filename: string;
  mime: string;
  byteSize: number;
}

/**
 * Por qué **no** se acepta este archivo, o `null` si se acepta.
 *
 * Los tres motivos están separados porque se resuelven distinto, y una sola
 * frase de «archivo inválido» le haría perder al admin el único momento en que
 * puede hacer algo al respecto.
 */
export type MotivoDeRechazo =
  /** Cero bytes: la subida se cortó, o el archivo estaba vacío. */
  | { motivo: "vacio"; texto: string }
  /** Excede lo que la API de WhatsApp acepta para su tipo. Se arregla recomprimiendo. */
  | { motivo: "excede_whatsapp"; texto: string; limiteBytes: number }
  /** Cabe en WhatsApp, pero no en la subida del panel. Se arregla en otro lado. */
  | { motivo: "excede_la_subida_del_panel"; texto: string; limiteBytes: number };

/**
 * El rechazo de un archivo al subirlo, con su motivo redactado.
 *
 * **El orden importa.** Un video de 27 MB excede los dos límites, y el que hay
 * que decirle al admin es el de WhatsApp: es el que significa «este archivo no
 * se puede enviar nunca», mientras que el del panel significa «este archivo no
 * se puede subir por acá hoy». Decirle el segundo lo mandaría a resolver el
 * problema equivocado.
 */
export function rechazoDeSubida(a: ArchivoPropuesto): MotivoDeRechazo | null {
  if (a.byteSize <= 0) {
    return { motivo: "vacio", texto: `${a.filename} está vacío: no se subió nada.` };
  }

  const limiteWa = whatsappLimitBytes(a.mime);
  if (a.byteSize > limiteWa) {
    return {
      motivo: "excede_whatsapp",
      limiteBytes: limiteWa,
      texto:
        `${a.filename} pesa ${formatoDeTamano(a.byteSize)} y excede el límite de ` +
        `WhatsApp para ${etiquetaDeTipo(a.mime)} (${formatoDeTamano(limiteWa)}): ` +
        `no se puede enviar, así que no se sube. Recomprimilo y volvé a intentarlo.`,
    };
  }

  if (a.byteSize > PANEL_UPLOAD_MAX_BYTES) {
    return {
      motivo: "excede_la_subida_del_panel",
      limiteBytes: PANEL_UPLOAD_MAX_BYTES,
      texto:
        `${a.filename} pesa ${formatoDeTamano(a.byteSize)}. WhatsApp lo aceptaría, ` +
        `pero la subida del panel corta en ${formatoDeTamano(PANEL_UPLOAD_MAX_BYTES)} ` +
        `— es un tope de donde está alojado el panel, no del archivo.`,
    };
  }

  return null;
}

/** Cómo se nombra un tipo de archivo en una frase dirigida a una persona. */
export function etiquetaDeTipo(mime: string): string {
  switch (mediaKind(mime)) {
    case "image":
      return "imágenes";
    case "video":
      return "videos";
    case "audio":
      return "audios";
    default:
      return "documentos";
  }
}

/** La extensión en mayúsculas para la insignia de la fila: `MP4`, `PDF`. */
export function etiquetaDeArchivo(filename: string, mime: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop() : "";
  if (ext && ext.length <= 4) return ext.toUpperCase();
  const sub = mime.split("/")[1] ?? mime;
  return sub.slice(0, 4).toUpperCase();
}

/** Lo mínimo que hace falta de un archivo ya guardado para decidir si sale. */
export interface ArchivoGuardado {
  mime: string;
  byteSize: number;
  sendable: boolean;
}

/**
 * Si este archivo le puede llegar al cliente.
 *
 * Las dos condiciones juntas y en un solo lugar: **marcado** y **dentro del
 * límite**. Es la función que decide, y por eso la usan tanto el interruptor de
 * la pantalla como el camino que arma lo que el vendedor manda: dos respuestas
 * a esta pregunta es cómo un archivo desmarcado termina saliendo igual.
 */
export function puedeEnviarse(a: ArchivoGuardado): boolean {
  return a.sendable && !excedeLimiteDeWhatsapp(a.mime, a.byteSize);
}

/**
 * Si el interruptor de este archivo se puede tocar, o está clavado en apagado.
 *
 * Un archivo que excede el límite no se marca: el interruptor queda
 * deshabilitado y la fila dice por qué. Hoy no debería existir ninguno —el
 * rechazo al subir los ataja antes—, pero el estado existe igual porque el
 * límite es de Meta: si baja, filas ya guardadas caen de este lado sin que
 * nadie las toque, y la pantalla tiene que poder explicarlo.
 */
export function interruptorHabilitado(a: Pick<ArchivoGuardado, "mime" | "byteSize">): boolean {
  return !excedeLimiteDeWhatsapp(a.mime, a.byteSize);
}

/**
 * El conteo de la cabecera: «2 de 4 enviables».
 *
 * Cuenta con {@link puedeEnviarse} y no con el interruptor a secas, porque lo
 * que el número tiene que decir es **cuántos archivos le van a llegar al
 * cliente**. Un archivo marcado que excede el límite no le llega, y contarlo
 * haría que la cabecera prometa más de lo que el producto manda.
 */
export function conteoDeEnviables(archivos: readonly ArchivoGuardado[]): {
  enviables: number;
  total: number;
  texto: string;
} {
  const enviables = archivos.filter(puedeEnviarse).length;
  return {
    enviables,
    total: archivos.length,
    texto: `${enviables} de ${archivos.length} enviables`,
  };
}
