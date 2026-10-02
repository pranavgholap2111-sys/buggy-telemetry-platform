# Free Hosting Options

This guide covers realistic options for hosting your Buggy Telemetry Platform for free. Each option includes honest caveats about limitations.

## Option 1: Oracle Cloud Free Tier (Recommended)

**What you get**:
- 2 AMD Compute VMs with 1 GB RAM each (or 1 VM with 24 GB RAM ARM)
- 200 GB storage
- 10 TB outbound bandwidth/month
- **Always free** (not 12-month trial)

**How to deploy**:
1. Sign up at https://www.oracle.com/cloud/free/
2. Create a VM (Ubuntu 22.04 recommended)
3. Install Docker and Docker Compose
4. Clone your repo and run `docker compose up -d`
5. Open firewall ports: 1883 (MQTT), 3000 (dashboard), 4000 (API)
6. Set up a domain or use the VM's public IP

**Pros**:
- Most generous free tier available
- Full VM access (install anything)
- No cold starts or sleep issues
- Can run all services (Mosquitto, PostgreSQL, Node.js, Python)

**Cons**:
- Requires Linux knowledge
- Oracle's UI is confusing
- Sign-up can be picky about credit cards (even for free tier)
- ARM instances are powerful but harder to find available

**Best for**: Full deployment with all features working

---

## Option 2: Railway.app

**What you get**:
- $5 free credit/month (no credit card required)
- Easy deployment from GitHub
- Managed PostgreSQL database
- Automatic HTTPS

**How to deploy**:
1. Sign up at https://railway.app/
2. Connect your GitHub repo
3. Create a new project
4. Add services:
   - PostgreSQL (managed)
   - Mosquitto (Docker image)
   - Node.js ingest (auto-detected)
   - Python worker (auto-detected)
   - React frontend (auto-detected)
5. Set environment variables in Railway dashboard
6. Deploy

**Pros**:
- Very easy to set up
- No server management
- Automatic HTTPS
- Good documentation

**Cons**:
- $5/month credit might not be enough for heavy usage
- Services sleep after inactivity (cold starts)
- Limited control over infrastructure
- WebSocket support can be tricky

**Best for**: Quick demo or small-scale deployment

---

## Option 3: Render.com

**What you get**:
- Free web services (spin down after 15 min inactivity)
- Free PostgreSQL database (90 days, then paid)
- Automatic HTTPS
- Deploy from GitHub

**How to deploy**:
1. Sign up at https://render.com/
2. Create a new Web Service for each component
3. Connect your GitHub repo
4. Configure build and start commands
5. Add environment variables
6. Deploy

**Pros**:
- Easy GitHub integration
- Automatic HTTPS
- Good free tier for web services

**Cons**:
- Services spin down after 15 minutes (cold start delay)
- PostgreSQL free tier expires after 90 days
- Can't run Mosquitto easily (no persistent background services)
- WebSocket support requires paid plan

**Best for**: Frontend-only deployment (dashboard connects to external backend)

---

## Option 4: Fly.io

**What you get**:
- 3 shared-cpu-1x VMs with 256 MB RAM
- 3 GB persistent storage
- 160 GB outbound bandwidth/month
- Automatic HTTPS

**How to deploy**:
1. Install Fly CLI: `powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"`
2. Sign up: `fly auth signup`
3. Create app: `fly launch`
4. Configure `fly.toml` for each service
5. Deploy: `fly deploy`

**Pros**:
- Global edge deployment
- Persistent storage
- Good free tier
- Docker-native

**Cons**:
- Requires learning Fly CLI
- Configuration can be complex
- Limited RAM (256 MB per VM)
- PostgreSQL requires paid plan for persistence

**Best for**: Distributed deployment with global users

---

## Option 5: Vercel (Frontend Only)

**What you get**:
- Free hosting for React/Next.js apps
- Automatic HTTPS
- Global CDN
- 100 GB bandwidth/month

**How to deploy**:
1. Sign up at https://vercel.com/
2. Import your GitHub repo
3. Vercel auto-detects React/Vite
4. Deploy

**Pros**:
- Easiest frontend deployment
- Excellent performance (global CDN)
- Automatic HTTPS
- Preview deployments for branches

**Cons**:
- Frontend only (no backend)
- Must host backend elsewhere
- Serverless functions have limitations
- No persistent storage

**Best for**: Dashboard frontend only (connect to backend hosted elsewhere)

---

## Option 6: GitHub Pages (Frontend Only)

**What you get**:
- Free static site hosting
- Automatic HTTPS
- Custom domain support

**How to deploy**:
1. Build your React app: `npm run build`
2. Push `dist/` folder to `gh-pages` branch
3. Enable GitHub Pages in repo settings

**Pros**:
- Completely free
- Integrated with GitHub
- Easy to set up

**Cons**:
- Static sites only (no backend)
- No server-side logic
- Must host backend elsewhere
- Limited to 1 GB storage

**Best for**: Static documentation or demo pages

---

## Recommended Approach

### For Learning/Demo (Easiest)

1. **Frontend**: Vercel (free, easy)
2. **Backend**: Oracle Cloud free tier VM
3. **Database**: PostgreSQL on the same VM

**Total cost**: $0  
**Setup time**: 2-3 hours

### For Production (Most Robust)

1. **Everything**: Oracle Cloud free tier VM
2. Run all services in Docker on one VM
3. Use nginx as reverse proxy for HTTPS

**Total cost**: $0  
**Setup time**: 3-4 hours

### For Quick Demo (Fastest)

1. **Everything**: Railway.app
2. Deploy all services from GitHub
3. Use managed PostgreSQL

**Total cost**: $0 (within $5 credit)  
**Setup time**: 30 minutes

---

## What NOT to Do

❌ **Heroku**: Free tier discontinued (November 2022)  
❌ **AWS Free Tier**: Only free for 12 months, then expensive  
❌ **Google Cloud Free Tier**: Only free for 12 months, limited resources  
❌ **PythonAnywhere**: Can't run Docker or background workers on free tier  
❌ **Glitch**: Services sleep after 5 minutes, not suitable for real-time

---

## Security Checklist for Production

Before deploying to any cloud platform:

- [ ] Change all default passwords (PostgreSQL, MQTT)
- [ ] Generate a new JWT secret (not the dev one)
- [ ] Enable HTTPS (use Let's Encrypt or platform's auto-HTTPS)
- [ ] Set up firewall rules (only open needed ports)
- [ ] Enable MQTT authentication (username/password)
- [ ] Use environment variables for all secrets (never commit .env)
- [ ] Set up automated backups for PostgreSQL
- [ ] Enable rate limiting on API endpoints
- [ ] Add request logging for debugging
- [ ] Test all features in production environment

---

## Cost Estimation

For a typical usage pattern (1 buggy, 8 hours/day, 5 Hz):

| Resource | Usage | Free Tier Limit | Status |
|---|---|---|---|
| Database storage | ~50 MB/month | 200 GB (Oracle) | ✅ Plenty |
| Bandwidth | ~2 GB/month | 10 TB (Oracle) | ✅ Plenty |
| CPU | Low (intermittent) | 4 OCPU (Oracle) | ✅ Plenty |
| RAM | ~500 MB total | 24 GB (Oracle ARM) | ✅ Plenty |

**Verdict**: You can run this platform for **years** on Oracle's free tier without hitting limits.

---

## Migration Guide

### From Local to Oracle Cloud

1. Create Oracle Cloud account and VM
2. Install Docker on VM
3. Clone your repo
4. Update `.env` files with production values
5. Run `docker compose up -d`
6. Open firewall ports
7. Test from external network

### From Local to Railway

1. Push code to GitHub
2. Connect repo to Railway
3. Add PostgreSQL service
4. Set environment variables
5. Deploy each service
6. Update frontend API URL to Railway domain
7. Test

---

## Getting Help

- **Oracle Cloud**: https://forums.oracle.com/ords/apexds/community/oci-free-tier
- **Railway**: https://docs.railway.app/
- **Render**: https://render.com/docs
- **Fly.io**: https://fly.io/docs/
- **Vercel**: https://vercel.com/docs

---

## Final Advice

**Start with Oracle Cloud Free Tier**. It's the most generous, most flexible, and most realistic option for a project like this. Yes, it requires more setup than Railway or Render, but you'll learn valuable Linux and deployment skills, and you won't hit any limits.

If you just want a quick demo to show someone, use Railway — you can be deployed in 30 minutes.

If you only want to host the frontend (dashboard), use Vercel — it's the easiest and fastest.

**Whatever you choose, make sure to:**
1. Test thoroughly before going live
2. Monitor your usage (set up alerts)
3. Keep backups
4. Document your deployment process

Good luck! 🚀
