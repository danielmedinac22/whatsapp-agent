import { ConnectionPanel } from "./connection-panel";

export default function ConnectionPage() {
  return (
    <div className="app-page flex flex-1 flex-col gap-3">
      <header className="max-w-2xl">
        <h1 className="app-title">Conexión</h1>
        <p className="app-subtitle app-muted mt-1">Estado del dispositivo</p>
      </header>
      <ConnectionPanel />
    </div>
  );
}
