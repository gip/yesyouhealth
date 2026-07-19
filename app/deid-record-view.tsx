"use client";

import { useMemo, useState, type SyntheticEvent } from "react";

import type { DeidRecordResult } from "@/lib/study";

function resourcesByType(resource: unknown): [string, object[]][] {
  const map = new Map<string, object[]>();
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return [];

  const document = resource as {
    data?: Record<string, unknown>;
    entry?: unknown[];
    priorAuthorizations?: unknown[];
  };

  for (const entryValue of Array.isArray(document.entry) ? document.entry : []) {
    const entryResource = (entryValue as { resource?: unknown } | null)?.resource;
    if (!entryResource || typeof entryResource !== "object") continue;
    const type = String(
      (entryResource as { resourceType?: unknown }).resourceType ?? "Other",
    );
    map.set(type, [...(map.get(type) ?? []), entryResource]);
  }

  for (const [type, value] of Object.entries(document.data ?? {})) {
    const resources = (Array.isArray(value) ? value : [value]).filter(
      (item): item is object => Boolean(item) && typeof item === "object",
    );
    if (resources.length) map.set(type, [...(map.get(type) ?? []), ...resources]);
  }

  const priorAuthorizations = (document.priorAuthorizations ?? []).filter(
    (item): item is object => Boolean(item) && typeof item === "object",
  );
  if (priorAuthorizations.length) {
    map.set("PriorAuthorization", [
      ...(map.get("PriorAuthorization") ?? []),
      ...priorAuthorizations,
    ]);
  }

  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function DeidRecordView({ deid }: { deid: DeidRecordResult }) {
  const groups = useMemo(() => resourcesByType(deid.resource), [deid]);

  return (
    <section className="study-summary deid-record" aria-label="De-identified record">
      <h2>De-identified record</h2>
      <p className="auth-note">
        {deid.engine === "demo"
          ? "This is the bundled de-identified demo record used to build the study."
          : "This is the version of your record produced by the de-identification service — names, birth dates, and other identifying details are replaced with realistic surrogates, and this is what the AI study was built from."}
      </p>
      {groups.length ? (
        groups.map(([type, resources]) => (
          <DeidResourceGroup key={type} type={type} resources={resources} />
        ))
      ) : (
        <pre className="deid-json"><code>{JSON.stringify(deid.resource, null, 2)}</code></pre>
      )}
    </section>
  );
}

function DeidResourceGroup({
  type,
  resources,
}: {
  type: string;
  resources: object[];
}) {
  const [open, setOpen] = useState(type === "Patient");

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    setOpen(event.currentTarget.open);
  }

  return (
    <details className="deid-group" open={open} onToggle={onToggle}>
      <summary>
        {type}
        <span className="deid-count">{resources.length}</span>
      </summary>
      {open
        ? resources.map((resource, index) => (
            <pre key={index} className="deid-json"><code>
              {JSON.stringify(resource, null, 2)}
            </code></pre>
          ))
        : null}
    </details>
  );
}
