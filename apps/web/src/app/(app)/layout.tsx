import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r bg-[var(--color-panel)] p-4">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[var(--color-text)]">
            WhatsApp Agent
          </h1>
          <p className="truncate text-xs text-[var(--color-text-dim)]">
            {session.user.email}
          </p>
        </div>

        <nav className="flex flex-1 flex-col gap-1 text-sm">
          <NavLink href="/inbox" label="Inbox" />
          <NavLink href="/templates" label="Plantillas" />
          <NavLink href="/agent" label="Agente" />
          <NavLink href="/connection" label="Conexión" />
        </nav>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="w-full rounded px-3 py-2 text-left text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-panel-2)]"
          >
            Cerrar sesión
          </button>
        </form>
      </aside>

      <main className="flex min-h-screen flex-col bg-[var(--color-bg)]">
        {children}
      </main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded px-3 py-2 text-[var(--color-text)] hover:bg-[var(--color-panel-2)]"
    >
      {label}
    </Link>
  );
}
