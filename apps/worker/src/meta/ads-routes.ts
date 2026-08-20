import { Hono } from "hono";
import { setOperationMetaConfig } from "@wa/db";
import { panelOperation } from "../operations";
import { invalidateAdsCache, listOperationAds, ADS_TOKEN_ENV } from "./ads";

/**
 * La lista de anuncios que el catálogo usa para elegir por nombre.
 *
 * Vive en el worker por lo mismo que la búsqueda de productos de la tienda: el
 * token con `ads_read` está en el entorno del worker y **no sale de ahí**. El
 * navegador recibe nombres y estados, nunca la credencial.
 *
 * Los cuatro estados salen con `200` y un campo `account`. No es laxitud: la
 * cuenta sin conectar es un estado esperado —y va a volver a pasar solo el día
 * que revoquen el token—, y la pantalla tiene que poder ofrecer el campo a mano
 * en vez de mostrar un fallo que sugiera que no se puede registrar nada.
 */
export const metaAds = new Hono();

metaAds.get("/ads", async (c) => {
  return c.json(await listOperationAds(await panelOperation(c)));
});

/**
 * Qué tiene configurado de Meta la operación del riel.
 *
 * Devuelve **si hay token**, no el token. Es la distinción que hace útil la
 * pantalla: sin ella, «no salen anuncios» tiene dos causas —falta la cuenta o
 * falta la credencial— que se arreglan en lugares distintos, una en el panel y
 * la otra en el entorno del worker con un despliegue.
 */
metaAds.get("/config", async (c) => {
  const op = await panelOperation(c);
  return c.json({
    operation: op.countryCode,
    metaAdAccountId: op.metaAdAccountId,
    capiDatasetId: op.capiDatasetId,
    hasAdsToken: Boolean(process.env[ADS_TOKEN_ENV]?.trim()),
  });
});

metaAds.put("/config", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    metaAdAccountId?: string | null;
    capiDatasetId?: string | null;
  } | null;
  if (!body) return c.json({ error: "cuerpo inválido" }, 400);

  const adAccount = body.metaAdAccountId?.trim() || null;
  // Meta escribe siempre `act_<numero>`, y el error de pegar solo el número es
  // el más fácil de cometer y el más difícil de leer después: la Graph API
  // contesta un 400 genérico sobre un objeto que "no existe".
  if (adAccount && !/^act_\d+$/.test(adAccount)) {
    return c.json(
      { error: "la cuenta publicitaria se escribe como act_<número>" },
      400,
    );
  }
  const dataset = body.capiDatasetId?.trim() || null;
  if (dataset && !/^\d+$/.test(dataset)) {
    return c.json({ error: "el dataset es solo números" }, 400);
  }

  const op = await panelOperation(c);
  const updated = await setOperationMetaConfig(op.id, {
    metaAdAccountId: adAccount,
    capiDatasetId: dataset,
  });
  // La lista vieja es de la cuenta vieja: servirla después de cambiarla haría
  // que el admin registrara anuncios de la cuenta que acaba de reemplazar.
  invalidateAdsCache();
  return c.json({
    ok: true,
    metaAdAccountId: updated.metaAdAccountId,
    capiDatasetId: updated.capiDatasetId,
  });
});
