"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { HealthExportDocument } from "@/lib/browser-flow";
import { downloadHealthExport } from "@/lib/browser-download";
import {
  clearHealthExport,
  loadHealthAttachment,
  loadHealthExport,
} from "@/lib/browser-storage";
import {
  compactIdentifier,
  getResourceGroups,
  patientDisplayName,
  renderedFields,
  resourceTitle,
} from "@/lib/explore";

type DataView = "rendered" | "raw";
type AttachmentTextView = "plain" | "raw";

interface TextPreview {
  content: string;
  contentType: string;
  view: AttachmentTextView;
  title: string;
}

function htmlToPlainText(content: string): string {
  const document = new DOMParser().parseFromString(content, "text/html");
  document.querySelectorAll("script, style, template, noscript").forEach((element) => {
    element.remove();
  });
  document.querySelectorAll("br").forEach((element) => {
    element.replaceWith("\n");
  });
  document.querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article").forEach(
    (element) => {
      element.append("\n");
    },
  );
  return (document.body.textContent ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function TextModal({
  preview,
  onClose,
}: {
  preview: TextPreview;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-labelledby="file-text-title"
      className="raw-text-dialog"
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="raw-text-dialog-header">
        <div>
          <p className="resource-kicker">
            {preview.view === "raw" ? "Raw file text" : "Note text"}
          </p>
          <h2 id="file-text-title">{preview.title}</h2>
          <p>
            {preview.contentType} · {preview.view === "raw"
              ? "Decoded as UTF-8. Binary formats may include characters that are not human-readable."
              : "HTML tags and non-content elements have been removed for readability."}
          </p>
        </div>
        <button
          aria-label={preview.view === "raw" ? "Close raw text" : "Close note text"}
          className="raw-text-dialog-close"
          type="button"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <pre className="raw-text-content"><code>{preview.content}</code></pre>
      <div className="raw-text-dialog-footer">
        <button className="button secondary" type="button" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}

export function ExploreClient() {
  const [healthExport, setHealthExport] = useState<HealthExportDocument>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [resourceIndex, setResourceIndex] = useState(0);
  const [view, setView] = useState<DataView>("rendered");
  const [downloading, setDownloading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [attachmentTextLoading, setAttachmentTextLoading] = useState<AttachmentTextView>();
  const [textPreview, setTextPreview] = useState<TextPreview>();

  useEffect(() => {
    async function load() {
      try {
        const imported = await loadHealthExport();
        setHealthExport(imported);
      } catch (caught) {
        setLoadError(caught instanceof Error ? caught.message : "Could not open the imported record.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const groups = useMemo(
    () => healthExport ? getResourceGroups(healthExport) : [],
    [healthExport],
  );
  const activeGroup = groups.find((group) => group.key === selectedKey) ?? groups[0];
  const activeResource = activeGroup?.resources[resourceIndex] ?? activeGroup?.resources[0];
  const fields = activeResource ? renderedFields(activeResource) : [];
  const errorEntries = healthExport ? Object.entries(healthExport.errors) : [];

  async function download() {
    if (!healthExport) return;
    setDownloading(true);
    setLoadError(undefined);
    try {
      await downloadHealthExport(healthExport);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Could not prepare the download.");
    } finally {
      setDownloading(false);
    }
  }

  async function removeImportedData() {
    if (!window.confirm("Remove this imported health record from this browser?")) return;
    setRemoving(true);
    try {
      await clearHealthExport();
      setHealthExport(undefined);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Could not remove the imported record.");
    } finally {
      setRemoving(false);
    }
  }

  function selectGroup(key: string) {
    setSelectedKey(key);
    setResourceIndex(0);
  }

  async function viewAttachmentText(
    resource: Record<string, unknown>,
    textView: AttachmentTextView,
  ) {
    const key = typeof resource.key === "string" ? resource.key : undefined;
    if (!key) {
      setLoadError("The locally stored file could not be identified.");
      return;
    }

    setAttachmentTextLoading(textView);
    setLoadError(undefined);
    try {
      const attachment = await loadHealthAttachment(key);
      if (!attachment) throw new Error("The locally stored file could not be found.");
      const rawContent = await attachment.blob.text();
      setTextPreview({
        content: textView === "plain" ? htmlToPlainText(rawContent) : rawContent,
        contentType: attachment.contentType,
        title: compactIdentifier(attachment.binaryId) ?? attachment.binaryId,
        view: textView,
      });
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Could not open the file text.");
    } finally {
      setAttachmentTextLoading(undefined);
    }
  }

  if (loading) {
    return (
      <main className="explore-shell explore-empty">
        <div className="spinner" aria-hidden="true" />
        <p>Opening the record stored in this browser…</p>
      </main>
    );
  }

  if (!healthExport || !activeGroup || !activeResource) {
    return (
      <main className="explore-shell explore-empty">
        <p className="eyebrow">Record explorer</p>
        <h1>No imported record yet.</h1>
        <p>{loadError ?? "Connect MyChart to import a record directly into this browser."}</p>
        <Link className="button primary" href="/">Import from MyChart</Link>
      </main>
    );
  }

  const selectedPosition = Math.min(resourceIndex, activeGroup.resources.length - 1);
  const displayResource = activeGroup.resources[selectedPosition]!;

  return (
    <main className="explore-shell">
      <section className="explore-heading">
        <div>
          <p className="eyebrow">Your locally imported record</p>
          <h1>{patientDisplayName(healthExport)}</h1>
          <p className="explore-meta">
            From {healthExport.source.provider} · Imported{" "}
            <time dateTime={healthExport.exportedAt}>
              {new Date(healthExport.exportedAt).toLocaleString()}
            </time>
          </p>
        </div>
        <div className="explore-actions">
          <button className="button primary" type="button" onClick={download} disabled={downloading}>
            {downloading ? "Preparing…" : "Download export"}
          </button>
          <button className="text-button danger-button" type="button" onClick={removeImportedData} disabled={removing}>
            {removing ? "Removing…" : "Remove imported data"}
          </button>
        </div>
      </section>

      {loadError ? <div className="error" role="alert">{loadError}</div> : null}
      {errorEntries.length ? (
        <details className="import-warnings">
          <summary>{errorEntries.length} resource {errorEntries.length === 1 ? "type" : "types"} could not be imported</summary>
          <dl>
            {errorEntries.map(([resource, message]) => (
              <div key={resource}><dt>{resource}</dt><dd>{message}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}

      <div className="explore-layout">
        <aside className="explore-sidebar" aria-label="Imported resource types">
          <div className="sidebar-heading">
            <span>Data available</span>
            <strong>{groups.reduce((total, group) => total + group.resources.length, 0)}</strong>
          </div>
          <div className="resource-nav">
            {groups.map((group) => (
              <button
                className={group.key === activeGroup.key ? "active" : undefined}
                type="button"
                key={group.key}
                onClick={() => selectGroup(group.key)}
                aria-current={group.key === activeGroup.key ? "page" : undefined}
              >
                <span>{group.label}</span>
                <strong>{group.resources.length}</strong>
              </button>
            ))}
          </div>
          <p className="local-data-note">
            This record is stored only in this browser
            {healthExport.browserStorage?.persistent
              ? " with persistent-storage protection."
              : "; the browser may clear it under storage pressure."}
            {" "}Download a backup or remove it when you are finished.
          </p>
        </aside>

        <section className="resource-panel">
          <div className="resource-panel-top">
            <div>
              <p className="resource-kicker">{activeGroup.label}</p>
              <h2>{resourceTitle(displayResource, `${activeGroup.label} item`)}</h2>
            </div>
            <div className="resource-panel-actions">
              {typeof displayResource.key === "string" ? (
                <>
                  <button
                    className="raw-text-button"
                    type="button"
                    disabled={attachmentTextLoading !== undefined}
                    onClick={() => viewAttachmentText(displayResource, "raw")}
                  >
                    {attachmentTextLoading === "raw" ? "Opening…" : "View raw"}
                  </button>
                  <button
                    className="raw-text-button"
                    type="button"
                    disabled={attachmentTextLoading !== undefined}
                    onClick={() => viewAttachmentText(displayResource, "plain")}
                  >
                    {attachmentTextLoading === "plain" ? "Opening…" : "View text"}
                  </button>
                </>
              ) : null}
              <div className="view-switcher" role="tablist" aria-label="Data display">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "rendered"}
                  className={view === "rendered" ? "active" : undefined}
                  onClick={() => setView("rendered")}
                >
                  Rendered
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "raw"}
                  className={view === "raw" ? "active" : undefined}
                  onClick={() => setView("raw")}
                >
                  Raw JSON
                </button>
              </div>
            </div>
          </div>

          {activeGroup.resources.length > 1 ? (
            <div className="resource-pager" aria-label={`${activeGroup.label} item navigation`}>
              <button
                type="button"
                onClick={() => setResourceIndex(Math.max(0, selectedPosition - 1))}
                disabled={selectedPosition === 0}
              >
                Previous
              </button>
              <span>{selectedPosition + 1} of {activeGroup.resources.length}</span>
              <button
                type="button"
                onClick={() => setResourceIndex(Math.min(activeGroup.resources.length - 1, selectedPosition + 1))}
                disabled={selectedPosition === activeGroup.resources.length - 1}
              >
                Next
              </button>
            </div>
          ) : null}

          {view === "rendered" ? (
            <div className="rendered-resource" role="tabpanel">
              <p className="rendered-note">Formatted for readability. Use Raw JSON to inspect the source record.</p>
              {fields.length ? (
                <dl className="field-grid">
                  {fields.map((field, index) => (
                    <div key={`${field.label}-${index}`}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="no-rendered-fields">No common display fields were found. The complete resource is available in Raw JSON.</p>
              )}
            </div>
          ) : (
            <div className="raw-resource" role="tabpanel">
              <pre><code>{JSON.stringify(displayResource, null, 2)}</code></pre>
            </div>
          )}
        </section>
      </div>
      {textPreview ? (
        <TextModal preview={textPreview} onClose={() => setTextPreview(undefined)} />
      ) : null}
    </main>
  );
}
