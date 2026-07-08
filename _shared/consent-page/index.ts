/**
 * consent-page — the OAuth consent page HTML (design §4.2-B), as a single pure
 * function so every host (Cloudflare Worker for free setups, or a Supabase Edge
 * Function on a paid custom domain) renders identical markup and behaviour.
 *
 * Why not an Edge Function on the default domain: Supabase rewrites `text/html`
 * to `text/plain` on `*.supabase.co`, so the page would show as source. The
 * canonical host is therefore an HTML-capable one (Cloudflare Worker by default).
 *
 * The page is entirely client-side: it loads supabase-js from a CDN, signs the
 * owner in, shows the approve/deny screen, and completes the flow via
 * `supabase.auth.oauth.*`. The only values injected are the project URL and the
 * public anon key — both non-secret. No `node:`/`jsr:`/`npm:` imports, so it is
 * bundler-agnostic (Deno, Wrangler/esbuild, Bun).
 */

export function renderConsentPage(supabaseUrl: string, anonKey: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize access to Cerefox</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         max-width: 28rem; margin: 6vh auto; padding: 0 1.25rem; line-height: 1.5; }
  h1 { font-size: 1.35rem; } .muted { opacity: .7; font-size: .9rem; }
  .card { border: 1px solid rgba(128,128,128,.3); border-radius: .75rem; padding: 1.25rem; }
  label { display: block; margin: .75rem 0 .25rem; font-size: .9rem; }
  input { width: 100%; padding: .6rem; border-radius: .5rem;
          border: 1px solid rgba(128,128,128,.4); box-sizing: border-box; font-size: 1rem; }
  .row { display: flex; gap: .75rem; margin-top: 1.25rem; }
  button { flex: 1; padding: .7rem; border-radius: .5rem; border: 0; font-size: 1rem; cursor: pointer; }
  .approve { background: #2f7d32; color: #fff; } .deny { background: transparent;
             border: 1px solid rgba(128,128,128,.5); }
  .hidden { display: none; } .err { color: #c0392b; margin-top: .75rem; font-size: .9rem; }
  code { background: rgba(128,128,128,.15); padding: .1rem .3rem; border-radius: .3rem; }
</style>
</head>
<body>
<h1>Authorize access to Cerefox</h1>
<div class="card">
  <div id="fatal" class="hidden">
    <p>This authorization link has expired or was already used.</p>
    <p class="muted">Please start the connection again from your AI client.</p>
  </div>

  <div id="signin" class="hidden">
    <p class="muted">Sign in to your Cerefox account to continue.</p>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" />
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password" />
    <div class="row"><button class="approve" id="signin-btn">Sign in</button></div>
    <div id="signin-err" class="err hidden"></div>
  </div>

  <div id="consent" class="hidden">
    <p>Allow <strong id="client-name">this application</strong> to access your
       Cerefox knowledge base (read and write)?</p>
    <p class="muted" id="scopes"></p>
    <div class="row">
      <button class="deny" id="deny-btn">Deny</button>
      <button class="approve" id="approve-btn">Allow</button>
    </div>
    <div id="consent-err" class="err hidden"></div>
  </div>

  <div id="loading"><p class="muted">Loading…</p></div>
</div>

<script type="module">
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(${JSON.stringify(supabaseUrl)}, ${JSON.stringify(anonKey)});
const params = new URLSearchParams(location.search);
const authorizationId = params.get("authorization_id");

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
function only(id) { for (const s of ["fatal","signin","consent","loading"]) hide(s); show(id); }

function fatal() { only("fatal"); }

async function loadDetails() {
  try {
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) return fatal();
    // Consent already granted for this client: the server returns just a
    // redirect_url (there is nothing to approve — approving again 400s with
    // "authorization request is no longer pending"). Send the user straight back.
    if (data.redirect_url) { location.assign(data.redirect_url); return; }
    $("client-name").textContent = data.client?.name || data.client_name || "This application";
    const scopes = data.scopes || data.scope;
    if (scopes && scopes.length) {
      $("scopes").textContent = "Requested scopes: " +
        (Array.isArray(scopes) ? scopes.join(", ") : scopes);
    }
    only("consent");
  } catch (_e) { fatal(); }
}

async function boot() {
  if (!authorizationId) return fatal();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { only("signin"); return; }
  only("loading");
  await loadDetails();
}

$("signin-btn").addEventListener("click", async () => {
  hide("signin-err");
  const email = $("email").value.trim();
  const password = $("password").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { $("signin-err").textContent = error.message; show("signin-err"); return; }
  only("loading");
  await loadDetails();
});

function describeError(e) {
  if (!e) return "unknown error";
  const parts = [];
  if (e.message) parts.push(e.message);
  if (e.status) parts.push("status " + e.status);
  if (e.code) parts.push("code " + e.code);
  if (e.name && e.name !== "Error") parts.push(e.name);
  return parts.length ? parts.join(" · ") : JSON.stringify(e);
}

$("approve-btn").addEventListener("click", async () => {
  hide("consent-err");
  $("approve-btn").disabled = true;
  try {
    // The SDK auto-redirects the browser on success; we only need to handle
    // the error path and a no-redirect fallback.
    const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
    if (error) throw error;
    if (data?.redirect_url) { location.assign(data.redirect_url); return; }
    throw new Error("approved but no redirect_url (response: " + JSON.stringify(data) + ")");
  } catch (e) {
    console.error("approveAuthorization failed:", e);
    $("consent-err").textContent = "Could not complete authorization: " + describeError(e);
    show("consent-err");
    $("approve-btn").disabled = false;
  }
});

$("deny-btn").addEventListener("click", async () => {
  try {
    const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) throw error;
    if (data?.redirect_url) location.assign(data.redirect_url);
    else fatal();
  } catch (e) {
    console.error("denyAuthorization failed:", e);
    $("consent-err").textContent = "Could not deny: " + describeError(e);
    show("consent-err");
  }
});

boot();
</script>
</body>
</html>`;
}
