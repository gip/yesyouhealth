import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

import { verifyPassword } from "@/lib/server/password";
import {
  createOAuthUser,
  DuplicateEmailError,
  findUserByAccount,
  findUserByEmail,
  findUserById,
  linkAccount,
} from "@/lib/server/users";
import type { UserRole } from "@/lib/server/validation";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Google,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        const user = await findUserByEmail(email);
        if (!user?.password_hash) return null;
        if (!(await verifyPassword(password, user.password_hash))) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      const providerAccountId = account.providerAccountId;
      const existing = await findUserByAccount("google", providerAccountId);
      if (existing) {
        user.id = existing.id;
        user.role = existing.role;
        return true;
      }

      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : null;
      if (!email) return false;
      const emailVerified = profile?.email_verified === true;

      const byEmail = await findUserByEmail(email);
      if (byEmail) {
        // Only link automatically when Google attests to the address.
        if (!emailVerified) return false;
        await linkAccount(byEmail.id, "google", providerAccountId);
        user.id = byEmail.id;
        user.role = byEmail.role;
        return true;
      }

      try {
        const created = await createOAuthUser({
          email,
          name: typeof profile?.name === "string" ? profile.name : null,
          image: typeof profile?.picture === "string" ? profile.picture : null,
          provider: "google",
          providerAccountId,
        });
        user.id = created.id;
        user.role = created.role;
        return true;
      } catch (error) {
        if (error instanceof DuplicateEmailError) return false;
        throw error;
      }
    },
    async jwt({ token, user }) {
      if (user) {
        if (user.id) token.sub = user.id;
        token.role = user.role ?? null;
        return token;
      }
      // A user who signed in before onboarding gains a role mid-session.
      if (token.role == null && typeof token.sub === "string") {
        const current = await findUserById(token.sub);
        token.role = current?.role ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.sub === "string") session.user.id = token.sub;
      session.user.role = (token.role as UserRole | null | undefined) ?? null;
      return session;
    },
  },
});
