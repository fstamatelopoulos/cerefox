# Google Cloud Run Deployment

> **⚠ Aspirational guidance — not yet tested end-to-end.** This deployment path
> has not been validated against a live Cloud Run deploy. Treat it as a starting
> point / design sketch rather than a verified runbook; expect to adapt the
> `Dockerfile`, ports, and env wiring, and please report back what worked. For
> paths we actively test, see `setup-supabase.md` (server side) and
> `setup-local.md`.

Deploy the Cerefox web UI to Google Cloud Run for a lightweight, serverless hosting option. This guide uses Supabase (free tier) for the database.

> **v1.20.0 changed the image: it now requires `CEREFOX_API_KEY`.** The repo's
> `Dockerfile` (the same one the published `cerefox-web` image is built from)
> refuses to start without it, and turns the API key gate on for every caller.
> Before v1.20.0 this guide deployed it `--allow-unauthenticated` with no key,
> which left a Cerefox that can read and change your whole store open to the
> internet. **If you deployed it that way, add the key (Step 3) before you
> redeploy**, or the new revision will not start. If Cloud Run IAM or IAP
> already controls access, `CEREFOX_WEB_NO_KEY=1` starts it without one. The
> web UI asks for the key once per browser.

> **Note:** The Cerefox web UI is the TypeScript server (`cerefox web` — Hono backend +
> React/Mantine SPA); the Python/FastAPI app was removed at v1.0.0. The container `Dockerfile`
> builds and serves the TS `cerefox web` server (port 8000).

---

## Prerequisites

- Google Cloud account with billing enabled
- `gcloud` CLI installed and authenticated (`gcloud auth login`)
- Supabase project set up (see `setup-supabase.md`)
- Docker installed locally

---

## Step 1 — Set up environment variables

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1
export SERVICE_NAME=cerefox
export IMAGE=gcr.io/$PROJECT_ID/$SERVICE_NAME
```

---

## Step 2 — Build and push the Docker image

```bash
# Authenticate Docker to GCR
gcloud auth configure-docker

# Build and push
docker build -t $IMAGE .
docker push $IMAGE
```

Or use Cloud Build for fully cloud-side building:

```bash
gcloud builds submit --tag $IMAGE .
```

---

## Step 3 — Deploy to Cloud Run

Keep the API key in Secret Manager rather than in a plain env var:

```bash
echo -n "cfx_lak_$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)" | \
  gcloud secrets create cerefox-api-key --data-file=-
```

```bash
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated \
  --port 8000 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars \
    CEREFOX_SUPABASE_URL=https://YOUR-REF.supabase.co,\
    CEREFOX_SUPABASE_KEY=YOUR-SERVICE-ROLE-KEY,\
    OPENAI_API_KEY=YOUR-OPENAI-KEY,\
    CEREFOX_MAX_RESPONSE_BYTES=200000 \
  --set-secrets CEREFOX_API_KEY=cerefox-api-key:latest
```

Read the key back when the web UI asks for it:
`gcloud secrets versions access latest --secret cerefox-api-key`.

**Memory**: Cerefox uses cloud embeddings (OpenAI API) — no local model is loaded. `--memory 512Mi` is sufficient for the TS `cerefox web` server alone.

**CPU**: `--cpu 1` is sufficient for personal use. Scale up for concurrent users.

---

## Step 4 — Verify the deployment

```bash
gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)"
```

Open the printed URL followed by `/app/`. The web UI asks for the API key once;
then the dashboard loads.

---

## Updating the deployment

After making code changes:

```bash
docker build -t $IMAGE .
docker push $IMAGE
gcloud run deploy $SERVICE_NAME --image $IMAGE --region $REGION --platform managed \
  --set-secrets CEREFOX_API_KEY=cerefox-api-key:latest
```

Upgrading a service deployed before v1.20.0 without a key: create the secret
(Step 3) first, or the new revision refuses to start.

Cloud Run performs a zero-downtime rolling update.

---

## Cost

For a typical single-user personal knowledge base, Cloud Run comfortably fits within its
always-free tier limits. The main variable expense is OpenAI embedding calls, shared with
all other deployment options. See `docs/guides/operational-cost.md` for a full breakdown.

---

## Securing access

`--allow-unauthenticated` makes the URL public; the API key is what protects it
then. To also restrict who can reach it:

### Option 1 — Cloud Run IAM

Remove `--allow-unauthenticated` and use `gcloud run services add-iam-policy-binding` to add specific Google accounts. IAM reads the `Authorization` header itself, so with IAM set `CEREFOX_WEB_NO_KEY=1` instead of a key.

### Option 2 — Cloud Run proxy

Use Identity-Aware Proxy (IAP) in front of Cloud Run for Google SSO.

The API key (v1.20.0) replaces the "add HTTP basic auth" option this guide used
to suggest: both would need the `Authorization` header, and the key is already
built in.

