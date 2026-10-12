# JuFlow Mobile Apps - Vercel Deployment Guide

**Created:** October 12, 2026  
**Purpose:** Deploy mobile PWAs to Vercel for production hosting  
**Time Required:** 20-30 minutes  

---

## Overview

This guide deploys both JuFlow Mobile PWAs (Cashier and Rider apps) to Vercel with:
- Custom domains
- Environment variables
- Automatic deployments
- Preview deployments for testing
- Production-ready configuration

---

## Prerequisites

- [ ] Vercel account (free tier works)
- [ ] Vercel CLI: `npm install -g vercel`
- [ ] Git repository with mobile apps
- [ ] Backend API deployed (Railway URL)

---

## Step 1: Prepare Repository

### 1.1 Copy Mobile Apps to Repository

```bash
# Navigate to your frontend repository
cd path/to/JuFlow-UI

# Create Mobile directory if it doesn't exist
mkdir -p Mobile

# Copy all mobile app files
cp -r "C:\Users\Administrator\Downloads\JUFLOW\JuFlow-UI (1)\Mobile"/* ./Mobile/

# Verify structure
ls Mobile/
# Should show: cashier/ rider/ shared/ icons/ *.md
```

### 1.2 Create Vercel Configuration

Create `vercel.json` in repository root:

```json
{
  "version": 2,
  "name": "juflow-mobile",
  "builds": [
    {
      "src": "Mobile/**",
      "use": "@vercel/static"
    }
  ],
  "routes": [
    {
      "src": "/cashier/(.*)",
      "dest": "/Mobile/cashier/$1"
    },
    {
      "src": "/rider/(.*)",
      "dest": "/Mobile/rider/$1"
    },
    {
      "src": "/cashier",
      "dest": "/Mobile/cashier/index.html"
    },
    {
      "src": "/rider",
      "dest": "/Mobile/rider/index.html"
    }
  ],
  "headers": [
    {
      "source": "/Mobile/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    },
    {
      "source": "/Mobile/*/sw.js",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        },
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        }
      ]
    },
    {
      "source": "/Mobile/*/manifest.webmanifest",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/manifest+json"
        }
      ]
    }
  ]
}
```

### 1.3 Create Environment Configuration

Create `Mobile/.env.production`:

```bash
# Backend API URL (Railway deployment)
VITE_API_BASE_URL=https://juflow-backend-production.up.railway.app

# Or use environment variable in Vercel dashboard
# NEXT_PUBLIC_API_URL for Next.js
# VITE_API_URL for Vite
# REACT_APP_API_URL for Create React App
```

---

## Step 2: Update Frontend for Production

### 2.1 Update API Base URL

In `Mobile/shared/utils.js`, add:

```javascript
// API Configuration
const API_BASE_URL = (() => {
  // Production: Use environment variable or fallback
  if (typeof process !== 'undefined' && process.env.VITE_API_BASE_URL) {
    return process.env.VITE_API_BASE_URL;
  }
  
  // Development: Localhost
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8000';
  }
  
  // Staging: Use staging backend
  if (window.location.hostname.includes('vercel.app')) {
    return 'https://juflow-backend-staging.up.railway.app';
  }
  
  // Production: Use production backend
  return 'https://api.jukitchen.ph';
})();

// Export for use in other files
window.API_BASE_URL = API_BASE_URL;
```

Update all API calls in `cashier/app.js` and `rider/app.js` to use:

```javascript
const response = await fetch(`${window.API_BASE_URL}/api/endpoint`, {
  // ...
});
```

### 2.2 Update Service Workers

In both `Mobile/cashier/sw.js` and `Mobile/rider/sw.js`, update the cache name:

```javascript
const CACHE_VERSION = 'v1.0.0-production';
const CACHE_NAME = `juflow-cashier-${CACHE_VERSION}`; // or rider
```

### 2.3 Update Manifest Files

In `Mobile/cashier/manifest.webmanifest`:

```json
{
  "name": "JuFlow Cashier",
  "short_name": "Cashier",
  "start_url": "/cashier/",
  "scope": "/cashier/",
  "id": "/cashier/",
  "display": "standalone",
  "background_color": "#bc5125",
  "theme_color": "#bc5125",
  "icons": [
    {
      "src": "/Mobile/icons/cashier-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/Mobile/icons/cashier-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/Mobile/icons/cashier-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Similar updates for `Mobile/rider/manifest.webmanifest` with rider theme color `#39735b`.

---

## Step 3: Deploy to Vercel

### 3.1 Login to Vercel

```bash
vercel login
```

### 3.2 Link Project

```bash
cd path/to/JuFlow-UI
vercel link
```

Choose:
- Scope: Your account/team
- Link to existing project or create new
- Project name: `juflow-mobile`

### 3.3 Deploy to Preview

```bash
vercel
```

This creates a preview deployment. You'll get a URL like:
```
https://juflow-mobile-abc123.vercel.app
```

### 3.4 Test Preview Deployment

```bash
# Test cashier app
curl -I https://juflow-mobile-abc123.vercel.app/cashier/

# Test rider app
curl -I https://juflow-mobile-abc123.vercel.app/rider/

# Should return 200 OK
```

Open in browser:
- https://juflow-mobile-abc123.vercel.app/cashier/
- https://juflow-mobile-abc123.vercel.app/rider/

### 3.5 Deploy to Production

```bash
vercel --prod
```

Production URL:
```
https://juflow-mobile.vercel.app
```

---

## Step 4: Configure Environment Variables

### 4.1 Set via Vercel CLI

```bash
vercel env add VITE_API_BASE_URL production
# Paste: https://juflow-backend-production.up.railway.app

vercel env add VITE_API_BASE_URL preview
# Paste: https://juflow-backend-staging.up.railway.app

vercel env add VITE_API_BASE_URL development
# Paste: http://localhost:8000
```

### 4.2 Set via Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Select `juflow-mobile` project
3. Settings → Environment Variables
4. Add:
   - Key: `VITE_API_BASE_URL`
   - Value: `https://juflow-backend-production.up.railway.app`
   - Environments: Production, Preview, Development

### 4.3 Redeploy After Adding Variables

```bash
vercel --prod
```

---

## Step 5: Configure Custom Domains

### 5.1 Add Production Domain

```bash
vercel domains add cashier.jukitchen.ph
vercel domains add rider.jukitchen.ph
```

Or in Vercel dashboard:
1. Settings → Domains
2. Add domain
3. Follow DNS configuration instructions

### 5.2 Update DNS Records

At your DNS provider (e.g., Cloudflare, Namecheap):

```
Type    Name        Value
CNAME   cashier     cname.vercel-dns.com
CNAME   rider       cname.vercel-dns.com
```

### 5.3 Wait for DNS Propagation

Check status:
```bash
dig cashier.jukitchen.ph
dig rider.jukitchen.ph
```

Should resolve to Vercel's servers (5-30 minutes).

### 5.4 Verify SSL Certificate

Vercel automatically provisions SSL via Let's Encrypt.

Test:
```bash
curl -I https://cashier.jukitchen.ph
curl -I https://rider.jukitchen.ph
```

Should return `200 OK` with SSL headers.

---

## Step 6: Configure Redirects

### 6.1 Update vercel.json

Add redirects for clean URLs:

```json
{
  "redirects": [
    {
      "source": "/",
      "destination": "/cashier/",
      "permanent": false
    }
  ],
  "rewrites": [
    {
      "source": "/cashier",
      "destination": "/Mobile/cashier/index.html"
    },
    {
      "source": "/cashier/:path*",
      "destination": "/Mobile/cashier/:path*"
    },
    {
      "source": "/rider",
      "destination": "/Mobile/rider/index.html"
    },
    {
      "source": "/rider/:path*",
      "destination": "/Mobile/rider/:path*"
    }
  ]
}
```

### 6.2 Redeploy

```bash
vercel --prod
```

---

## Step 7: Enable Git Integration

### 7.1 Connect GitHub Repository

In Vercel dashboard:
1. Project Settings → Git
2. Connect Git Repository
3. Choose: `your-org/JuFlow-UI`

### 7.2 Configure Automatic Deployments

Settings:
- Production Branch: `main`
- Deploy Previews: All branches
- Auto-merge: Disabled (manual approval)

### 7.3 Test Automatic Deployment

```bash
# Make a change
echo "# Test" >> Mobile/README.md

# Commit and push
git add .
git commit -m "Test automatic deployment"
git push origin main

# Vercel automatically deploys
```

Check deployment status:
```bash
vercel ls
```

---

## Step 8: Configure Build Settings

### 8.1 Update Build Command (if using build step)

In Vercel dashboard → Settings → Build & Development:

```
Build Command: npm run build (if applicable)
Output Directory: Mobile
Install Command: npm install (if needed)
```

For static files (current setup):
```
Build Command: (leave empty)
Output Directory: Mobile
Install Command: (leave empty)
```

### 8.2 Add Build Script (Optional)

If you want to minify/optimize files:

Create `package.json`:

```json
{
  "name": "juflow-mobile",
  "version": "1.0.0",
  "scripts": {
    "build": "echo 'Static files - no build needed'",
    "deploy": "vercel --prod"
  }
}
```

---

## Step 9: Configure Security Headers

### 9.1 Add Security Headers to vercel.json

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        },
        {
          "key": "Permissions-Policy",
          "value": "geolocation=(self), camera=(), microphone=()"
        },
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://juflow-backend-production.up.railway.app; worker-src 'self' blob:;"
        }
      ]
    }
  ]
}
```

### 9.2 Redeploy

```bash
vercel --prod
```

---

## Step 10: Test Production Deployment

### 10.1 Manual Testing

Open in multiple browsers:
- Chrome: https://cashier.jukitchen.ph
- Firefox: https://cashier.jukitchen.ph
- Safari: https://cashier.jukitchen.ph
- Edge: https://cashier.jukitchen.ph

Verify:
- [ ] Page loads correctly
- [ ] Icons display properly
- [ ] Install prompt appears
- [ ] Service worker registers
- [ ] API calls work
- [ ] Offline mode works

### 10.2 Lighthouse Audit

```bash
# Install Lighthouse CLI
npm install -g lighthouse

# Run audit
lighthouse https://cashier.jukitchen.ph --view

# Target scores:
# Performance: 90+
# Accessibility: 100
# Best Practices: 90+
# SEO: 90+
# PWA: 100
```

### 10.3 Mobile Device Testing

Test on real devices:
- Android phone (Chrome)
- iPhone (Safari)

Verify:
- [ ] Responsive layout
- [ ] Touch targets work
- [ ] Install to home screen
- [ ] Standalone mode
- [ ] Safe area insets
- [ ] GPS works (rider app)

---

## Step 11: Configure Analytics (Optional)

### 11.1 Vercel Analytics

Enable in dashboard:
1. Project Settings → Analytics
2. Enable Vercel Analytics
3. Add to both apps

### 11.2 Google Analytics (Optional)

Add to `Mobile/cashier/index.html` and `Mobile/rider/index.html`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

---

## Step 12: Set Up Monitoring

### 12.1 Vercel Deployment Notifications

Configure in dashboard:
1. Settings → Notifications
2. Add webhook for Slack/Discord
3. Choose events:
   - Deployment succeeded
   - Deployment failed
   - Deployment ready

### 12.2 Uptime Monitoring

Use external service (e.g., UptimeRobot, Pingdom):

Monitor:
- https://cashier.jukitchen.ph/health (add health check endpoint)
- https://rider.jukitchen.ph/health

Alert if down for > 2 minutes.

---

## Troubleshooting

### Issue: 404 Not Found

**Error:** Apps return 404

**Fix:**
Check `vercel.json` routes:
```json
{
  "rewrites": [
    { "source": "/cashier", "destination": "/Mobile/cashier/index.html" }
  ]
}
```

Redeploy:
```bash
vercel --prod
```

### Issue: Service Worker Not Loading

**Error:** `Service worker registration failed`

**Fix:**
1. Verify `Service-Worker-Allowed` header in `vercel.json`
2. Check service worker scope matches manifest
3. Clear browser cache and retry

### Issue: Icons Not Displaying

**Error:** Install prompt shows broken icons

**Fix:**
1. Verify icon paths in manifest:
   ```
   /Mobile/icons/cashier-192.png (not /icons/...)
   ```
2. Check icons folder is included in deployment:
   ```bash
   vercel ls --verbose
   ```

### Issue: API Calls Fail (CORS)

**Error:** `CORS policy blocked`

**Fix:**
1. Verify Railway backend has correct ALLOWED_ORIGINS:
   ```bash
   railway variables --set ALLOWED_ORIGINS="https://cashier.jukitchen.ph,https://rider.jukitchen.ph"
   ```
2. Restart Railway service:
   ```bash
   railway up
   ```

### Issue: Environment Variables Not Loading

**Error:** `API_BASE_URL is undefined`

**Fix:**
1. Check variables are set in Vercel:
   ```bash
   vercel env ls
   ```
2. Redeploy after adding variables:
   ```bash
   vercel --prod
   ```

---

## Deployment Checklist

Before going live:

- [ ] Both apps deploy successfully
- [ ] Custom domains configured and SSL active
- [ ] Environment variables set correctly
- [ ] API calls work (test with real backend)
- [ ] Icons display in install prompt
- [ ] Service workers register correctly
- [ ] Offline mode works
- [ ] Lighthouse scores > 90
- [ ] Tested on Android device
- [ ] Tested on iOS device
- [ ] Security headers configured
- [ ] Analytics enabled
- [ ] Monitoring configured
- [ ] Team has Vercel dashboard access
- [ ] Git integration working
- [ ] Preview deployments working

---

## Cost Estimate

**Vercel Hobby (Free):**
- 100 GB bandwidth/month
- Unlimited deployments
- Automatic SSL
- Suitable for small production

**Vercel Pro ($20/month):**
- 1 TB bandwidth
- Team collaboration
- Custom deployment regions
- Priority support

---

## Next Steps After Deployment

1. **Run TESTING_PLAN.md** - Test all features
2. **Monitor for 48 hours** - Check analytics
3. **Gather user feedback** - Beta testing
4. **Optimize performance** - Based on real metrics
5. **Set up CD pipeline** - Automated testing + deployment

---

## Useful Commands

```bash
# Deploy preview
vercel

# Deploy production
vercel --prod

# Check deployments
vercel ls

# View logs
vercel logs [deployment-url]

# Remove deployment
vercel rm [deployment-name]

# Open dashboard
vercel inspect [deployment-url]

# Check domains
vercel domains ls
```

---

## Support Resources

- Vercel Docs: https://vercel.com/docs
- Vercel CLI: https://vercel.com/docs/cli
- JuFlow Docs: See MASTER_INDEX.md

---

**Deployment guide complete. Follow these steps to deploy PWAs to Vercel in ~30 minutes.**

**Status:** ✅ Ready to deploy  
**Updated:** October 12, 2026  
**Version:** 1.0  
