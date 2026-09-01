import type {
  SessionSummary,
  RequestSummary,
  CapturedRequest,
} from "@wiretap/shared";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  sessions: () => getJSON<SessionSummary[]>("/api/sessions"),
  requests: (id: string) =>
    getJSON<RequestSummary[]>(`/api/sessions/${encodeURIComponent(id)}`),
  request: (id: string, file: string) =>
    getJSON<CapturedRequest>(
      `/api/sessions/${encodeURIComponent(id)}/${encodeURIComponent(file)}`,
    ),
  config: () =>
    getJSON<{
      logDir: string;
      dbPath: string;
      dbFound: boolean;
      modelsPath: string;
      pricingFound: boolean;
      costCachePath: string;
    }>("/api/config"),
  costStatus: () =>
    getJSON<{
      done: number;
      total: number;
      running: boolean;
      costed: number;
    }>("/api/cost/status"),
};
