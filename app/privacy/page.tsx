const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@yyc.health";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <p className="eyebrow">Legal</p>
      <h1>Privacy Notice</h1>
      <p className="legal-meta">Effective July 16, 2026</p>

      <section><h2>Our approach</h2><p>YesYou Health is designed to minimize collection. The patient authenticates directly with the healthcare organization, and YesYou Health does not receive the patient&apos;s MyChart password.</p></section>
      <section><h2>Information processed</h2><p>When you begin an export, your browser temporarily stores OAuth state, a PKCE verifier, the selected healthcare organization, your clinical-note file preference, and the callback address in session storage. After authorization, the healthcare organization sends a short-lived authorization code to the callback page. Your browser exchanges that code directly for a short-lived access token and retrieves the authorized health information directly from the organization&apos;s FHIR APIs. If selected, this can include supported clinical-note files exposed as FHIR Binary resources.</p></section>
      <section><h2>How information is used</h2><p>The browser uses the information only to authenticate the requested connection, retrieve the authorized record, assemble the export locally, and let you explore or download it. The access token, patient identifier, and FHIR health records are not sent to YesYou Health&apos;s application server.</p></section>
      <section><h2>Retention</h2><p>The application does not intentionally persist OAuth tokens or exported health data in a server-side application database. The access token is held temporarily in browser memory and is not saved. Structured resources and selected clinical-note files are stored locally in your browser&apos;s IndexedDB. A staged import replaces the prior current import only after completion and remains until you select “Remove imported data,” clear this site&apos;s browser data, or the browser removes non-persistent data under storage pressure. OAuth state and PKCE information expire after ten minutes and are removed from session storage after the callback. Hosting, security, and network providers may process limited technical logs, including the request containing the short-lived callback code; the callback page removes that code from the address bar as soon as it loads.</p></section>
      <section><h2>Sharing</h2><p>YesYou Health does not sell exported health information. Authorized health information is transmitted directly from the healthcare organization to your browser. Hosting infrastructure serves the application and callback page but does not receive the access token or FHIR record through the application flow. We may disclose information we do possess when required by law or to protect the security and integrity of the service.</p></section>
      <section><h2>Your choices</h2><p>You may decline authorization, close the MyChart authorization screen, remove the imported record from the Explore page, delete downloaded exports, and revoke connected-app access through MyChart. Revocation does not delete browser-local or downloaded copies, so remove those separately.</p></section>
      <section><h2>Security</h2><p>The service uses OAuth state validation, PKCE, secure transport in production, restricted FHIR pagination and attachment URLs, bounded attachment sizes, omitted cross-origin credentials, and a no-referrer policy. Browser storage is isolated to this site but is not encrypted by the application. No system is completely secure, and you are responsible for protecting your browser, device, and downloaded files.</p></section>
      <section><h2>Contact</h2><p>Privacy questions may be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p></section>
    </main>
  );
}
