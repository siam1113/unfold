import { useEffect, useState } from "react";
import {
  KeyRound,
  X,
  Loader2,
  CheckCircle2,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import type { AuthCapture } from "../../../packages/shared/src/index";
import "./flow-auth-capture-views.css";

// Server contract (apps/server/src/index.ts):
//   POST   /api/projects/:id/auth-captures                      -> AuthCapture (status "open" or "failed")
//   GET    /api/projects/:id/auth-captures                       -> AuthCapture[]
//   POST   /api/projects/:id/auth-captures/:captureId/finish     -> AuthCapture (status "captured")
//   POST   /api/projects/:id/auth-captures/:captureId/cancel     -> AuthCapture (status "cancelled")
//   DELETE /api/projects/:id/auth-captures/:captureId            -> 204
const apiRequest = async <T,>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> => {
  const res = await fetch(
    "/api" + path,
    method === "GET"
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
  );
  if (res.status === 204) return undefined as T;
  const value = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The open-capture route returns 502 with the full AuthCapture record
    // (status "failed", lastError set) rather than a plain {error} body, so
    // the caller can still inspect created.status — but fall back to
    // lastError here too, or that detail never reaches the user.
    const payload = value as { error?: string; lastError?: string };
    throw new Error(payload.error || payload.lastError || "Request failed");
  }
  return value as T;
};

const relativeTime = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export function AuthCaptureWizard({
  projectId,
  projectUrl,
  onCaptured,
  onClose,
}: {
  projectId: string;
  projectUrl: string;
  onCaptured: (capture: AuthCapture) => void;
  onClose: () => void;
}) {
  const [capture, setCapture] = useState<AuthCapture>();
  const [opening, setOpening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  const basePath = `/projects/${projectId}/auth-captures`;

  const open = async () => {
    setOpening(true);
    setError("");
    try {
      const created = await apiRequest<AuthCapture>(basePath, {});
      setCapture(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  };

  const finish = async () => {
    if (!capture) return;
    setFinishing(true);
    setError("");
    try {
      const done = await apiRequest<AuthCapture>(
        `${basePath}/${capture.id}/finish`,
      );
      setCapture(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFinishing(false);
    }
  };

  const cancel = async () => {
    if (!capture) return onClose();
    setCancelling(true);
    try {
      await apiRequest(`${basePath}/${capture.id}/cancel`, {});
    } catch {
      // Best-effort — close the wizard regardless.
    } finally {
      setCancelling(false);
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && capture?.status !== "open")
          onClose();
      }}
    >
      <section
        className="scan-modal auth-capture-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-capture-title"
      >
        <div className="modal-heading">
          <span className="modal-icon">
            <KeyRound size={24} />
          </span>
          {capture?.status !== "open" && (
            <button
              className="icon-button"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          )}
        </div>
        <h2 id="auth-capture-title">Capture a login session</h2>

        {!capture && (
          <>
            <p>
              We'll open a fresh, private browser window on this machine so you
              can log into <strong>{projectUrl}</strong> yourself. Nothing you
              type is seen by Unfold or any AI — once you're done, we save only
              the resulting cookies, stored locally in this workspace, and
              discovery runs can reuse them to browse pages that need you to be
              signed in.
            </p>
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                onClick={open}
                disabled={opening}
              >
                {opening ? (
                  <Loader2 size={15} className="flow-cap-spin" />
                ) : (
                  <KeyRound size={15} />
                )}
                {opening ? "Opening…" : "Open browser window"}
              </button>
            </div>
          </>
        )}

        {capture?.status === "open" && (
          <>
            <p>
              A browser window should now be open on your screen, pointed at{" "}
              <strong>{projectUrl}</strong>. Log in there, then come back here.
            </p>
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                onClick={cancel}
                disabled={cancelling || finishing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                onClick={finish}
                disabled={finishing || cancelling}
              >
                {finishing ? (
                  <Loader2 size={15} className="flow-cap-spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                {finishing ? "Saving…" : "I'm logged in — save this session"}
              </button>
            </div>
          </>
        )}

        {capture?.status === "captured" && (
          <>
            <div className="auth-capture-summary">
              <ShieldCheck size={18} />
              <div>
                <strong>Session captured</strong>
                <p>
                  {capture.cookieCount ?? 0} cookie
                  {capture.cookieCount === 1 ? "" : "s"} for{" "}
                  {capture.domains?.join(", ") || "this app"} ·{" "}
                  {capture.capturedAt ? relativeTime(capture.capturedAt) : ""}
                </p>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => onCaptured(capture)}
              >
                Use this session
              </button>
            </div>
          </>
        )}

        {(capture?.status === "failed" || capture?.status === "cancelled") && (
          <>
            {error && <div className="error-banner">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setCapture(undefined);
                  setError("");
                }}
              >
                Try again
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function AuthCaptureList({
  projectId,
  selectedPath,
  onSelect,
  refreshKey,
}: {
  projectId: string;
  selectedPath?: string;
  onSelect: (path: string | undefined) => void;
  /** Bump this (e.g. a counter) to force a refetch — the wizard capturing a
   * new session doesn't otherwise tell this list to reload. */
  refreshKey?: number;
}) {
  const [captures, setCaptures] = useState<AuthCapture[]>();
  const [removing, setRemoving] = useState<string>();

  const basePath = `/projects/${projectId}/auth-captures`;
  const reload = () =>
    apiRequest<AuthCapture[]>(basePath, undefined, "GET")
      .then((all) => setCaptures(all.filter((c) => c.status === "captured")))
      .catch(() => setCaptures([]));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  const forget = async (id: string, path: string) => {
    setRemoving(id);
    try {
      await apiRequest(`${basePath}/${id}`, undefined, "DELETE");
      if (selectedPath === path) onSelect(undefined);
      await reload();
    } finally {
      setRemoving(undefined);
    }
  };

  if (!captures) return null;
  if (!captures.length) return null;

  return (
    <div className="auth-capture-list">
      {captures.map((c) => (
        <label
          key={c.id}
          className={`auth-capture-row${selectedPath === c.path ? " selected" : ""}`}
        >
          <input
            type="radio"
            name="auth-capture-selection"
            checked={selectedPath === c.path}
            onChange={() => onSelect(c.path)}
          />
          <div className="auth-capture-row-body">
            <strong>{c.domains?.join(", ") || "Captured session"}</strong>
            <small>
              {c.cookieCount ?? 0} cookie{c.cookieCount === 1 ? "" : "s"} ·
              captured {c.capturedAt ? relativeTime(c.capturedAt) : ""}
            </small>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Forget this session"
            title="Forget this session"
            onClick={(e) => {
              e.preventDefault();
              if (c.path) void forget(c.id, c.path);
            }}
            disabled={removing === c.id}
          >
            {removing === c.id ? (
              <Loader2 size={13} className="flow-cap-spin" />
            ) : (
              <Trash2 size={13} />
            )}
          </button>
        </label>
      ))}
    </div>
  );
}
