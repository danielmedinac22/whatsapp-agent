import { describe, expect, it } from "vitest";
import { capiNetworkSignal, classifyCapiFailure } from "./failure";

/** Un error de `fetch` como los arma Node: el de verdad viaja en `cause`. */
function fetchError(code: string): Error {
  const cause = Object.assign(new Error(`socket ${code}`), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

describe("classifyCapiFailure · lo que Meta no llegó a ver se reintenta", () => {
  it("una petición que nunca salió se reintenta", () => {
    // Meta no vio nada, así que no hay conversión que pueda haberse contado.
    const f = classifyCapiFailure({ kind: "not_sent", detail: "ECONNREFUSED" });
    expect(f.disposition).toBe("retry");
  });

  it("Meta saturada o caída se reintenta", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(classifyCapiFailure({ kind: "http", status }).disposition).toBe(
        "retry",
      );
    }
  });

  it("los códigos de límite de tasa de Meta se reintentan aunque vengan con 400", () => {
    // La trampa: Meta manda «bajá el ritmo» como un código dentro del cuerpo,
    // no como un 429. Leer solo el HTTP lo daría por rechazo definitivo y se
    // perdería una venta ya pagada en publicidad.
    for (const code of [1, 2, 4, 17, 32, 341, 613, 80004]) {
      const f = classifyCapiFailure({
        kind: "http",
        status: 400,
        error: { code, message: "rate limited" },
      });
      expect(f.disposition, `código ${code}`).toBe("retry");
    }
  });
});

describe("classifyCapiFailure · lo que Meta rechazó no mejora reintentando", () => {
  it("el token muerto y el permiso que falta llaman a una persona, no al reintento", () => {
    // 190 es el token vencido o revocado y 200/10/3 son permisos. Ninguno se
    // arregla esperando: `whatsapp_business_manage_events` no aparece solo.
    for (const code of [190, 200, 10, 3]) {
      const f = classifyCapiFailure({
        kind: "http",
        status: 400,
        error: { code, message: "permiso" },
      });
      expect(f.disposition, `código ${code}`).toBe("stop");
    }
  });

  it("un evento mal formado no se reintenta seis veces", () => {
    const f = classifyCapiFailure({
      kind: "http",
      status: 400,
      error: { code: 100, message: "Invalid parameter" },
    });
    expect(f.disposition).toBe("stop");
    expect(f.reason).toContain("Invalid parameter");
  });

  it("el motivo dice el código y el subcódigo, que es lo que se busca en la documentación", () => {
    const f = classifyCapiFailure({
      kind: "http",
      status: 400,
      error: { code: 190, error_subcode: 463, message: "Session expired" },
    });
    expect(f.reason).toContain("400");
    expect(f.reason).toContain("190");
    expect(f.reason).toContain("463");
  });
});

describe("classifyCapiFailure · lo que quizás llegó NO se reintenta", () => {
  // Es la decisión de fondo del módulo. Meta no deduplica este flujo: si
  // mandamos dos, cuentan dos, y el algoritmo aprende un ticket promedio falso
  // que no se revierte borrando datos (riesgo R7). Perder una conversión se
  // arregla; contarla dos veces, no.

  it("la petición salió y Meta no respondió queda en duda, no en reintento", () => {
    const f = classifyCapiFailure({ kind: "no_answer", detail: "timeout" });
    expect(f.disposition).toBe("unconfirmed");
    expect(f.reason).toContain("no se sabe");
  });

  it("un 200 con un cuerpo que no confirma nada queda en duda", () => {
    const f = classifyCapiFailure({ kind: "unreadable", detail: "html" });
    expect(f.disposition).toBe("unconfirmed");
  });
});

describe("capiNetworkSignal · el corte está en si la petición llegó a salir", () => {
  // La clasificación clásica —«red = temporal»— trata «no me pude conectar» y
  // «me colgué esperando la respuesta» como lo mismo. Con un destino que no
  // deduplica son opuestos: en el primero Meta no vio nada, en el segundo puede
  // tener el evento adentro.

  it("no llegar a conectarse significa que Meta no vio nada", () => {
    for (const code of [
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
      "CERT_HAS_EXPIRED",
    ]) {
      const signal = capiNetworkSignal(fetchError(code));
      expect(signal.kind, code).toBe("not_sent");
      expect(classifyCapiFailure(signal).disposition, code).toBe("retry");
    }
  });

  it("colgarse esperando la respuesta deja la conversión en duda", () => {
    for (const code of [
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ECONNRESET",
      "EPIPE",
      "ETIMEDOUT",
    ]) {
      const signal = capiNetworkSignal(fetchError(code));
      expect(signal.kind, code).toBe("no_answer");
      expect(classifyCapiFailure(signal).disposition, code).toBe("unconfirmed");
    }
  });

  it("nuestro propio tiempo agotado también deja la conversión en duda", () => {
    // `AbortSignal.timeout` no trae `code`: se reconoce por el nombre. Sin
    // esto, cortar a los quince segundos se leería como error desconocido — y
    // aun así caería en duda, que es la dirección segura, pero sin decir por qué.
    const abort = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    expect(capiNetworkSignal(abort).kind).toBe("no_answer");
  });

  it("el código se busca dentro de `cause`, que es donde `fetch` lo esconde", () => {
    // Sin desenvolver `cause`, TODO error de fetch se vería como
    // «TypeError: fetch failed» y un `ECONNREFUSED` perfectamente reintentable
    // quedaría en duda para siempre.
    const signal = capiNetworkSignal(fetchError("ECONNREFUSED"));
    expect(signal.kind).toBe("not_sent");
    if (signal.kind !== "not_sent") return;
    expect(signal.detail).toContain("ECONNREFUSED");
  });

  it("un error que no reconocemos queda en duda, no en reintento", () => {
    // Al revés de lo habitual, y a propósito: si no sabemos qué pasó, la
    // opción barata es perder una conversión.
    expect(capiNetworkSignal(new Error("vaya usted a saber")).kind).toBe(
      "no_answer",
    );
    expect(capiNetworkSignal("un string suelto").kind).toBe("no_answer");
    expect(capiNetworkSignal(fetchError("ALGO_NUEVO")).kind).toBe("no_answer");
  });

  it("una cadena de `cause` circular no cuelga la clasificación", () => {
    const a: { cause?: unknown; message: string } = { message: "a" };
    const b = { cause: a, message: "b" };
    a.cause = b;
    expect(capiNetworkSignal(a).kind).toBe("no_answer");
  });
});
