# JuFlow Mobile Apps - Railway Deployment Guide

**Created:** October 12, 2026  
**Purpose:** Step-by-step deployment of backend API to Railway  
**Time Required:** 30-45 minutes  

---

## Overview

This guide walks through deploying the JuFlow Mobile backend API to Railway, connecting it to a PostgreSQL database, and configuring it for production use.

---

## Prerequisites

- [ ] Railway account (free tier works for testing)
- [ ] Railway CLI installed: `npm install -g @railway/cli`
- [ ] Git repository with backend code
- [ ] Database credentials (or will create new)

---

## Step 1: Prepare Backend for Deployment

### 1.1 Copy Backend Code

```bash
# Navigate to your JuFlow backend repository
cd path/to/your/backend-repo

# Copy the reference implementation
cp -r "C:\Users\Administrator\Downloads\JUFLOW\JuFlow-UI (1)\Mobile\backend-scaffold\python-fastapi"/* ./

# Or manually copy these files:
# - main.py
# - requirements.txt
```

### 1.2 Create Railway Configuration

Create `railway.toml` in your backend root:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

### 1.3 Create Procfile (Alternative)

Or create `Procfile`:

```
web: uvicorn main:app --host 0.0.0.0 --port $PORT
```

### 1.4 Update main.py for Production

Add this at the top of `main.py`:

```python
import os

# Production configuration
PORT = int(os.getenv("PORT", 8000))
DATABASE_URL = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    raise ValueError("SECRET_KEY environment variable must be set")
```

Update the uvicorn command at the bottom:

```python
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
```

---

## Step 2: Create Railway Project

### 2.1 Login to Railway

```bash
railway login
```

This opens a browser for authentication.

### 2.2 Initialize Project

```bash
# In your backend directory
railway init

# Choose:
# - Create new project
# - Name: juflow-backend
```

### 2.3 Add PostgreSQL Database

```bash
railway add --plugin postgresql
```

This automatically:
- Creates a PostgreSQL instance
- Sets `DATABASE_URL` environment variable
- Links it to your project

### 2.4 Verify Database Connection

```bash
railway variables
```

Should show:
- `DATABASE_URL` = `postgresql://...`
- Other auto-generated variables

---

## Step 3: Run Database Migrations

### 3.1 Connect to Railway Database

```bash
# Open Railway shell
railway run bash

# Or get DATABASE_URL and connect locally
railway variables | grep DATABASE_URL
```

### 3.2 Run Migration

```bash
# Copy migration file to server (if needed)
railway run psql $DATABASE_URL -f migrations/001_phase2_support.sql

# Or connect locally:
psql "postgresql://user:pass@hostname/db" -f migrations/001_phase2_support.sql
```

### 3.3 Verify Migration

```bash
railway run psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'riders' AND column_name IN ('is_available', 'last_location', 'last_seen');"
```

Expected output:
```
 column_name   
---------------
 is_available
 last_location
 last_seen
```

---

## Step 4: Configure Environment Variables

### 4.1 Set SECRET_KEY

```bash
# Generate a secure secret key
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Set it in Railway
railway variables --set SECRET_KEY="your-generated-key-here"
```

### 4.2 Set CORS Origins

```bash
railway variables --set ALLOWED_ORIGINS="https://juflow.vercel.app,https://juflow-gamma.vercel.app"
```

Update `main.py` to use this:

```python
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 4.3 Verify All Variables

```bash
railway variables
```

Should show:
- `DATABASE_URL`
- `SECRET_KEY`
- `ALLOWED_ORIGINS`
- `PORT` (auto-set by Railway)

---

## Step 5: Deploy

### 5.1 Commit and Push

```bash
git add .
git commit -m "Add JuFlow Mobile API endpoints"
git push
```

### 5.2 Deploy to Railway

```bash
railway up
```

This will:
1. Upload your code
2. Install dependencies from `requirements.txt`
3. Start the server with your start command
4. Assign a public URL

### 5.3 Watch Deployment Logs

```bash
railway logs
```

Wait for:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:PORT
```

### 5.4 Get Your API URL

```bash
railway domain
```

Or check Railway dashboard: `https://railway.app/project/<id>`

Your API will be at: `https://juflow-backend-production.up.railway.app`

---

## Step 6: Test Deployment

### 6.1 Health Check

```bash
curl https://your-app.up.railway.app/api/health
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": "2026-10-12T11:15:00.000Z",
  "version": "2.0.0"
}
```

### 6.2 Test Authentication

```bash
# Should return 401 Unauthorized
curl https://your-app.up.railway.app/api/riders/me
```

### 6.3 Run Full Test Suite

Update `backend-scaffold/test-api.sh`:

```bash
BASE_URL="https://your-app.up.railway.app"
RIDER_TOKEN="<valid-token-from-login>"
CASHIER_TOKEN="<valid-token-from-login>"

bash backend-scaffold/test-api.sh
```

---

## Step 7: Update Frontend Configuration

### 7.1 Update API Base URL

In both `cashier/app.js` and `rider/app.js`, update:

```javascript
// Development
const API_BASE_URL = 'http://localhost:8000';

// Production
const API_BASE_URL = 'https://juflow-backend-production.up.railway.app';

// Better: Use environment detection
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:8000'
  : 'https://juflow-backend-production.up.railway.app';
```

### 7.2 Deploy Frontend to Vercel

```bash
cd path/to/JuFlow-UI
vercel --prod
```

---

## Step 8: Configure Custom Domain (Optional)

### 8.1 Add Custom Domain in Railway

```bash
railway domain add api.jukitchen.ph
```

Or in Railway dashboard:
1. Go to Settings → Domains
2. Add custom domain
3. Copy CNAME record

### 8.2 Update DNS

Add CNAME record at your DNS provider:
```
api.jukitchen.ph → your-app.up.railway.app
```

### 8.3 Wait for SSL

Railway automatically provisions SSL certificates via Let's Encrypt (5-10 minutes).

---

## Step 9: Monitoring & Logs

### 9.1 View Real-time Logs

```bash
railway logs --follow
```

### 9.2 View Metrics

Railway dashboard shows:
- CPU usage
- Memory usage
- Request count
- Response times
- Error rates

### 9.3 Set Up Alerts (Optional)

In Railway dashboard:
1. Settings → Notifications
2. Add webhook for Slack/Discord
3. Configure alert thresholds

---

## Step 10: Security Hardening

### 10.1 Enable HTTPS Only

Railway does this automatically. Verify:

```bash
curl -I http://your-app.up.railway.app
# Should redirect to https://
```

### 10.2 Add Rate Limiting

Already implemented in `main.py` for location updates.

For global rate limiting, add:

```bash
railway add --plugin redis
```

Then implement Redis-based rate limiting in `main.py`.

### 10.3 Add Security Headers

Update `main.py`:

```python
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware

# In production only
if os.getenv("RAILWAY_ENVIRONMENT") == "production":
    app.add_middleware(HTTPSRedirectMiddleware)
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["*.railway.app", "api.jukitchen.ph"]
    )
```

---

## Step 11: Database Backups

### 11.1 Enable Automatic Backups

Railway Pro plan includes automatic daily backups.

Free tier: Set up manual backup cron:

```bash
# Local backup script
#!/bin/bash
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### 11.2 Verify Backup

```bash
railway run psql $DATABASE_URL -c "\dt"
```

---

## Step 12: Scaling (When Needed)

### 12.1 Vertical Scaling

Railway dashboard:
1. Settings → Resources
2. Increase memory/CPU

### 12.2 Horizontal Scaling

Railway supports multiple instances:

```bash
railway scale --replicas 3
```

Note: Requires Redis for session management.

---

## Troubleshooting

### Issue: Build Fails

**Error:** `Requirements not found`

**Fix:**
```bash
# Ensure requirements.txt is in root
ls requirements.txt

# Check file contents
cat requirements.txt
```

### Issue: Database Connection Fails

**Error:** `connection refused`

**Fix:**
```bash
# Verify DATABASE_URL is set
railway variables | grep DATABASE_URL

# Test connection
railway run psql $DATABASE_URL -c "SELECT 1;"
```

### Issue: Port Binding Error

**Error:** `Address already in use`

**Fix:**
Ensure `main.py` uses `PORT` from environment:

```python
PORT = int(os.getenv("PORT", 8000))
uvicorn.run(app, host="0.0.0.0", port=PORT)
```

### Issue: CORS Errors

**Error:** `CORS policy blocked`

**Fix:**
```bash
# Add frontend URL to ALLOWED_ORIGINS
railway variables --set ALLOWED_ORIGINS="https://juflow.vercel.app"

# Redeploy
railway up
```

---

## Deployment Checklist

Before marking deployment complete:

- [ ] Health check returns 200 OK
- [ ] Database migrations ran successfully
- [ ] All 7 endpoints respond correctly
- [ ] Authentication works (401 without token)
- [ ] Rate limiting works (429 after 60 requests)
- [ ] CORS allows frontend domain
- [ ] HTTPS is enforced
- [ ] Logs show no errors
- [ ] Frontend can connect to API
- [ ] Test suite passes
- [ ] Environment variables secured
- [ ] Database backed up
- [ ] Monitoring enabled
- [ ] Team has access to Railway project

---

## Cost Estimate

**Railway Free Tier:**
- $5 free credit/month
- Enough for development/testing
- ~500 hours of uptime

**Railway Hobby Plan ($5/month):**
- $5 credit + $5/month
- Suitable for production
- ~1000 hours uptime
- Automatic backups

**Railway Pro Plan ($20/month):**
- $20 credit + $20/month
- High availability
- Multiple replicas
- Priority support

---

## Next Steps After Deployment

1. **Run TESTING_PLAN.md** - Comprehensive testing
2. **Monitor for 24 hours** - Check logs and metrics
3. **Load test** - Simulate production traffic
4. **Security audit** - Run OWASP ZAP scan
5. **Document API URL** - Update frontend configuration
6. **Train team** - Share Railway dashboard access

---

## Support Resources

- Railway Docs: https://docs.railway.app
- FastAPI Docs: https://fastapi.tiangolo.com
- JuFlow Mobile Docs: See MASTER_INDEX.md

---

**Deployment guide complete. Follow these steps to deploy backend to Railway in ~45 minutes.**

**Status:** ✅ Ready to deploy  
**Updated:** October 12, 2026  
**Version:** 1.0  
