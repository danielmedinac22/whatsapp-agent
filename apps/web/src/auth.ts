import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { users, eq } from "@wa/db";
// El import es lo que mete `next-auth/jwt` en el programa; sin él TypeScript no
// encuentra el módulo que se aumenta más abajo y falla con TS2664.
// ESLint no ve ese uso —no mira la augmentación— y lo cuenta como muerto.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { JWT } from "next-auth/jwt";
import type { Role } from "@/access/resolve";

/**
 * El rol viaja en el JWT y de ahí sale a la sesión. Es {@link Role} —el tipo
 * del enum real— y no una unión escrita a mano: antes decía
 * `"admin" | "operator"` con casts, así que un usuario `sales` pasaba por aquí
 * con un tipo que mentía.
 *
 * Es opcional en los tres sitios porque de verdad puede faltar: un token
 * emitido antes de que la sesión llevara rol no trae ninguno, y decir que
 * siempre está sería la misma mentira en otro lugar. Quién alcanza qué con un
 * rol ausente lo decide `resolveAccess`, en un solo sitio.
 */
declare module "next-auth" {
  interface User {
    role?: Role;
  }
  interface Session {
    user: {
      id: string;
      role?: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
  }
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const authSecret =
  process.env.AUTH_SECRET ??
  (process.env.NODE_ENV !== "production"
    ? "local-dev-auth-secret-change-me"
    : undefined);

export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        if (!user) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? null,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id;
      if (token.role) session.user.role = token.role;
      return session;
    },
  },
});
