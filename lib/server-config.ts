export function requireEpicClientId(): string {
  const value = process.env.EPIC_CLIENT_ID;
  if (!value) throw new Error("EPIC_CLIENT_ID is not configured.");
  return value;
}

export function configuredEpicRedirectUri(): string | null {
  return process.env.EPIC_REDIRECT_URI ?? null;
}

export function epicScope(): string {
  return process.env.EPIC_SCOPE ?? "openid fhirUser launch/patient patient/*.rs";
}
