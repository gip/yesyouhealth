import type { Metadata } from "next";
import Link from "next/link";

import { auth, signOut } from "@/auth";

import "./globals.css";

export const metadata: Metadata = {
  title: "YesYou Health",
  description: "Understand the actions taken and documented as part of your care.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="YesYou Health home">
            <span className="brand-mark" aria-hidden="true">Y</span>
            <span>YesYou Health</span>
          </Link>
          <nav aria-label="Primary navigation">
            {session?.user?.role === "patient" ? <Link href="/explore">Explore</Link> : null}
            <Link href="/literature">Literature</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            {session?.user ? (
              <>
                <Link href="/dashboard">Dashboard</Link>
                <form
                  className="signout-form"
                  action={async () => {
                    "use server";
                    await signOut({ redirectTo: "/" });
                  }}
                >
                  <button className="text-button" type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/signin">Sign in</Link>
            )}
          </nav>
        </header>
        {children}
        <footer>
          <span>© {new Date().getFullYear()} YesYou Health</span>
          <span>Patient-authorized. Read-only. Built for clarity.</span>
        </footer>
      </body>
    </html>
  );
}
