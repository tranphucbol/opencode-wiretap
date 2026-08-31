import { useCallback, useEffect, useState } from "react";
import { Pulse, Sun, Moon } from "@phosphor-icons/react";
import { api } from "./api.ts";
import { useTheme } from "./lib/theme.ts";
import type {
  SessionSummary,
  RequestSummary,
  CapturedRequest,
} from "@wiretap/shared";
import { SessionsPane } from "./components/SessionsPane.tsx";
import { RequestsPane } from "./components/RequestsPane.tsx";
import { DetailPane } from "./components/DetailPane.tsx";

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [logDir, setLogDir] = useState<string>("");
  const [dbFound, setDbFound] = useState<boolean>(true);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [detail, setDetail] = useState<CapturedRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      setSessions(await api.sessions());
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : String(e));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadRequests = useCallback(async (id: string) => {
    setRequestsLoading(true);
    setRequestsError(null);
    try {
      setRequests(await api.requests(id));
    } catch (e) {
      setRequestsError(e instanceof Error ? e.message : String(e));
      setRequests([]);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    api
      .config()
      .then((c) => {
        setLogDir(c.logDir);
        setDbFound(c.dbFound);
      })
      .catch(() => {});
  }, [loadSessions]);

  const onSelectSession = useCallback(
    (id: string) => {
      setSelectedSession(id);
      setSelectedFile(null);
      setDetail(null);
      setDetailError(null);
      void loadRequests(id);
    },
    [loadRequests],
  );

  const onSelectFile = useCallback(
    async (file: string) => {
      if (!selectedSession) return;
      setSelectedFile(file);
      setDetailLoading(true);
      setDetailError(null);
      try {
        setDetail(await api.request(selectedSession, file));
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : String(e));
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [selectedSession],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-2">
          <Pulse size={16} weight="bold" className="text-accent" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            wiretap
          </span>
        </div>
        {logDir && (
          <span className="tnum truncate text-[13px] text-faint" title={logDir}>
            {logDir}
          </span>
        )}
        {!dbFound && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] text-block-tool-use"
            title="OpenCode DB not found — showing session ids instead of titles. Set OPENCODE_DB to override."
            style={{ backgroundColor: "var(--model-opus-bg)" }}
          >
            titles unavailable
          </span>
        )}
        <span
          className={`tnum text-[13px] text-faint ${dbFound ? "ml-auto" : ""}`}
        >
          {sessions.length} sessions
        </span>
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="rounded p-1.5 text-muted transition-colors hover:bg-elevated hover:text-ink active:translate-y-px"
        >
          {theme === "dark" ? (
            <Sun size={15} weight="bold" />
          ) : (
            <Moon size={15} weight="bold" />
          )}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[340px_340px_1fr]">
        <SessionsPane
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          selectedId={selectedSession}
          onSelect={onSelectSession}
          onRefresh={loadSessions}
        />
        <RequestsPane
          sessionId={selectedSession}
          requests={requests}
          loading={requestsLoading}
          error={requestsError}
          selectedFile={selectedFile}
          onSelect={onSelectFile}
          onRefresh={() => selectedSession && loadRequests(selectedSession)}
        />
        <DetailPane
          data={detail}
          file={selectedFile}
          loading={detailLoading}
          error={detailError}
        />
      </div>
    </div>
  );
}
