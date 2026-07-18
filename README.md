# YesYou Health

YesYou Health is a Vercel-ready Next.js application that lets a patient select a supported healthcare organization, authorize access to an Epic/MyChart record, and download the health data exposed by that organization. UCSF Health is selected by default, and Sutter Health is also available.

The data flow is browser-only:

1. The browser discovers the healthcare organization&apos;s SMART endpoints, creates OAuth state and an S256 PKCE pair, and redirects to MyChart.
2. The patient signs in at the healthcare organization and approves read-only access.
3. The organization redirects to the static `/callback` page with a short-lived authorization code.
4. The browser validates state, exchanges the code using PKCE, and retrieves the authorized FHIR record directly from the organization.
5. After authorization, the patient creates a storage passphrase. The browser derives a 256-bit key with Argon2id and encrypts every FHIR resource and selected clinical-note file with AES-GCM before writing ciphertext to IndexedDB. After the staged import completes, it becomes the current local record and `/explore` opens. The patient can review rendered fields, inspect raw FHIR JSON, download a decrypted export, lock the record, or remove it. The access token, passphrase, encryption key, and health records do not pass through the YesYou Health application server.

## Epic on FHIR configuration

Configure the patient-facing Epic app as follows:

- FHIR version: R4
- SMART scope version: SMART v2
- Audience: Patients
- Automatic client distribution: USCDI v3
- Confidential client: No, for the default public PKCE configuration
- Dynamic clients: No
- Redirect/Endpoint URI locally: `http://localhost:3000/callback`
- Redirect/Endpoint URI in production: `https://YOUR_DOMAIN/callback`

Select the R4 read/search APIs used in `lib/epic.ts`, especially:

- Patient.Read (Demographics)
- ExplanationOfBenefit.Search (Prior Auth)
- AllergyIntolerance.Search (Patient Chart)
- Appointment.Search variants for appointments and scheduled surgeries
- CareTeam.Search (Longitudinal CareTeam)
- Condition.Search variants needed for the patient chart
- Coverage.Search (Patient Insurance Information)
- DeviceUseStatement.Search
- DiagnosticReport.Search (Results)
- DocumentReference.Search (Clinical Notes)
- Binary.Read (Clinical Notes), if clinical-note files should be imported
- Encounter.Search (Patient Chart)
- FamilyMemberHistory.Search
- Goal.Search (Patient)
- Immunization.Search (Patient Chart)
- MedicationDispense.Search (Fill Status)
- MedicationRequest.Search (Signed Medication Order)
- Observation.Search variants for labs, vitals, and social history
- Procedure.Search variants for orders and surgeries
- QuestionnaireResponse.Search (Patient-Entered Questionnaires)
- ServiceRequest.Search (Orders)

The exporter sends Epic's required search filters: longitudinal CarePlans use
category `38717003`, while Observations are fetched and merged across the
`laboratory`, `vital-signs`, and `social-history` categories.

Prior authorization data is optional because it is exposed through a separately
enabled Epic API. If an import reports that the client is not authorized for
`ExplanationOfBenefit - Prior Auth`, enable **ExplanationOfBenefit.Search (Prior
Auth)** for that client in Epic on FHIR and then perform a new import. A SMART
scope alone cannot grant access to an API that is not enabled in the client
registration.

The public documentation URL can point to the deployed home page. Terms are at `/terms` and the privacy notice is at `/privacy`.

## Local setup

Requires Node.js 20.9 or newer.

```bash
pnpm install
cp .env.example .env.local
```

Set the non-production Epic client ID in `.env.local`, then run:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Development includes Epic Sandbox as an additional organization choice and labels it as synthetic test data. UCSF remains selected by default.

## Healthcare organization registry

Supported organizations are allowlisted in `lib/providers.ts`. Each profile
contains the organization-facing name, portal name, FHIR R4 base URL, adapter,
environment, capabilities, and optional OAuth client ID or scope overrides.
The shared `EPIC_CLIENT_ID` and `EPIC_SCOPE` values are used when a profile does
not override them.

When adding or changing a production profile:

1. Confirm the patient-facing R4 base URL with the organization or Epic's
   production endpoint directory.
2. Verify SMART discovery plus browser CORS for discovery, token exchange, and
   authorized FHIR requests.
3. Configure capability flags for optional attachments and prior authorization
   searches.
4. Increment `PROVIDER_REGISTRY_VERSION`. OAuth transactions created against an
   older registry will then safely restart instead of changing organizations
   mid-authorization.

## Verify

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Convert a FHIR export to Markdown

The included TypeScript CLI accepts plain or gzip-compressed JSON containing a
FHIR Bundle, a single FHIR resource, an array of resources, or a YesYou grouped
export. It writes a concise Markdown record with a table of contents, patient
name and date of birth shown exactly once, and a reverse-chronological clinical
record. Resources linked to an
encounter are nested beneath that encounter; the remaining records are grouped
by clinical category and date of service. Notes, AVS/encounter summaries, and
other document attachments are included when their payloads are embedded in the
input, or clearly marked as referenced but unavailable. Resource metadata,
identifiers, patient references, empty values, and duplicate resources are not
included.

```bash
pnpm fhir:markdown -- patient-export.json patient-summary.md
```

For a `.json.gz` input, the default output removes both extensions:

```bash
pnpm fhir:markdown -- patient-export.json.gz
# Writes patient-export.md
```

The output path defaults to the input filename with a `.md` extension. Standard
input and a custom document title are also supported:

```bash
cat patient-export.json | pnpm fhir:markdown -- - patient-summary.md --title "Clinical Summary"
```

## Vercel configuration

Do not commit secrets. Add these environment variables in Vercel:

```text
EPIC_CLIENT_ID=your-production-client-id
EPIC_REDIRECT_URI=https://YOUR_DOMAIN/callback
EPIC_SCOPE=openid fhirUser launch/patient patient/*.read
NEXT_PUBLIC_SUPPORT_EMAIL=your-support-address
```

The client ID is a public identifier and is embedded in the browser application. Do not configure `EPIC_CLIENT_SECRET`: this implementation is a public PKCE client, and browser code cannot keep a client secret confidential.

After establishing the final Vercel domain, register the exact production callback with Epic before marking the client Ready. Preview deployment domains will not work unless each preview callback URI is separately registered.

The selected healthcare organization must permit browser cross-origin requests to its SMART discovery, token, and FHIR endpoints. UCSF and the Epic sandbox currently allow the required origins, methods, and `Authorization`/`Content-Type` headers. The application explicitly omits cross-origin cookies and other credentials from these requests.

## Data handling and limitations

- The Explore page creates a `.json.gz` download on request. Stored Binary files are encoded into FHIR Binary resources only while preparing that download. Browsers without the standard `CompressionStream` API receive an uncompressed `.json` file instead.
- The export includes raw FHIR resources and may contain highly sensitive health information.
- OAuth state and the PKCE verifier are kept in browser session storage for at most ten minutes and removed on callback.
- The access token is processed only in browser memory and is never saved. A new encrypted import is staged under a unique ID and replaces the previous import only after it completes successfully.
- The storage passphrase must contain at least 12 characters. It is normalized with NFKC and passed to Argon2id with a unique 16-byte salt, 19 MiB of memory, two iterations, and one lane to derive a 256-bit AES key. The passphrase is never stored and the non-extractable key exists only in browser memory.
- Structured resources, document metadata, errors, attachment metadata, and attachment bytes are authenticated and encrypted with AES-256-GCM using a fresh 96-bit IV and record-specific additional authenticated data. IndexedDB contains only ciphertext plus the non-secret key-derivation parameters, random record identifiers, completion state, and the current-record pointer.
- Database schema upgrades delete records created by older plaintext-storage versions. They are not migrated or opened.
- Optional clinical-note files retain a 10 MB per-file limit, 50 MB aggregate limit, and a supported HTML, text, RTF, PDF, or image content type before encryption.
- The app checks the browser's estimated quota and requests persistent storage. The browser may deny that request or remove non-persistent data under storage pressure, and users can always clear site data.
- Downloaded `.json` and `.json.gz` exports are decrypted files and are not protected by the browser-storage passphrase.
- The callback removes the authorization code from the address bar immediately and the site sends `Referrer-Policy: no-referrer`. The initial callback page request still reaches the hosting provider and may appear in limited technical logs.
- FHIR pagination is restricted to the configured provider origin and API base.
- Binary URLs must remain inside the configured FHIR base and identify a direct `Binary/{id}` resource. Imported HTML is stored but never injected into the application page.
- Do not add analytics, session replay, third-party scripts, or client-side error reporting to the authorization/export pages without a privacy and security review.
- The legal copy is a product-ready starting point, not legal advice. Have counsel review the Terms and Privacy Notice before handling production health data.
