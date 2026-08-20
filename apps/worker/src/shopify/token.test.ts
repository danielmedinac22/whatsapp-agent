import { describe, expect, it } from "vitest";
import {
  RENEWAL_MARGIN_MS,
  credentialGapText,
  readMintResponse,
  stillUsable,
  storeCredential,
  type CredentialFields,
} from "./token";

const VACIA: CredentialFields = {
  shopDomain: null,
  adminAccessToken: null,
  clientId: null,
  clientSecret: null,
};

const TIENDA = { ...VACIA, shopDomain: "keuvhs-wt.myshopify.com" };

describe("storeCredential · con qué se le habla a la tienda", () => {
  it("sin dominio no hay a quién preguntarle, aunque sobren credenciales", () => {
    // El orden importa: una conexión a medio guardar con secreto y sin dominio
    // no puede salir a la red a ningún lado, y decir «falta la credencial»
    // mandaría al admin a buscar un token que ya tiene.
    const cred = storeCredential({
      ...VACIA,
      adminAccessToken: "shpat_lo-que-sea",
      clientId: "abc12345",
      clientSecret: "shpss_secreto",
    });
    expect(cred).toEqual({ kind: "none", reason: "no_domain" });
  });

  it("un token fijo se usa tal cual", () => {
    expect(
      storeCredential({ ...TIENDA, adminAccessToken: "shpat_fijo" }),
    ).toEqual({
      kind: "static",
      shopDomain: "keuvhs-wt.myshopify.com",
      token: "shpat_fijo",
    });
  });

  it("el par de la app se usa para acuñar", () => {
    expect(
      storeCredential({
        ...TIENDA,
        clientId: "55da1fc1",
        clientSecret: "shpss_secreto",
      }),
    ).toEqual({
      kind: "client_credentials",
      shopDomain: "keuvhs-wt.myshopify.com",
      clientId: "55da1fc1",
      clientSecret: "shpss_secreto",
    });
  });

  it("con las dos gana la fija: es la que alguien pegó a mano", () => {
    const cred = storeCredential({
      ...TIENDA,
      adminAccessToken: "shpat_fijo",
      clientId: "55da1fc1",
      clientSecret: "shpss_secreto",
    });
    expect(cred.kind).toBe("static");
  });

  it("medio par no es una credencial, y lo dice distinto que no tener ninguna", () => {
    // Los dos casos se arreglan distinto: uno es completar un formulario a
    // medio llenar, el otro es conectar la tienda por primera vez.
    expect(storeCredential({ ...TIENDA, clientId: "55da1fc1" })).toEqual({
      kind: "none",
      reason: "incomplete_client",
    });
    expect(
      storeCredential({ ...TIENDA, clientSecret: "shpss_secreto" }),
    ).toEqual({ kind: "none", reason: "incomplete_client" });
    expect(storeCredential(TIENDA)).toEqual({
      kind: "none",
      reason: "no_credential",
    });
  });

  it("los espacios no cuentan como credencial", () => {
    // Un campo pegado con un salto de línea de más se ve lleno y no lo está.
    expect(
      storeCredential({
        ...TIENDA,
        adminAccessToken: "   ",
        clientId: "\n",
        clientSecret: "  ",
      }),
    ).toEqual({ kind: "none", reason: "no_credential" });
  });

  it("cada motivo tiene su línea, y ninguna dice lo mismo", () => {
    const textos = (["no_domain", "no_credential", "incomplete_client"] as const)
      .map(credentialGapText);
    expect(new Set(textos).size).toBe(3);
  });
});

describe("readMintResponse · lo que devuelve el grant", () => {
  const AHORA = 1_700_000_000_000;

  it("lee el token, cuándo vence y qué permisos concede", () => {
    // La forma medida contra la tienda real el 19-ago-2026.
    const r = readMintResponse(
      {
        access_token: "shpat_89a602",
        scope: "write_customers,write_orders,read_products",
        expires_in: 86399,
      },
      AHORA,
    );
    expect(r).toEqual({
      ok: true,
      minted: {
        token: "shpat_89a602",
        expiresAt: AHORA + 86399 * 1000,
        scope: ["write_customers", "write_orders", "read_products"],
      },
    });
  });

  it("sin token no hay nada que usar", () => {
    expect(readMintResponse({ expires_in: 86399 }, AHORA)).toEqual({
      ok: false,
      error: "la respuesta no trae access_token",
    });
  });

  it("un token que no dice cuánto dura se rechaza, no se le supone una vida", () => {
    // Es la regla del archivo: suponerle vida larga a un token que no la
    // declaró es cómo se vuelve al `401` en medio de un cierre.
    for (const expires of [undefined, null, 0, -1, "no-es-un-numero"]) {
      expect(
        readMintResponse({ access_token: "shpat_x", expires_in: expires }, AHORA),
      ).toEqual({
        ok: false,
        error: "la respuesta no dice cuánto dura el token",
      });
    }
  });

  it("sin scope el token sigue sirviendo: los permisos se preguntan aparte", () => {
    const r = readMintResponse(
      { access_token: "shpat_x", expires_in: 100 },
      AHORA,
    );
    expect(r).toEqual({
      ok: true,
      minted: { token: "shpat_x", expiresAt: AHORA + 100_000, scope: [] },
    });
  });

  it("una respuesta vacía o basura no revienta", () => {
    for (const body of [null, undefined, "", 42, []]) {
      expect(readMintResponse(body, AHORA).ok).toBe(false);
    }
  });
});

describe("stillUsable · se renueva antes de vencer, no al fallar", () => {
  const AHORA = 1_700_000_000_000;
  const minted = (expiresAt: number) => ({ token: "t", expiresAt, scope: [] });

  it("un token con horas por delante sirve", () => {
    expect(stillUsable(minted(AHORA + 20 * 60 * 60 * 1000), AHORA)).toBe(true);
  });

  it("dentro del margen ya no sirve, aunque técnicamente no haya vencido", () => {
    // Ésta es la prueba que importa: el token TODAVÍA es válido para Shopify y
    // aun así se descarta. Reaccionar al vencimiento significa que el primer
    // cierre después del vencimiento ya falló.
    const casiVencido = AHORA + RENEWAL_MARGIN_MS - 1;
    expect(stillUsable(minted(casiVencido), AHORA)).toBe(false);
  });

  it("un token vencido no sirve", () => {
    expect(stillUsable(minted(AHORA - 1), AHORA)).toBe(false);
  });
});
