import { ConnectionPanel } from "./connection-panel";
import { ShopifyPanel } from "./shopify-panel";

export default function ConnectionPage() {
  return (
    <div className="app-page flex flex-1 flex-col gap-6">
      <header className="max-w-2xl">
        <h1 className="app-title">Conexión</h1>
        <p className="app-subtitle app-muted mt-1">
          WhatsApp y Shopify para tu workspace
        </p>
      </header>
      <ConnectionPanel />
      <ShopifyPanel />
    </div>
  );
}
