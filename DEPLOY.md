# Google Cloud Run Deployment

## Prerequisites

1. **Google Cloud SDK installed**:
   ```bash
   brew install google-cloud-sdk
   ```

2. **Google Cloud project with billing enabled**

3. **Docker installed** (for building the container)

---

## Step 1: Authenticate with Google Cloud

```bash
# Login to gcloud
gcloud auth login

# Set your project ID
gcloud config set project YOUR_PROJECT_ID

# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

---

## Step 2: Build and Push Docker Image

From the `tapla-widget` folder:

```bash
# Build the Docker image
docker build -t gcr.io/YOUR_PROJECT_ID/events-api .

# Push to Google Container Registry
docker push gcr.io/YOUR_PROJECT_ID/events-api
```

---

## Step 3: Deploy to Cloud Run

```bash
gcloud run deploy events-api \
  --image gcr.io/YOUR_PROJECT_ID/events-api \
  --platform managed \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars "DATABASE_URL=YOUR_NEON_URL" \
  --set-env-vars "JWT_SECRET=your-secret-key" \
  --set-env-vars "ADMIN_USERNAME=admin" \
  --set-env-vars "ADMIN_PASSWORD=events2026"
```

---

## Step 4: Get Your URL

After deployment, Cloud Run will give you a URL like:
```
https://events-api-xxxx-ew.a.run.app
```

Update your frontend `api.ts` with this URL:
```typescript
export const API_BASE_URL = 'https://events-api-xxxx-ew.a.run.app';
```

---

## Quick Deploy Script

Or run this all-in-one script (after setting your PROJECT_ID):

```bash
PROJECT_ID="your-gcp-project-id"
REGION="europe-west1"

# Build and deploy
gcloud builds submit --tag gcr.io/$PROJECT_ID/events-api ./
gcloud run deploy events-api \
  --image gcr.io/$PROJECT_ID/events-api \
  --region $REGION \
  --platform managed \
  --allow-unauthenticated
```

Then set environment variables in the Cloud Console.

---

## Cost

Cloud Run pricing:
- **Free tier**: 2 million requests/month
- **Beyond**: ~$0.00002 per request
- **Essentially free** for a restaurant booking widget!
