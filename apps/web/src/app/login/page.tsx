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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(110,231,183,0.08),transparent_35%),linear-gradient(180deg,rgba(244,193,109,0.05),transparent_32%)]" />
      <form
        action={action}
        className="app-card relative w-full max-w-sm space-y-4 p-5"
      >
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-[var(--color-text)]">
            WhatsApp Agent
          </h1>
          <p className="text-sm leading-5 text-[var(--color-text-dim)]">
            Inicia sesión para continuar.
          </p>
        </div>

        {sp.error && (
          <div className="rounded-md border border-red-500/30 bg-red-950/30 px-3 py-2 text-sm text-red-100">
            Email o contraseña incorrectos
          </div>
        )}

        <div className="space-y-2">
          <label className="block text-xs uppercase text-[var(--color-text-soft)]">
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
          <label className="block text-xs uppercase text-[var(--color-text-soft)]">
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
