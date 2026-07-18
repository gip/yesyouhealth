import type { Metadata } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";

import { auth, signOut } from "@/auth";
import { MobileNav } from "@/app/mobile-nav";

import "./globals.css";

const fontBody = Inter({ subsets: ["latin"], display: "swap", variable: "--font-body" });
const fontDisplay = Newsreader({
  subsets: ["latin"],
  display: "swap",
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-display",
});
const fontMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "YesYou Health",
  description: "Understand the actions taken and documented as part of your care.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  return (
    <html lang="en" className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`}>
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="YesYou Health home">
            <span className="brand-mark" aria-hidden="true">Y</span>
            <span>YesYou Health</span>
          </Link>
          <MobileNav>
            {session?.user?.role === "doctor" ? null : <Link href="/explore">Explore</Link>}
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
          </MobileNav>
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
