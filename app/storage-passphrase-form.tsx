"use client";

import { useState, type FormEvent } from "react";

import { MIN_STORAGE_PASSPHRASE_LENGTH } from "@/lib/browser-encryption";

export function StoragePassphraseForm({
  mode,
  busy,
  error,
  onSubmit,
}: {
  mode: "create" | "unlock";
  busy: boolean;
  error: string | undefined;
  onSubmit: (passphrase: string) => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validationError, setValidationError] = useState<string>();
  const creating = mode === "create";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(undefined);
    if (passphrase.length < MIN_STORAGE_PASSPHRASE_LENGTH) {
      setValidationError(
        `Use at least ${MIN_STORAGE_PASSPHRASE_LENGTH} characters.`,
      );
      return;
    }
    if (creating && passphrase !== confirmation) {
      setValidationError("The passphrases do not match.");
      return;
    }
    await onSubmit(passphrase);
  }

  return (
    <form className="passphrase-form" onSubmit={submit}>
      <label htmlFor="storage-passphrase">
        <strong>{creating ? "Create a storage passphrase" : "Storage passphrase"}</strong>
        <small>
          {creating
            ? `Use ${MIN_STORAGE_PASSPHRASE_LENGTH} or more characters. You will need it whenever you reopen this record.`
            : "Enter the passphrase you created when importing this record."}
        </small>
      </label>
      <input
        id="storage-passphrase"
        type="password"
        minLength={MIN_STORAGE_PASSPHRASE_LENGTH}
        maxLength={1_024}
        autoComplete={creating ? "new-password" : "current-password"}
        value={passphrase}
        onChange={(event) => {
          setPassphrase(event.target.value);
          setValidationError(undefined);
        }}
        disabled={busy}
        autoFocus
        required
      />
      {creating ? (
        <>
          <label htmlFor="storage-passphrase-confirm">
            <strong>Confirm the passphrase</strong>
          </label>
          <input
            id="storage-passphrase-confirm"
            type="password"
            minLength={MIN_STORAGE_PASSPHRASE_LENGTH}
            maxLength={1_024}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setValidationError(undefined);
            }}
            disabled={busy}
            required
          />
        </>
      ) : null}
      <p className="passphrase-warning">
        The passphrase is never stored or sent anywhere. It cannot be recovered or reset.
      </p>
      {validationError || error ? (
        <div className="error compact-error" role="alert">
          {validationError ?? error}
        </div>
      ) : null}
      <button className="button primary" type="submit" disabled={busy}>
        {busy
          ? (creating ? "Creating encryption key…" : "Unlocking…")
          : (creating ? "Encrypt and import" : "Unlock record")}
      </button>
    </form>
  );
}
