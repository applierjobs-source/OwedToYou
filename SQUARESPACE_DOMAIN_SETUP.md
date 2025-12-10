# Connecting Squarespace Domain to Railway

## Step 1: Get Railway Domain Information

1. Go to your Railway project dashboard
2. Click on your service
3. Go to **Settings** → **Networking**
4. You'll see your Railway-generated domain (e.g., `your-app.up.railway.app`)
5. Click **"Custom Domain"** or **"Add Domain"**
6. Enter your Squarespace domain (e.g., `yourdomain.com` or `www.yourdomain.com`)
7. Railway will show you the DNS records you need to add

## Step 2: Configure DNS in Squarespace

### Option A: Using Squarespace DNS (Recommended)

1. Log in to your Squarespace account
2. Go to **Settings** → **Domains**
3. Click on your domain
4. Go to **DNS Settings** (or **Advanced DNS Settings**)
5. You'll see existing DNS records

### For Root Domain (yourdomain.com):

**If Squarespace supports CNAME flattening/ALIAS:**
- Add a **CNAME** record:
  - **Host**: `@` (or leave blank for root domain)
  - **Points to**: Railway's CNAME target (e.g., `cname.railway.app` or similar)
  - **TTL**: 3600 (or default)

**If Squarespace doesn't support CNAME for root domain:**
- Add an **A Record**:
  - **Host**: `@` (or leave blank)
  - **Points to**: Railway's IP address (Railway will provide this)
  - **TTL**: 3600

### For WWW Subdomain (www.yourdomain.com):

- Add a **CNAME** record:
  - **Host**: `www`
  - **Points to**: Railway's CNAME target (e.g., `cname.railway.app` or your Railway domain)
  - **TTL**: 3600

## Step 3: Verify in Railway

1. After adding DNS records in Squarespace, go back to Railway
2. Railway will automatically detect when DNS is configured correctly
3. It may take a few minutes to 48 hours for DNS to propagate
4. Railway will automatically provision an SSL certificate once DNS is verified

## Important Notes:

- **DNS Propagation**: Can take 5 minutes to 48 hours, but usually within 1-2 hours
- **SSL Certificate**: Railway automatically provides HTTPS/SSL certificates
- **Both www and non-www**: You can add both `yourdomain.com` and `www.yourdomain.com` in Railway
- **Squarespace Hosting**: If you're also using Squarespace for hosting, you may need to disable it or use subdomain routing

## Troubleshooting:

- **Domain not connecting**: Wait for DNS propagation, check that records match exactly what Railway shows
- **SSL not working**: Wait for Railway to provision the certificate (usually automatic after DNS verification)
- **Still seeing Squarespace site**: Clear your browser cache or check DNS with `dig yourdomain.com` or `nslookup yourdomain.com`

## Railway Domain Settings:

In Railway, you can:
- Add multiple domains (both www and non-www)
- See DNS verification status
- View SSL certificate status
- Get the exact DNS records needed

