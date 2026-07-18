import type { Metadata } from "next";
import Link from "next/link";

import "./globals.css";

export const metadata: Metadata = {
  title: "YesYou Health",
  description: "Understand the actions taken and documented as part of your care.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="YesYou Health home">
            <span className="brand-mark" aria-hidden="true">Y</span>
            <span>YesYou Health</span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/explore">Explore</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
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
