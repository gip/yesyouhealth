import type { DefaultSession } from "next-auth";

import type { UserRole } from "@/lib/server/validation";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole | null;
  }
}
