"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { DeidRecordView } from "@/app/deid-record-view";
import { StoragePassphraseForm } from "@/app/storage-passphrase-form";
import {
  getHealthStorageState,
  loadCurrentStudy,
  unlockHealthExport,
  updateStudyComments,
} from "@/lib/browser-storage";
import {
  generateStudy,
  type StudyProgressUpdate,
  type StudyStage,
} from "@/lib/study-pipeline";
import {
  STUDY_CATEGORY_LABELS,
  type StudyComment,
  type StudyRecord,
} from "@/lib/study";

const STAGE_COPY: Record<StudyStage, string> = {
  deidentifying:
    "De-identifying your record inside the confidential service. This can take several minutes.",
  summarizing: "Building the longitudinal study from the de-identified record…",
  saving: "Encrypting and saving the study in this browser…",
};

const STAGE_HEADINGS: Record<StudyStage, string> = {
  deidentifying: "De-identifying your record…",
  summarizing: "Building your study…",
  saving: "Saving your study…",
};

const JOB_STATUS_COPY: Record<string, string> = {
  queued: "Job queued — waiting for a worker",
  running: "Job running",
};

// Minimal markdown rendering for the study narrative (headings, lists,
// paragraphs). Dependency-free on purpose — the narrative is generated text,
// not arbitrary user HTML.
function renderNarrative(markdown: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  let paragraph: string[] = [];
  let key = 0;

  function flush() {
    if (list.length) {
      nodes.push(
        <ul key={key++}>
          {list.map((item, index) => <li key={index}>{item}</li>)}
        </ul>,
      );
      list = [];
    }
    if (paragraph.length) {
      nodes.push(<p key={key++}>{paragraph.join(" ")}</p>);
      paragraph = [];
    }
  }

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const text = heading[2]!;
      nodes.push(heading[1]!.length <= 2
        ? <h3 key={key++}>{text}</h3>
        : <h4 key={key++}>{text}</h4>);
    } else if (/^[-*]\s+/.test(trimmed)) {
      if (paragraph.length) flush();
      list.push(trimmed.replace(/^[-*]\s+/, ""));
    } else if (!trimmed) {
      flush();
    } else {
      if (list.length) flush();
      paragraph.push(trimmed);
    }
  }
  flush();
  return nodes;
}

function CommentList({
  comments,
  onRemove,
  busy,
}: {
  comments: StudyComment[];
  onRemove: (id: string) => void;
  busy: boolean;
}) {
  if (!comments.length) return null;
  return (
    <ul className="study-comments">
      {comments.map((comment) => (
        <li key={comment.id}>
          <p>{comment.text}</p>
          <span className="study-comment-meta">
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleString()}
            </time>
            <button
              className="text-button danger-button"
              type="button"
              onClick={() => onRemove(comment.id)}
              disabled={busy}
            >
              Remove
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function StudyClient() {
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [hasImport, setHasImport] = useState(false);
  const [record, setRecord] = useState<StudyRecord>();
  const [progress, setProgress] = useState<StudyProgressUpdate>();
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState<"study" | "deid" | "next">("study");
  const [error, setError] = useState<string>();
  const [savingComment, setSavingComment] = useState(false);
  const [commentTarget, setCommentTarget] = useState<number | "general">();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const storageState = await getHealthStorageState();
        if (storageState === "locked") {
          setLocked(true);
        } else if (storageState === "unlocked") {
          setHasImport(true);
          setRecord(await loadCurrentStudy());
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not open the stored study.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function unlock(passphrase: string) {
    setUnlocking(true);
    setError(undefined);
    try {
      await unlockHealthExport(passphrase);
      setHasImport(true);
      setRecord(await loadCurrentStudy());
      setLocked(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock the record.");
    } finally {
      setUnlocking(false);
    }
  }

  // Total seconds since this generation run started.
  const generationActive = Boolean(progress);
  useEffect(() => {
    if (!generationActive) return;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [generationActive]);

  async function generate() {
    setError(undefined);
    setProgress({ stage: "deidentifying" });
    try {
      setRecord(await generateStudy({ onProgress: setProgress }));
      setView("study");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate the study.");
    } finally {
      setProgress(undefined);
    }
  }

  async function saveComments(comments: StudyComment[]) {
    setSavingComment(true);
    setError(undefined);
    try {
      setRecord(await updateStudyComments(comments));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the comment.");
    } finally {
      setSavingComment(false);
    }
  }

  async function addComment() {
    if (!record || commentTarget === undefined || !draft.trim()) return;
    const comment: StudyComment = {
      id: crypto.randomUUID(),
      ...(commentTarget === "general" ? {} : { entryIndex: commentTarget }),
      text: draft.trim(),
      createdAt: new Date().toISOString(),
    };
    await saveComments([...record.comments, comment]);
    setDraft("");
    setCommentTarget(undefined);
  }

  async function removeComment(id: string) {
    if (!record) return;
    await saveComments(record.comments.filter((comment) => comment.id !== id));
  }

  if (loading) {
    return (
      <main className="explore-shell explore-empty">
        <div className="spinner" aria-hidden="true" />
        <p>Opening the study stored in this browser…</p>
      </main>
    );
  }

  if (locked) {
    return (
      <main className="explore-shell explore-empty">
        <section className="unlock-card">
          <p className="eyebrow">Encrypted local study</p>
          <h1>Unlock your health record.</h1>
          <p>
            The encryption key exists only in memory. Enter your storage passphrase
            to derive it again with Argon2id.
          </p>
          <StoragePassphraseForm mode="unlock" busy={unlocking} error={error} onSubmit={unlock} />
        </section>
      </main>
    );
  }

  if (!hasImport) {
    return (
      <main className="explore-shell explore-empty">
        <p className="eyebrow">Longitudinal study</p>
        <h1>No imported record yet.</h1>
        <p>{error ?? "Connect MyChart to import a record, then generate its longitudinal study."}</p>
        <Link className="button primary" href="/">Import from MyChart</Link>
      </main>
    );
  }

  if (progress) {
    const steps: { stage: StudyStage; label: string }[] = [
      { stage: "deidentifying", label: "De-identify" },
      { stage: "summarizing", label: "Longitudinal study" },
      { stage: "saving", label: "Save" },
    ];
    const activeIndex = steps.findIndex((step) => step.stage === progress.stage);
    return (
      <main className="explore-shell explore-empty" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p className="eyebrow">Generating your study</p>
        <h1>{STAGE_HEADINGS[progress.stage]}</h1>
        <p>{STAGE_COPY[progress.stage]}</p>
        <ol className="study-steps" aria-label="Pipeline steps">
          {steps.map((step, index) => (
            <li
              key={step.stage}
              className={
                index < activeIndex ? "done" : index === activeIndex ? "active" : ""
              }
            >
              {index < activeIndex ? "✓ " : ""}{step.label}
            </li>
          ))}
        </ol>
        <p className="study-job-status">
          {progress.jobStatus
            ? `${JOB_STATUS_COPY[progress.jobStatus] ?? progress.jobStatus} · `
            : "Submitting job · "}
          {elapsed}s elapsed · status checked every 3 seconds
        </p>
        {progress.deid ? <DeidRecordView deid={progress.deid} /> : null}
      </main>
    );
  }

  if (!record) {
    return (
      <main className="explore-shell explore-empty">
        <p className="eyebrow">Longitudinal study</p>
        <h1>No study yet.</h1>
        <p>
          Generate a de-identified longitudinal view of your imported record. Your record is
          de-identified inside the confidential service before any AI analysis, and the study is
          stored encrypted in this browser.
        </p>
        {error ? <div className="error" role="alert">{error}</div> : null}
        <button className="button primary" type="button" onClick={generate}>
          Generate longitudinal study
        </button>
      </main>
    );
  }

  const generalComments = record.comments.filter((comment) => comment.entryIndex === undefined);

  return (
    <main className="explore-shell study-shell">
      <section className="explore-heading">
        <div>
          <p className="eyebrow">Longitudinal study</p>
          <h1>Your health record over time.</h1>
          <p className="explore-meta">
            Generated{" "}
            <time dateTime={record.createdAt}>
              {new Date(record.createdAt).toLocaleString()}
            </time>
            {record.model && record.model !== "demo" ? ` · ${record.model}` : ""}
            {record.model === "demo"
              ? " · Demo response with fixed example dates."
              : " · Dates are anonymized: the earliest event is shown as 2000-01-01 and all other dates keep their true spacing."}
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="button secondary" type="button" onClick={generate}>
            Regenerate study
          </button>
          <Link className="button secondary" href="/explore">Explore raw record</Link>
        </div>
      </section>

      {error ? <div className="error" role="alert">{error}</div> : null}

      {record.deid ? (
        <div className="view-switcher study-view-switcher" role="tablist" aria-label="Study views">
          <button
            type="button"
            role="tab"
            aria-selected={view === "study"}
            className={view === "study" ? "active" : ""}
            onClick={() => setView("study")}
          >
            Longitudinal view
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "deid"}
            className={view === "deid" ? "active" : ""}
            onClick={() => setView("deid")}
          >
            De-identified record
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "next"}
            className={view === "next" ? "active" : ""}
            onClick={() => setView("next")}
          >
            Next step
          </button>
        </div>
      ) : null}

      {view === "next" ? (
        <section className="study-summary study-next-step" aria-label="Next step">
          <p className="eyebrow">Coming in the future</p>
          <h2>Understand what to do next.</h2>
          <p>
            One day, this space will use a dedicated model to help patients understand
            what may be happening in their health record and suggest practical actions
            they could discuss with their care team. The goal is to turn a complex
            longitudinal history into clear, personalized next steps—not to replace a
            clinician&apos;s judgment or provide emergency medical advice.
          </p>
          <div className="next-step-preview" aria-label="Future four-week action plan preview">
            <div className="next-step-preview-head">
              <span className="next-step-cadence">Every 4 weeks</span>
              <div>
                <h3>Your draft action plan</h3>
                <p>
                  The future model would review new symptoms, medications, coverage
                  decisions, labs, and scheduled care, then prioritize a short list of
                  actions for the next four weeks.
                </p>
              </div>
            </div>
            <div className="next-step-cycle" aria-label="Action plan cycle">
              <span><strong>1</strong> Review what changed</span>
              <span aria-hidden="true">→</span>
              <span><strong>2</strong> Explain why it matters</span>
              <span aria-hidden="true">→</span>
              <span><strong>3</strong> Propose next actions</span>
              <span aria-hidden="true">→</span>
              <span><strong>4</strong> Patient decides</span>
            </div>
            <ul className="next-step-actions">
              <li>
                <span className="next-step-action-type">Care team</span>
                <strong>Contact your clinician through MyChart</strong>
                <p>Draft the questions or symptom update worth sending to the care team.</p>
              </li>
              <li>
                <span className="next-step-action-type">Access</span>
                <strong>Follow up on medication coverage</strong>
                <p>Suggest contacting the insurer or asking the care team about a refill or authorization.</p>
              </li>
              <li>
                <span className="next-step-action-type">Medication</span>
                <strong>Review the medication plan</strong>
                <p>Flag adherence, side effects, or a possible adjustment to discuss with the prescribing clinician.</p>
              </li>
              <li>
                <span className="next-step-action-type">Procedure</span>
                <strong>Plan a colonoscopy</strong>
                <p>Surface when surveillance may be due and help prepare questions about scheduling.</p>
              </li>
              <li>
                <span className="next-step-action-type">Monitoring</span>
                <strong>Complete or ask about labs</strong>
                <p>Highlight ordered tests or routine monitoring that may need follow-up.</p>
              </li>
            </ul>
            <p className="next-step-boundary">
              The model would explain the evidence behind each suggestion and its
              urgency. It would not send messages, contact an insurer, schedule care,
              order tests, or change medication without the patient and care team.
            </p>
          </div>
        </section>
      ) : view === "deid" && record.deid ? (
        <DeidRecordView deid={record.deid} />
      ) : (
        <>
      <section className="study-summary" aria-label="Summary">
        <h2>Summary</h2>
        <p>{record.study.patient_summary}</p>
      </section>

      <section className="study-timeline" aria-label="Timeline">
        <h2>Timeline</h2>
        <ol>
          {record.study.timeline.map((entry, index) => {
            const entryComments = record.comments.filter(
              (comment) => comment.entryIndex === index,
            );
            return (
              <li key={index} className="study-entry">
                <div className="study-entry-head">
                  <time dateTime={entry.date}>{entry.date}</time>
                  <span className={`study-badge study-badge-${entry.category}`}>
                    {STUDY_CATEGORY_LABELS[entry.category] ?? entry.category}
                  </span>
                </div>
                <strong>{entry.title}</strong>
                {entry.detail ? <p>{entry.detail}</p> : null}
                <CommentList
                  comments={entryComments}
                  onRemove={removeComment}
                  busy={savingComment}
                />
                {commentTarget === index ? (
                  <div className="study-comment-form">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      rows={3}
                      placeholder="Is this event accurate? Anything missing or wrong?"
                      disabled={savingComment}
                      autoFocus
                    />
                    <div className="dashboard-actions">
                      <button
                        className="button primary"
                        type="button"
                        onClick={addComment}
                        disabled={savingComment || !draft.trim()}
                      >
                        {savingComment ? "Saving…" : "Save comment"}
                      </button>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => { setCommentTarget(undefined); setDraft(""); }}
                        disabled={savingComment}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => { setCommentTarget(index); setDraft(""); }}
                    disabled={savingComment}
                  >
                    Add comment
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="study-narrative" aria-label="Narrative">
        <h2>Narrative</h2>
        {renderNarrative(record.study.narrative_markdown)}
      </section>

      <section className="study-general-comments" aria-label="Your comments">
        <h2>Your comments</h2>
        <p className="auth-note">
          Comments stay encrypted in this browser alongside the study.
        </p>
        <CommentList comments={generalComments} onRemove={removeComment} busy={savingComment} />
        {commentTarget === "general" ? (
          <div className="study-comment-form">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Overall feedback on this study…"
              disabled={savingComment}
              autoFocus
            />
            <div className="dashboard-actions">
              <button
                className="button primary"
                type="button"
                onClick={addComment}
                disabled={savingComment || !draft.trim()}
              >
                {savingComment ? "Saving…" : "Save comment"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => { setCommentTarget(undefined); setDraft(""); }}
                disabled={savingComment}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="button secondary"
            type="button"
            onClick={() => { setCommentTarget("general"); setDraft(""); }}
            disabled={savingComment}
          >
            Add a general comment
          </button>
        )}
      </section>
        </>
      )}
    </main>
  );
}
