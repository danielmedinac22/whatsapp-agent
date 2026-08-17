import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  Cable,
  Inbox,
  LogOut,
  Package2,
  Shapes,
} from "lucide-react";
import { ConnectionIndicator } from "./connection-indicator";
import { resolveAccess } from "@/access/resolve";

/**
 * El menú entero. Cada entrada se muestra solo si el rol alcanza su ruta, y
 * quien lo decide es la misma función que el borde (`src/proxy.ts`): así el
 * menú no puede ofrecer una pantalla que rebota, ni esconder una que sí abre.
 *
 * Esconder el enlace **no es el control de acceso** —quien escribe la URL a
 * mano no pasa por aquí—; es solo no ofrecer una puerta cerrada.
 */
const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/templates", label: "Plantillas", icon: Shapes },
  { href: "/agent", label: "Agente", icon: Bot },
  { href: "/orders", label: "Pedidos", icon: Package2 },
  { href: "/connection", label: "Conexión", icon: Cable },
] as const;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const nav = NAV.filter(
    (item) => resolveAccess(session.user.role, item.href).allowed,
  );

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="relative mb-4 px-2">
          <h1 className="text-lg font-semibold text-[var(--color-text)]">
            WhatsApp Agent
          </h1>
          <p className="mt-1 truncate text-xs text-[var(--color-text-soft)]">
            {session.user.email}
          </p>
        </div>

        <div className="mb-2 px-2">
          <p className="text-xs font-medium text-[var(--color-text-soft)]">
            Navegación
          </p>
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1 text-sm lg:flex-col lg:overflow-visible">
          {nav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
            />
          ))}
        </nav>

        <div className="my-3">
          <ConnectionIndicator />
        </div>

        <form
          className="mt-auto"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="app-button-secondary w-full gap-2">
            <LogOut className="h-4 w-4" />
            Cerrar sesión
          </button>
        </form>
      </aside>

      <main className="app-main">
        <div className="border-b border-[var(--color-border)] px-4 py-2.5">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--color-text)]">
                Control center
              </p>
            </div>
            <div className="hidden h-7 items-center gap-2 rounded-md border border-[var(--color-border)] bg-[rgba(8,22,31,0.72)] px-2 text-xs text-[var(--color-text-dim)] md:flex">
              <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              Activo
            </div>
          </div>
        </div>

        <div>{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link href={href} className="app-nav-link group min-w-[156px] lg:min-w-0">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-dim)] transition group-hover:text-[var(--color-accent)]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1">{label}</span>
    </Link>
  );
}
