import { resolvePanelOperation } from "@/lib/operation";
import { loadCatalogView } from "@/lib/catalogo";
import { CatalogoClient } from "./catalogo-client";

export const dynamic = "force-dynamic";

/**
 * El catálogo de ventas de **una** operación: la del panel, que hasta el
 * selector es la única activa. `resolvePanelOperation()` y no la primera fila de
 * `products`: un catálogo sin operación declarada es cómo un producto
 * guatemalteco termina en la pantalla colombiana.
 */
export default async function CatalogoPage() {
  const view = await loadCatalogView(await resolvePanelOperation());

  return (
    <div className="app-page space-y-3">
      <header className="max-w-3xl">
        <p className="app-eyebrow">{view.operation.name} · catálogo</p>
        <h1 className="app-title">Productos</h1>
        <p className="app-subtitle app-muted mt-1">
          Los productos que el vendedor puede ofrecer y los anuncios con los que
          el reconocimiento los encuentra. El origen es una columna: lo que vive
          en la tienda se lee de ahí y no se edita acá.
        </p>
      </header>

      <CatalogoClient view={view} />
    </div>
  );
}
