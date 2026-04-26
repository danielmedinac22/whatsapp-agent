import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { AuthError } from "next-auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const session = await auth();
  const sp = await searchParams;
  if (session) redirect(sp.from ?? "/inbox");

  async function action(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/inbox",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        redirect(`/login?error=invalid`);
      }
      throw e;
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
      <form
        action={action}
        className="w-full max-w-sm space-y-4 rounded-lg bg-[var(--color-panel)] p-8 shadow-xl border"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">
            WhatsApp Agent
          </h1>
          <p className="text-sm text-[var(--color-text-dim)]">
            Inicia sesión para continuar
          </p>
        </div>

        {sp.error && (
          <div className="rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">
            Email o contraseña incorrectos
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-text-dim)]">
            Email
          </label>
          <input
            name="email"
            type="email"
            required
            className="w-full rounded border bg-[var(--color-panel-2)] px-3 py-2 text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-text-dim)]">
            Contraseña
          </label>
          <input
            name="password"
            type="password"
            required
            className="w-full rounded border bg-[var(--color-panel-2)] px-3 py-2 text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
