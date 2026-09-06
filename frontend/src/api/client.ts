/**
 * Base HTTP client for the Cerefox JSON API.
 *
 * In development, Vite proxies /api/v1/* to the FastAPI backend.
 * In production, same-origin requests go directly to FastAPI.
 */

const BASE_URL = "/api/v1";

export class ApiError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    // The backend puts its human remediation in the JSON body's `detail`
    // ("run `cerefox server deploy`…"); a bare "API error 503: Service
    // Unavailable" hides the fix from the one surface it was written for.
    let detail = "";
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string" && parsed.detail) detail = parsed.detail;
    } catch {
      // Non-JSON body — keep the generic message.
    }
    super(detail ? `${detail} (HTTP ${status})` : `API error ${status}: ${statusText}`);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

/**
 * Raised when v0.6's web server signals that an endpoint needs the v0.7
 * ingestion pipeline. Matches the 503 body shape both Part 24H's
 * ingestion stubs and Part 24E's /edit content-change branch emit:
 *
 *   { success: false, error: "Ingestion lands in v0.7", see: "<url>",
 *     note: "<friendly explanation>" }
 *
 * UI code catches this and surfaces the friendly toast (see
 * `utils/notifications.ts → showV07DeferredToast`) instead of a generic
 * red error banner.
 */
export class V07IngestionDeferredError extends ApiError {
  errorMessage: string;
  see: string | null;
  note: string | null;

  constructor(body: string, parsed: V07IngestionDeferredBody) {
    super(503, "Service Unavailable", body);
    this.name = "V07IngestionDeferredError";
    this.errorMessage = parsed.error;
    this.see = parsed.see ?? null;
    this.note = parsed.note ?? null;
  }
}

interface V07IngestionDeferredBody {
  success?: false;
  error: string;
  see?: string;
  note?: string;
}

function parseV07Body(raw: string): V07IngestionDeferredBody | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const errorText = parsed.error;
    if (typeof errorText !== "string" || !errorText.toLowerCase().includes("v0.7")) {
      return null;
    }
    return {
      error: errorText,
      see: typeof parsed.see === "string" ? parsed.see : undefined,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
    };
  } catch {
    // not JSON — fall through
  }
  return null;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await apiFetchResponse(path, options);
  return response.json() as Promise<T>;
}

/** `apiFetch` without the JSON step, for callers that also need a header. */
export async function apiFetchResponse(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 503) {
      const v07 = parseV07Body(body);
      if (v07) throw new V07IngestionDeferredError(body, v07);
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  return response;
}

/**
 * Probe a Response (used by raw `fetch` call sites like the file-upload
 * mutation that posts FormData and doesn't go through `apiFetch`) for
 * the v0.7-deferred 503 body. Returns the parsed body or null. Caller
 * is responsible for throwing / toasting.
 */
export async function detectV07FromResponse(
  resp: Response,
): Promise<V07IngestionDeferredError | null> {
  if (resp.status !== 503) return null;
  const body = await resp.text();
  const v07 = parseV07Body(body);
  return v07 ? new V07IngestionDeferredError(body, v07) : null;
}

/**
 * Human-readable reason for a failed raw-`fetch` upload (#232).
 *
 * The ingest routes answer 400/409 for a refused write and put the reason in
 * the body's `detail` (and `error`). `apiFetch` call sites get that for free
 * via `ApiError`; the FormData upload paths use raw `fetch` and would
 * otherwise show only a status code. Safe to call after
 * `detectV07FromResponse` returned null: that only consumes the body on a 503.
 */
export async function uploadFailureMessage(resp: Response): Promise<string> {
  let body = "";
  try {
    body = await resp.text();
  } catch {
    /* body already consumed or unreadable — fall through to the status */
  }
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    for (const field of [parsed.detail, parsed.error]) {
      if (typeof field === "string" && field.trim()) return field;
    }
  } catch {
    /* non-JSON body */
  }
  return `Upload failed: ${resp.status}`;
}

/** Build a query string from a params object, omitting empty values. */
export function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}
