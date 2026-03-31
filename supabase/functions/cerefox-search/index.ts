import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * cerefox-search — Supabase Edge Function
 *
 * Accepts a plain-text query, embeds it server-side using the OpenAI API,
 * then calls the appropriate Cerefox search RPC and returns the results.
 *
 * Called by the cerefox-mcp Edge Function (MCP Streamable HTTP), GPT Actions
 * (direct HTTP POST), or any HTTP client. No SQL required, no local embedder.
 *
 * Request body (JSON):
 *   query           string   required  Natural-language search query
 *   project_name    string   optional  Project to filter by (looked up by name)
 *   match_count     number   optional  Max results (default: 5)
 *   mode            string   optional  "hybrid" | "fts" | "docs" (default: "docs")
 *   alpha           number   optional  Semantic weight for hybrid search (default: 0.7)
 *   min_score       number   optional  Min cosine similarity (default: 0.5)
 *   metadata_filter object   optional  JSONB containment filter. Only documents whose
 *                                      metadata contains ALL specified key-value pairs
 *                                      are returned. Example: {"type":"decision"}.
 *                                      Use cerefox-metadata to discover available keys.
 *   max_bytes       number   optional  Response size budget in bytes (default: 200000,
 *                                      hard ceiling: 200000). Agents may pass a smaller
 *                                      value to fit their context window; values above
 *                                      the server ceiling are silently capped. Results
 *                                      are dropped whole (never truncated mid-doc) until
 *                                      the budget is satisfied. The response includes a
 *                                      `truncated` flag when results were dropped.
 *
 * Response: { results: [...], query, mode, match_count, project_name?,
 *             truncated: boolean, response_bytes: number }
 *
 * Example agent prompt:
 *   "Invoke the cerefox-search edge function with query='knowledge management'
 *    and project_name='Personal'. Summarize the results."
 */

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 768;

// Response size ceiling — server-enforced hard limit.
// Agents may pass a smaller max_bytes to fit their context budget, but cannot
// exceed this value. Acts as both the default (when max_bytes is omitted) and
// the hard ceiling (when the caller requests more). Small-to-big retrieval
// bounds individual large-doc results to matched chunks + neighbours, so this
// ceiling is rarely reached under normal usage at the default match_count=5.
const MAX_BYTES = 200_000;


interface SearchRequest {
  query: string;
  project_name?: string;
  match_count?: number;
  mode?: "hybrid" | "fts" | "docs";
  alpha?: number;
  min_score?: number;
  metadata_filter?: Record<string, string> | null;
  max_bytes?: number;
  requestor?: string;
}

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_INITIAL_BACKOFF_MS = 500; // 500ms, 1s, 2s exponential backoff

async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: text,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        // Don't retry client errors (4xx)
        if (response.status < 500) {
          throw new Error(`OpenAI embedding error ${response.status}: ${err}`);
        }
        // Server errors (5xx) are retryable
        lastError = new Error(`OpenAI embedding error ${response.status}: ${err}`);
        const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `Embedding API returned ${response.status} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      const data = await response.json();
      if (attempt > 0) {
        console.info(`Embedding API succeeded on retry ${attempt}`);
      }
      return data.data[0].embedding;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI embedding error")) {
        // Non-retryable (4xx) errors already thrown above
        throw err;
      }
      // Network/timeout errors are retryable
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `Embedding API request failed: ${lastError.message} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error(`Embedding API failed after ${EMBEDDING_MAX_RETRIES} attempts`);
}

async function lookupProjectId(
  supabase: ReturnType<typeof createClient>,
  projectName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cerefox_projects")
    .select("id")
    .ilike("name", projectName)
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].id;
}

/**
 * Apply a byte budget to an array of result rows.
 *
 * Each row is serialised to JSON to measure its size. Rows are included in
 * order until the next row would push the running total over `maxBytes`.
 * Rows are always kept or dropped whole — content is never truncated
 * mid-document. Returns the accepted rows and a `truncated` flag.
 */
function applyByteBudget(
  rows: unknown[],
  maxBytes: number,
): { accepted: unknown[]; truncated: boolean; usedBytes: number } {
  const accepted: unknown[] = [];
  let usedBytes = 0;
  let truncated = false;

  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length;
    if (usedBytes + rowBytes > maxBytes) {
      truncated = true;
      break;
    }
    accepted.push(row);
    usedBytes += rowBytes;
  }

  return { accepted, truncated, usedBytes };
}

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers,
    });
  }

  let body: SearchRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers,
    });
  }

  const {
    query,
    project_name,
    match_count = 5,
    mode = "docs",
    alpha = 0.7,
    min_score = 0.5,
    metadata_filter = null,
    max_bytes: requested_max_bytes,
  } = body;

  // Enforce ceiling: agents may request less but never more than MAX_BYTES.
  const max_bytes = Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES);

  // Validate metadata_filter: must be a plain object (or null/absent).
  // Reject arrays, strings, and other non-object types to prevent RPC errors.
  if (
    metadata_filter !== null &&
    metadata_filter !== undefined &&
    (typeof metadata_filter !== "object" || Array.isArray(metadata_filter))
  ) {
    return new Response(
      JSON.stringify({ error: "metadata_filter must be a JSON object or null" }),
      { status: 400, headers },
    );
  }

  if (!query || typeof query !== "string" || !query.trim()) {
    return new Response(JSON.stringify({ error: "query is required" }), {
      status: 400,
      headers,
    });
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY secret not set on this project" }),
      { status: 500, headers },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Configurable requestor enforcement
  const identityField = "requestor";
  const identityValue = body[identityField as keyof SearchRequest] as string | undefined;
  const { data: reqConfig } = await supabase.rpc("cerefox_get_config", { p_key: "require_requestor_identity" });
  if (reqConfig === "true") {
    if (!identityValue || (typeof identityValue === "string" && identityValue.trim() === "")) {
      return new Response(
        JSON.stringify({ error: `Missing required parameter "${identityField}". Server requires caller identity.` }),
        { status: 400, headers },
      );
    }
    const { data: fmtConfig } = await supabase.rpc("cerefox_get_config", { p_key: "requestor_identity_format" });
    if (fmtConfig && typeof fmtConfig === "string" && fmtConfig.trim() !== "") {
      if (!new RegExp(fmtConfig).test(identityValue)) {
        return new Response(
          JSON.stringify({ error: `Invalid "${identityField}" format. Does not match pattern: ${fmtConfig}` }),
          { status: 400, headers },
        );
      }
    }
  }

  // Resolve project name → UUID if provided
  let projectId: string | null = null;
  if (project_name) {
    projectId = await lookupProjectId(supabase, project_name);
    if (!projectId) {
      return new Response(
        JSON.stringify({ error: `Project not found: ${project_name}` }),
        { status: 404, headers },
      );
    }
  }

  // FTS mode doesn't need an embedding
  let embedding: number[] | null = null;
  if (mode !== "fts") {
    try {
      embedding = await getEmbedding(query, openaiKey);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers,
      });
    }
  }

  // Call the appropriate RPC
  let rpcName: string;
  let rpcParams: Record<string, unknown>;

  // Build a metadata filter param only when a non-empty filter object is provided.
  // Passing null explicitly or an empty object {} to the RPC is equivalent to no filter,
  // but we omit it entirely when absent to keep RPC call params minimal.
  const metaFilterParam = metadata_filter && Object.keys(metadata_filter).length > 0
    ? { p_metadata_filter: metadata_filter }
    : {};

  if (mode === "fts") {
    rpcName = "cerefox_fts_search";
    rpcParams = {
      p_query_text: query,
      p_match_count: match_count,
      p_project_id: projectId,
      ...metaFilterParam,
    };
  } else if (mode === "hybrid") {
    rpcName = "cerefox_hybrid_search";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_alpha: alpha,
      p_use_upgrade: false,
      p_project_id: projectId,
      p_min_score: min_score,
      ...metaFilterParam,
    };
  } else {
    // "docs" — document-level hybrid search (recommended default).
    // Small-to-big threshold and context window use the RPC defaults (20000 / 1).
    // Override them in Postgres (rpcs.sql) if you need a different server-wide value.
    rpcName = "cerefox_search_docs";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_alpha: alpha,
      p_project_id: projectId,
      p_min_score: min_score,
      ...metaFilterParam,
    };
  }

  const { data, error } = await supabase.rpc(rpcName, rpcParams);

  if (error) {
    return new Response(JSON.stringify({ error: `RPC error: ${error.message}` }), {
      status: 500,
      headers,
    });
  }

  // Apply byte budget — drop whole results (never truncate mid-doc) to stay
  // under the limit. This mirrors the local MCP server's truncation behaviour.
  const { accepted, truncated, usedBytes } = applyByteBudget(data ?? [], max_bytes);

  // Fire-and-forget usage logging (never blocks the response)
  Promise.resolve(supabase.rpc("cerefox_log_usage", {
    p_operation: "search",
    p_access_path: "edge-function",
    p_requestor: body.requestor ?? null,
    p_query_text: query,
    p_result_count: accepted.length,
    p_project_id: projectId,
  })).catch(() => {});

  return new Response(
    JSON.stringify({
      results: accepted,
      query,
      mode,
      match_count,
      project_name: project_name ?? null,
      metadata_filter: metadata_filter ?? null,
      truncated,
      response_bytes: usedBytes,
    }),
    { headers },
  );
});
