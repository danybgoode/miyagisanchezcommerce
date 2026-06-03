# print-pdf — deploy runbook

Standalone Cloud Run service that renders the printed-edition `/print` route to a
print-ready PDF via headless Chromium. **Isolated from the Medusa commerce backend.**

## What talks to what
```
Builder "⬇ Descargar PDF"
  → GET /api/admin/print/editions/[id]/pdf   (Vercel, secret-gated)
  → POST {url} to PRINT_PDF_URL/pdf          (this Cloud Run service, x-internal-secret)
  → Chromium loads SITE_URL/admin/print/[id]/print?secret=ADMIN_SECRET
  → page.pdf({ preferCSSPageSize, printBackground }) → PDF streamed back to the browser
```

## One-time deploy (region us-east4, project = the existing GCP project)

```bash
PROJECT=$(gcloud config get-value project)
REGION=us-east4
REPO=print            # Artifact Registry repo (create once)
SECRET=$(openssl rand -hex 24)   # PRINT_PDF_SECRET — share with Vercel (below)

# 1. Artifact Registry repo (skip if it exists)
gcloud artifacts repositories create $REPO --repository-format=docker --location=$REGION 2>/dev/null || true

# 2. Build + push the image (build context = this directory)
IMAGE=$REGION-docker.pkg.dev/$PROJECT/$REPO/print-pdf:latest
gcloud builds submit apps/miyagisanchez/services/print-pdf --tag $IMAGE

# 3. Deploy to Cloud Run (1 vCPU / 1Gi is plenty; min-instances 0 = scale to zero)
gcloud run deploy print-pdf \
  --image $IMAGE --region $REGION \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --timeout 120 --concurrency 2 \
  --set-env-vars PRINT_PDF_SECRET=$SECRET

echo "PRINT_PDF_SECRET=$SECRET"
gcloud run services describe print-pdf --region $REGION --format='value(status.url)'   # = PRINT_PDF_URL
```

> `--allow-unauthenticated` is safe: the route itself is gated by `x-internal-secret`
> (`PRINT_PDF_SECRET`). Tighten to IAM-only + an ID token later if desired.

## Vercel env (production)
- `PRINT_PDF_URL` = the Cloud Run service URL from step 3
- `PRINT_PDF_SECRET` = the `$SECRET` from step 3
- (`ADMIN_SECRET` + `NEXT_PUBLIC_SITE_URL` already set)

Until both are set, the builder's "⬇ Descargar PDF" returns a clear 503 ("Servicio
PDF no configurado") — the rest of the builder is unaffected.

## Redeploy after code changes
```bash
gcloud builds submit apps/miyagisanchez/services/print-pdf --tag $IMAGE
gcloud run deploy print-pdf --image $IMAGE --region $REGION
```

## Local smoke test
```bash
docker build -t print-pdf apps/miyagisanchez/services/print-pdf
docker run -e PRINT_PDF_SECRET=dev -p 8088:8080 print-pdf
curl -s -X POST localhost:8088/pdf -H 'x-internal-secret: dev' \
  -H 'content-type: application/json' -d '{"url":"https://example.com"}' -o out.pdf
file out.pdf   # → PDF document
```
