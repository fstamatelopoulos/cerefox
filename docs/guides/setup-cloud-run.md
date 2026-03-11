# Google Cloud Run Deployment

Deploy the Cerefox web UI to Google Cloud Run for a lightweight, serverless hosting option. This guide uses Supabase (free tier) for the database.

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
    CEREFOX_MAX_RESPONSE_BYTES=65000
```

**Memory**: Cerefox uses cloud embeddings (OpenAI API) — no local model is loaded. `--memory 512Mi` is sufficient for the web server alone.

**CPU**: `--cpu 1` is sufficient for personal use. Scale up for concurrent users.

---

## Step 4 — Verify the deployment

```bash
gcloud run services describe $SERVICE_NAME --region $REGION --format="value(status.url)"
```

Open the printed URL — the Cerefox dashboard should load.

---

## Updating the deployment

After making code changes:

```bash
docker build -t $IMAGE .
docker push $IMAGE
gcloud run deploy $SERVICE_NAME --image $IMAGE --region $REGION --platform managed
```

Cloud Run performs a zero-downtime rolling update.

---

## Cost estimate

For personal use:
- Cloud Run: ~$0/month (well within free tier for low traffic)
- Container Registry: ~$0.02/GB/month for the image (~1 GB)
- Supabase: Free tier covers personal use

Total: **effectively free** for a single-user knowledge base.

---

## Securing access

By default `--allow-unauthenticated` makes the URL public. To restrict access:

### Option 1 — Cloud Run IAM

Remove `--allow-unauthenticated` and use `gcloud run services add-iam-policy-binding` to add specific Google accounts.

### Option 2 — Cloud Run proxy

Use Identity-Aware Proxy (IAP) in front of Cloud Run for Google SSO.

### Option 3 — Add HTTP basic auth

In `src/cerefox/api/app.py`, add a middleware that checks `Authorization: Basic ...` headers. Use `CEREFOX_BASIC_AUTH_USER` / `CEREFOX_BASIC_AUTH_PASSWORD` env vars.

