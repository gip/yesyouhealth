const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@yyc.health";

export default function TermsPage() {
  return (
    <main className="legal-page">
      <p className="eyebrow">Legal</p>
      <h1>Terms of Use</h1>
      <p className="legal-meta">Effective July 16, 2026</p>

      <section><h2>1. About YesYou Health</h2><p>YesYou Health provides tools that help patients understand actions taken and documented as part of their care. The service can help an eligible patient authorize retrieval of health information made available by a connected healthcare organization and download that information for personal use.</p></section>
      <section><h2>2. Agreement</h2><p>By using YesYou Health, you agree to these Terms and acknowledge our Privacy Notice. If you do not agree, do not use the service.</p></section>
      <section><h2>3. Eligibility and authority</h2><p>You may use the service only for your own health information or information you are legally authorized to access. You must not impersonate another person, bypass access controls, or retrieve records without valid permission.</p></section>
      <section><h2>4. Patient authorization</h2><p>Connections use the healthcare organization&apos;s authentication and authorization system. YesYou Health does not ask for or receive your MyChart password. You decide whether to authorize access and may manage connected applications through your healthcare organization.</p></section>
      <section><h2>5. Imported and exported information</h2><p>The service displays and exports information exposed by the healthcare organization&apos;s authorized FHIR APIs. The imported record is encrypted with a key derived from your passphrase and stored locally in your browser until you remove it. Your passphrase cannot be recovered or reset. The record may be incomplete, delayed, duplicated, or different from what appears in MyChart. Some documents, images, or records may not be included.</p></section>
      <section><h2>6. Not medical advice</h2><p>YesYou Health does not provide medical advice, diagnosis, treatment, utilization review, or emergency services. Do not rely on an export to make urgent or clinical decisions. Discuss questions with a qualified healthcare professional. In an emergency, contact local emergency services.</p></section>
      <section><h2>7. Your responsibilities</h2><p>Your downloaded export may contain sensitive health information and is not protected by the browser-storage passphrase. You are responsible for remembering and securing the passphrase and for securing the device, account, downloaded files, storage location, and people with whom you share them. You agree not to misuse, disrupt, reverse engineer, or attempt unauthorized access to the service or connected systems.</p></section>
      <section><h2>8. Availability and changes</h2><p>Connected organizations control their systems and data. YesYou Health may change, suspend, or discontinue functionality and cannot guarantee uninterrupted availability. We may update these Terms by publishing a revised effective date.</p></section>
      <section><h2>9. Disclaimers</h2><p>The service is provided on an “as is” and “as available” basis to the extent permitted by law. YesYou Health disclaims warranties of accuracy, completeness, fitness for a particular purpose, non-infringement, and uninterrupted operation.</p></section>
      <section><h2>10. Limitation of liability</h2><p>To the extent permitted by law, YesYou Health will not be liable for indirect, incidental, special, consequential, or punitive damages, loss of data, or decisions made based on exported information. Rights that cannot lawfully be limited remain unaffected.</p></section>
      <section><h2>11. Contact</h2><p>Questions about these Terms may be sent to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p></section>
    </main>
  );
}
