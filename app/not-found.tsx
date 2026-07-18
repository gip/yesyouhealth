import Link from "next/link";

export default function NotFound() {
  return (
    <main className="explore-shell">
      <div className="explore-empty">
        <p className="eyebrow">Page not found</p>
        <h1>There&apos;s nothing at this address.</h1>
        <p>Check the link you followed, or head back to the home page.</p>
        <Link className="button primary" href="/">Return home</Link>
      </div>
    </main>
  );
}
