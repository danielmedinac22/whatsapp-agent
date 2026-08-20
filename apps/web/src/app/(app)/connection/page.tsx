import { resolvePanelOperation } from "@/lib/operation";
import { ContextLine } from "../context-line";
import { ConnectionPanel } from "./connection-panel";
import { ShopifyPanel } from "./shopify-panel";
import { DropiPanel } from "./dropi-panel";
import { MetaPanel } from "./meta-panel";

export const dynamic = "force-dynamic";

/**
 * **Pasa a `async` por la línea de contexto**, y era la única de las siete que
 * no sabía sobre qué operación estaba. No es un costo nuevo: los cuatro paneles
 * que cuelgan de acá ya leen la conexión de la operación del panel, y
 * `resolvePanelOperation()` resuelve contra la caché de operaciones que el marco
 * acaba de llenar en esta misma request. Lo que agrega es la lectura de una
 * cookie.
 *
 * Y es la pantalla donde más falta hacía: lo que se conecta acá —el número de
 * WhatsApp, la tienda, la logística— es de **un** país, y hasta hoy la pantalla
 * no decía cuál.
 */
export default async function ConnectionPage() {
  const op = await resolvePanelOperation();

  return (
    <div className="app-page flex flex-1 flex-col gap-6">
      <header className="max-w-2xl">
        <ContextLine op={op} pantalla="Operación" />
        <h1 className="app-title">Conexión</h1>
        <p className="app-subtitle app-muted mt-1">
          WhatsApp, Shopify, Meta y Dropi para tu workspace
        </p>
      </header>
      <ConnectionPanel />
      <ShopifyPanel />
      <MetaPanel />
      <DropiPanel />
    </div>
  );
}
