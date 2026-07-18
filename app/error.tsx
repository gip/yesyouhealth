"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="callback-page">
      <section className="callback-card" role="alert">
        <p className="eyebrow">Unexpected error</p>
        <h1>Something went wrong.</h1>
        <p className="callback-detail">
          An unexpected error interrupted this page. Your data is unaffected. Try again, or return
          to the home page.
        </p>
        <div className="error-actions">
          <button className="button primary" type="button" onClick={reset}>Try again</button>
          <a className="button secondary" href="/">Return home</a>
        </div>
      </section>
    </main>
  );
}
