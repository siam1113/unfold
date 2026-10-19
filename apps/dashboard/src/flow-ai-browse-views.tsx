import { useCallback, useEffect, useRef, useState } from "react";
import {
  MonitorPlay,
  X,
  Send,
  Loader2,
  Wrench,
  Network,
  Terminal,
  Plug,
  Power,
  Rocket,
  PanelRightOpen,
  PanelRightClose,
  ListChecks,
  Activity,
  UploadCloud,
  Maximize2,
  Minimize2,
  RotateCw,
  Lock,
  Mic,
  MicOff,
} from "lucide-react";
import type {
  BrowseSession,
  BrowseEvent,
} from "../../../packages/shared/src/index";
import { useFullscreenToggle } from "./use-fullscreen";
import "./flow-ai-browse-views.css";

// Server contract (apps/server/src/index.ts):
//   POST /api/projects/:id/browse/sessions                 { mode: "connect", cdpEndpoint } | { mode: "launch" } -> BrowseSession
//   GET  /api/projects/:id/browse/sessions                 -> BrowseSession[]
//   GET  /api/projects/:id/browse/sessions/:sid/events     SSE, long-lived
//   POST /api/projects/:id/browse/sessions/:sid/chat       { message, history } -> SSE (one turn)
//   POST /api/projects/:id/browse/sessions/:sid/close
//   GET  /api/projects/:id/browse/sessions/:sid/screenshot -> image/png
//   GET  /api/projects/:id/browse/sessions/:sid/url        -> { url }
//   POST /api/projects/:id/browse/sessions/:sid/navigate   { url } -> { url }
const apiRequest = async <T,>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> => {
  const res = await fetch(
    "/api" + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((value as { error?: string }).error || "Request failed");
  return value as T;
};

type DrawerTab = "agent" | "network" | "console" | "tools" | "activity";
const DRAWER_TABS: { id: DrawerTab; name: string; icon: typeof Wrench }[] = [
  { id: "agent", name: "Agent Calls", icon: Wrench },
  { id: "network", name: "Network", icon: Network },
  { id: "console", name: "Console", icon: Terminal },
  { id: "tools", name: "Available Tools", icon: ListChecks },
  { id: "activity", name: "Tool Activity", icon: Activity },
];
const TAB_KINDS: Record<DrawerTab, BrowseEvent["kind"][]> = {
  agent: ["agent_tool", "agent_message", "status"],
  network: ["network_request", "network_response"],
  console: ["console"],
  tools: [],
  activity: ["agent_tool"],
};

// A project's published capabilities — the real WebMCP tools the chat loop
// can call (apps/server/src/index.ts) alongside its fixed browser tools
// (navigate/click/fill/read_page/screenshot, defined server-side in
// packages/mcp/src/browse-tools.ts and not worth duplicating here since
// they never change).
interface WebMcpTool {
  name: string;
  description: string;
  risk?: string;
}

// The Web Speech API's SpeechRecognition isn't in TS's DOM lib (still
// non-standard, Chrome-only unprefixed as of this writing) — read it off
// `window` loosely rather than pulling in a types package for one type.
const SpeechRecognitionCtor: any =
  typeof window !== "undefined" &&
  ((window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition);

export function AiBrowse({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const [session, setSession] = useState<BrowseSession>();
  const [cdpEndpoint, setCdpEndpoint] = useState("http://localhost:9222");
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connecting, setConnecting] = useState<"connect" | "launch" | null>(
    null,
  );
  const [connectError, setConnectError] = useState("");
  const [events, setEvents] = useState<BrowseEvent[]>([]);
  const [activeTab, setActiveTab] = useState<DrawerTab>("agent");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastAnswer, setLastAnswer] = useState("");
  const [screenshotTick, setScreenshotTick] = useState(0);
  const [webmcpTools, setWebmcpTools] = useState<WebMcpTool[]>([]);
  const [connectStatus, setConnectStatus] = useState("");
  const [liveStatus, setLiveStatus] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [navError, setNavError] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const recognitionRef = useRef<any>(null);
  const voiceModeRef = useRef(false);
  const busyRef = useRef(false);
  const speakingRef = useRef(false);
  const basePath = `/projects/${projectId}/browse/sessions`;
  const live = session?.status === "live";
  const panelRef = useRef<HTMLElement>(null);
  const { isFullscreen, toggleFullscreen } = useFullscreenToggle(panelRef);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    apiRequest<BrowseSession[]>(basePath, undefined, "GET")
      .then((sessions) => {
        const current = sessions.find((s) => s.status === "live");
        if (current) setSession(current);
      })
      .catch(() => {});
    // Only ever recover a session when this panel first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiRequest<WebMcpTool[]>(
      `/projects/${projectId}/browse/webmcp-tools`,
      undefined,
      "GET",
    )
      .then(setWebmcpTools)
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!live || !session) return;
    const source = new EventSource(`/api${basePath}/${session.id}/events`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as BrowseEvent;
        setEvents((current) => [...current, event].slice(-500));
        if (event.kind === "status") {
          const text = (event.payload as Record<string, unknown>).message;
          if (typeof text === "string") setLiveStatus(text);
        }
      } catch {
        // Ignore malformed frames rather than tear down the whole stream.
      }
    };
    return () => source.close();
  }, [live, session, basePath]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setScreenshotTick((t) => t + 1), 1600);
    return () => clearInterval(timer);
  }, [live]);

  // Keeps the address bar honest about where the tab actually is — the
  // agent, published WebMCP tools, or the page itself (a redirect, a link
  // click) can all move it without going through our own navigate() below.
  useEffect(() => {
    if (!live || !session) return;
    let cancelled = false;
    const poll = () => {
      apiRequest<{ url: string }>(
        `${basePath}/${session.id}/url`,
        undefined,
        "GET",
      )
        .then((result) => {
          if (!cancelled && typeof result.url === "string")
            setAddressDraft(result.url);
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 1600);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, session, basePath]);

  const connect = async (mode: "connect" | "launch") => {
    setConnecting(mode);
    setConnectError("");
    setConnectStatus(
      mode === "launch"
        ? "Launching an isolated browser…"
        : `Connecting to ${cdpEndpoint}…`,
    );
    try {
      const created = await apiRequest<BrowseSession>(
        basePath,
        mode === "launch" ? { mode } : { mode, cdpEndpoint },
      );
      setSession(created);
      if (created.status === "failed")
        setConnectError(
          created.lastError ||
            (mode === "launch"
              ? "Could not launch an isolated browser."
              : "Could not connect to that Chrome instance."),
        );
    } catch (error) {
      setConnectError((error as Error).message);
    } finally {
      setConnecting(null);
      setConnectStatus("");
    }
  };

  const navigate = async (rawUrl: string) => {
    if (!session) return;
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    setNavigating(true);
    setNavError("");
    try {
      const result = await apiRequest<{ url: string }>(
        `${basePath}/${session.id}/navigate`,
        { url },
      );
      if (typeof result.url === "string") setAddressDraft(result.url);
    } catch (error) {
      setNavError((error as Error).message);
    } finally {
      setNavigating(false);
    }
  };

  const [publishing, setPublishing] = useState(false);
  const publishTools = async () => {
    if (!session) return;
    setPublishing(true);
    try {
      const result = await apiRequest<{
        registered: string[];
        unavailable: boolean;
      }>(`${basePath}/${session.id}/publish-tools`, {});
      setLastAnswer(
        result.unavailable
          ? "WebMCP is unavailable on this page."
          : `Published ${result.registered.length} tool${result.registered.length === 1 ? "" : "s"} to this page's document.modelContext.`,
      );
    } catch (error) {
      setLastAnswer(`Publish error: ${(error as Error).message}`);
    } finally {
      setPublishing(false);
    }
  };

  const closeSession = async () => {
    if (!session) return;
    try {
      await apiRequest(`${basePath}/${session.id}/close`, {});
    } catch {
      // Best-effort — the UI returns to the connect form regardless.
    }
    setSession(undefined);
    setEvents([]);
    setShowConnectForm(false);
    setLiveStatus("");
    setAddressDraft("");
    setNavError("");
    setVoiceMode(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  const sendMessageRef = useRef<(overrideContent?: string) => Promise<void>>(
    async () => {},
  );
  const startListeningRef = useRef<() => void>(() => {});

  // Creates/tears down voice mode's listening loop as it's toggled.
  // Deliberately NOT one long-lived SpeechRecognition object restarted
  // across turns — Chrome (and others) get unreliable once you stop() and
  // start() the same instance more than once, which is exactly the "works
  // for the first command, then needs a mute/unmute to recover" bug.
  // Instead every listening turn gets its own fresh instance.
  useEffect(() => {
    if (!voiceMode) return;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice input isn't supported in this browser.");
      setVoiceMode(false);
      return;
    }
    let stopped = false;

    const startListening = () => {
      if (
        stopped ||
        !voiceModeRef.current ||
        busyRef.current ||
        speakingRef.current
      )
        return;
      const recognition = new SpeechRecognitionCtor();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      recognition.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            const trimmed = text.trim();
            if (trimmed) {
              setDraft("");
              void sendMessageRef.current(trimmed);
            }
          } else {
            interim += text;
          }
        }
        if (interim) setDraft(interim);
      };
      recognition.onerror = (event: any) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        setVoiceError(`Voice error: ${event.error}`);
      };
      recognition.onend = () => {
        setListening(false);
        if (recognitionRef.current === recognition)
          recognitionRef.current = null;
        // Always hand off to a brand-new instance rather than restarting
        // this one — keeps the hands-free loop going turn after turn.
        startListening();
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
        setListening(true);
      } catch {
        recognitionRef.current = null;
      }
    };

    startListeningRef.current = startListening;
    startListening();

    return () => {
      stopped = true;
      startListeningRef.current = () => {};
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        try {
          recognition.abort();
        } catch {
          // Already stopped — fine.
        }
        recognitionRef.current = null;
      }
      setListening(false);
    };
  }, [voiceMode]);

  // Pause listening while a turn is in flight, so the mic doesn't pick up
  // a second command mid-answer.
  useEffect(() => {
    if (!voiceMode || !busy) return;
    try {
      recognitionRef.current?.abort();
    } catch {
      // Ignore.
    }
  }, [voiceMode, busy]);

  // Resumes listening (via a fresh instance — see above) once a turn
  // finishes — but only once speech synthesis has actually finished
  // talking, if it's talking at all. Deliberately polls
  // `speechSynthesis.speaking` instead of trusting SpeechSynthesisUtterance's
  // onend/onerror: those events are well known to silently never fire in
  // some browsers/voices, which would otherwise strand the mic "paused"
  // forever after the very first spoken answer.
  useEffect(() => {
    if (!voiceMode || busy) return;
    let cancelled = false;
    const tryResume = () => {
      if (cancelled) return;
      if ("speechSynthesis" in window && window.speechSynthesis.speaking) {
        setTimeout(tryResume, 200);
        return;
      }
      speakingRef.current = false;
      setSpeaking(false);
      startListeningRef.current();
    };
    // A short delay before the first check gives speechSynthesis.speak()
    // (called just before this effect runs) a moment to actually start,
    // so we don't race it and resume listening a beat too early.
    const timer = setTimeout(tryResume, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [voiceMode, busy]);

  const toggleVoiceMode = () => {
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice input isn't supported in this browser.");
      return;
    }
    setVoiceError("");
    setVoiceMode((v) => {
      const next = !v;
      if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
      return next;
    });
  };

  // Reads an answer aloud when voice mode is on. Listening resumes via the
  // polling effect above, not from here — SpeechSynthesisUtterance's
  // completion events can't be trusted to fire.
  const speak = (text: string) => {
    if (!voiceModeRef.current || !text || !("speechSynthesis" in window))
      return;
    try {
      window.speechSynthesis.cancel();
      speakingRef.current = true;
      setSpeaking(true);
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      speakingRef.current = false;
      setSpeaking(false);
    }
  };

  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>(
    [],
  );
  const sendMessage = async (overrideContent?: string) => {
    const content = (overrideContent ?? draft).trim();
    if (!content || busy || !session) return;
    setDraft("");
    setBusy(true);
    setStatus("Starting…");
    historyRef.current = [
      ...historyRef.current,
      { role: "user" as const, content },
    ].slice(-12);
    try {
      const response = await fetch(`/api${basePath}/${session.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: historyRef.current.slice(0, -1),
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Agent request failed");
      }
      if (!response.body) throw new Error("The agent stream is unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let complete = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = frame
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (line) {
            const event = JSON.parse(line.slice(6));
            if (event.type === "status") setStatus(event.message);
            if (event.type === "error") throw new Error(event.message);
            if (event.type === "done") {
              answer = event.message;
              complete = true;
            }
          }
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (!complete)
        throw new Error("The agent stream ended before the answer arrived");
      historyRef.current = [
        ...historyRef.current,
        { role: "assistant" as const, content: answer },
      ].slice(-12);
      setLastAnswer(answer);
      setStatus("");
      speak(answer);
    } catch (error) {
      const message = `Agent error: ${(error as Error).message}`;
      setLastAnswer(message);
      setStatus("");
      speak(message);
    } finally {
      setBusy(false);
    }
  };
  sendMessageRef.current = sendMessage;

  const filteredEvents = events.filter((event) =>
    TAB_KINDS[activeTab].includes(event.kind),
  );

  const eventLabel = useCallback((event: BrowseEvent) => {
    const payload = event.payload as Record<string, any>;
    switch (event.kind) {
      case "agent_tool":
        return `${payload.source ? `[${payload.source}] ` : ""}${payload.name} · ${payload.status}`;
      case "console":
        return `[${payload.level}] ${payload.text}`;
      case "network_request":
        return `→ ${payload.method} ${payload.url}`;
      case "network_response":
        return `← ${payload.status} ${payload.method} ${payload.url}`;
      case "status":
        return payload.message;
      default:
        return JSON.stringify(payload);
    }
  }, []);

  const selectTab = (tab: DrawerTab) => {
    setActiveTab(tab);
    setDrawerOpen(true);
  };

  return (
    <div className="browse-backdrop">
      <section
        ref={panelRef}
        className="browse-panel"
        role="dialog"
        aria-modal="true"
        aria-label="AI Browse"
      >
        <div className="agent-screen-toolbar">
          <div className="agent-screen-title">
            <span className="agent-screen-mark">
              <MonitorPlay size={18} />
            </span>
            <div>
              <h2>AI Browse</h2>
              <p>Drive a browser live, with an AI assistant.</p>
            </div>
          </div>
          <div className="browse-toolbar-actions">
            {live && (
              <button
                type="button"
                className="icon-button"
                onClick={publishTools}
                disabled={publishing}
                aria-label="Publish tools to this page"
                title="Publish tools to this page"
              >
                {publishing ? (
                  <Loader2 size={15} className="flow-cap-spin" />
                ) : (
                  <UploadCloud size={15} />
                )}
              </button>
            )}
            {live && (
              <button
                type="button"
                className="icon-button"
                onClick={closeSession}
                aria-label="Disconnect"
                title="Disconnect"
              >
                <Power size={15} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={
                isFullscreen ? "Exit full screen" : "Enter full screen"
              }
              title={isFullscreen ? "Exit full screen" : "Full screen"}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Close AI Browse"
              title="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="browse-workbench">
          <div className="browse-main">
            {!live ? (
              <div className="browse-connect">
                <Plug size={28} />
                <strong>Start an AI Browse session</strong>
                <p>
                  Launch a fresh, isolated browser the agent controls entirely,
                  or connect to your own Chrome via its CDP debugging port.
                </p>
                <div className="browse-connect-options">
                  <button
                    type="button"
                    className="browse-connect-option"
                    onClick={() => connect("launch")}
                    disabled={connecting !== null}
                  >
                    {connecting === "launch" ? (
                      <Loader2 size={18} className="flow-cap-spin" />
                    ) : (
                      <Rocket size={18} />
                    )}
                    <span>
                      <strong>Launch new isolated browser</strong>
                      <small>
                        A throwaway browser with no history or cookies — safe by
                        default.
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="browse-connect-option"
                    onClick={() => setShowConnectForm((v) => !v)}
                    disabled={connecting !== null}
                  >
                    <Plug size={18} />
                    <span>
                      <strong>Connect to existing browser</strong>
                      <small>
                        Drive your own Chrome via its CDP debugging port.
                      </small>
                    </span>
                  </button>
                </div>
                {showConnectForm && (
                  <div className="browse-connect-form">
                    <code>
                      chrome --remote-debugging-port=9222
                      --user-data-dir=/tmp/unfold-chrome-debug
                    </code>
                    <div className="browse-connect-form-row">
                      <input
                        value={cdpEndpoint}
                        onChange={(event) => setCdpEndpoint(event.target.value)}
                        placeholder="http://localhost:9222"
                        aria-label="CDP endpoint"
                      />
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => connect("connect")}
                        disabled={connecting !== null || !cdpEndpoint.trim()}
                      >
                        {connecting === "connect" ? (
                          <Loader2 size={14} className="flow-cap-spin" />
                        ) : (
                          <Plug size={14} />
                        )}
                        {connecting === "connect" ? "Connecting…" : "Connect"}
                      </button>
                    </div>
                  </div>
                )}
                {connectStatus && !connectError && (
                  <p className="browse-connect-status">
                    <Loader2 size={13} className="flow-cap-spin" />
                    {connectStatus}
                  </p>
                )}
                {connectError && (
                  <p className="browse-connect-error">{connectError}</p>
                )}
              </div>
            ) : (
              <>
                <div
                  className={`browse-addressbar${navigating ? " is-navigating" : ""}`}
                >
                  <Lock size={12} />
                  <input
                    value={addressDraft ?? ""}
                    readOnly
                    placeholder="No page loaded yet…"
                    aria-label="Current URL"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    aria-label="Reload"
                    title="Reload"
                    onClick={() => void navigate(addressDraft)}
                    disabled={navigating || !addressDraft?.trim()}
                  >
                    {navigating ? (
                      <Loader2 size={13} className="flow-cap-spin" />
                    ) : (
                      <RotateCw size={13} />
                    )}
                  </button>
                </div>
                {navError && <p className="browse-connect-error">{navError}</p>}
                <div className="browse-browser-viewport">
                  <img
                    src={`/api${basePath}/${session!.id}/screenshot?v=${screenshotTick}`}
                    alt="Live browser view"
                  />
                </div>
                {(status || liveStatus || lastAnswer) && (
                  <div className="browse-status-line">
                    {status || liveStatus || lastAnswer}
                  </div>
                )}
                {voiceError && (
                  <p className="browse-connect-error">{voiceError}</p>
                )}
                <form
                  className="browse-composer"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendMessage();
                  }}
                >
                  <button
                    type="button"
                    className={`icon-button browse-mic-button${listening ? " is-listening" : ""}${speaking ? " is-speaking" : ""}`}
                    onClick={toggleVoiceMode}
                    disabled={!SpeechRecognitionCtor}
                    aria-pressed={voiceMode}
                    aria-label={
                      voiceMode ? "Turn off voice mode" : "Turn on voice mode"
                    }
                    title={
                      !SpeechRecognitionCtor
                        ? "Voice input isn't supported in this browser"
                        : voiceMode
                          ? "Turn off voice mode"
                          : "Turn on voice mode — speak to the agent hands-free"
                    }
                  >
                    {voiceMode ? <Mic size={15} /> : <MicOff size={15} />}
                  </button>
                  {voiceMode && (
                    <span
                      className={`browse-voice-state${listening ? " is-listening" : ""}${speaking ? " is-speaking" : ""}`}
                    >
                      {speaking ? "Speaking…" : listening ? "Listening…" : "…"}
                    </span>
                  )}
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder={
                      voiceMode
                        ? "Speak, or type here…"
                        : "Tell the agent what to do…"
                    }
                    aria-label="Message the agent"
                    disabled={busy}
                  />
                  <button
                    className="button primary"
                    type="submit"
                    disabled={!draft.trim() || busy}
                    aria-label="Send"
                  >
                    {busy ? (
                      <Loader2 size={15} className="flow-cap-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
          <div className={`browse-drawer ${drawerOpen ? "open" : ""}`}>
            {drawerOpen && (
              <div className="browse-drawer-content">
                <div className="browse-drawer-content-head">
                  {DRAWER_TABS.find((t) => t.id === activeTab)?.name}
                </div>
                {activeTab === "tools" ? (
                  webmcpTools.length ? (
                    webmcpTools.map((tool) => (
                      <div className="browse-tool-row" key={tool.name}>
                        <code>{tool.name}</code>
                        <p>{tool.description}</p>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      No published WebMCP tools for this project yet.
                    </p>
                  )
                ) : activeTab === "activity" ? (
                  filteredEvents.length ? (
                    filteredEvents.map((event) => {
                      const payload = event.payload as Record<string, any>;
                      return (
                        <div
                          className="browse-tool-activity-row"
                          key={event.id}
                        >
                          <div className="browse-tool-activity-head">
                            {payload.source && (
                              <span
                                className={`browse-tool-activity-source is-${payload.source}`}
                              >
                                [{payload.source}]
                              </span>
                            )}
                            <code>{payload.name}</code>
                            <span
                              className={`browse-tool-activity-status is-${payload.status}`}
                            >
                              {payload.status}
                            </span>
                          </div>
                          {payload.args &&
                            Object.keys(payload.args).length > 0 && (
                              <pre>{JSON.stringify(payload.args)}</pre>
                            )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="muted">Nothing yet.</p>
                  )
                ) : filteredEvents.length ? (
                  filteredEvents.map((event) => (
                    <div className="browse-event-row" key={event.id}>
                      {eventLabel(event)}
                    </div>
                  ))
                ) : (
                  <p className="muted">Nothing yet.</p>
                )}
              </div>
            )}
            <div className="browse-drawer-rail">
              <button
                type="button"
                className="browse-drawer-toggle"
                onClick={() => setDrawerOpen((v) => !v)}
                aria-label={drawerOpen ? "Collapse drawer" : "Expand drawer"}
                title={drawerOpen ? "Collapse drawer" : "Expand drawer"}
              >
                {drawerOpen ? (
                  <PanelRightClose size={14} />
                ) : (
                  <PanelRightOpen size={14} />
                )}
              </button>
              {DRAWER_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={drawerOpen && activeTab === tab.id ? "active" : ""}
                  onClick={() => selectTab(tab.id)}
                  aria-label={tab.name}
                  title={tab.name}
                >
                  <tab.icon size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
