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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--color-bg)] p-4">
      <form
        action={action}
        className="app-card relative w-full max-w-sm space-y-4 p-5"
      >
        <div className="space-y-2">
          <h1 className="app-title text-[var(--color-text)]">
            WhatsApp Agent
          </h1>
          <p className="text-sm leading-5 text-[var(--color-text-dim)]">
            Inicia sesión para continuar.
          </p>
        </div>

        {sp.error && (
          <div className="rounded-md border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[var(--state-escalada-bg)] px-3 py-2 text-sm text-[var(--state-escalada-fg)]">
            Email o contraseña incorrectos
          </div>
        )}

        <div className="space-y-2">
          <label className="app-label block">
            Email
          </label>
          <input
            name="email"
            type="email"
            required
            className="app-input"
          />
        </div>

        <div className="space-y-2">
          <label className="app-label block">
            Contraseña
          </label>
          <input
            name="password"
            type="password"
            required
            className="app-input"
          />
        </div>

        <button
          type="submit"
          className="app-button w-full"
        >
          Entrar
        </button>
      </form>
    </div>
  );
}
