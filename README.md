# ClaimIt - Unclaimed Funds Finder

A web application that helps users discover unclaimed funds by searching Instagram usernames and checking Missing Money databases.

## Features

- Search Instagram usernames to find profile pictures
- Search Missing Money database for unclaimed funds
- Automated Cloudflare Turnstile solving via 2captcha
- Modern, responsive UI

## Tech Stack

- **Frontend**: HTML, CSS, JavaScript
- **Backend**: Node.js, Express (http server)
- **Automation**: Playwright
- **Captcha Solving**: 2captcha API

## Deployment to Railway

### Prerequisites

1. GitHub account
2. Railway.app account (sign up at https://railway.app)
3. GoDaddy domain (optional, for custom domain)
4. 2captcha API key

### Step 1: Push to GitHub

```bash
# Initialize git if not already done
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit"

# Add your GitHub repository as remote
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push to GitHub
git push -u origin main
```

### Step 2: Deploy to Railway

1. Go to https://railway.app and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository
5. Railway will automatically detect the project and start building

### Step 3: Configure Environment Variables

In Railway dashboard:

1. Go to your project
2. Click on your service
3. Go to "Variables" tab
4. Add the following environment variables:

```
PORT=3000
CAPTCHA_API_KEY=your_2captcha_api_key_here
```

**Note**: Railway will automatically set `PORT`, but you can override it if needed.

### Step 4: Connect Custom Domain (GoDaddy)

1. In Railway, go to your service → Settings → Networking
2. Click "Generate Domain" to get a Railway domain first (for testing)
3. Click "Custom Domain"
4. Enter your domain (e.g., `claimit.com`)
5. Railway will provide DNS records to add:
   - **CNAME**: Point your domain to Railway's provided URL
6. In GoDaddy:
   - Go to DNS Management
   - Add a CNAME record:
     - Name: `@` (or `www` for www subdomain)
     - Value: Railway's provided CNAME target
     - TTL: 3600
7. Wait for DNS propagation (can take a few minutes to 48 hours)

### Step 5: Update Frontend API URLs

The frontend (`script.js`) is already configured to use relative URLs, so it will automatically work with your domain. No changes needed!

## Local Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Start server
npm start

# Server runs on http://localhost:3000
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `CAPTCHA_API_KEY`: Your 2captcha API key

## Project Structure

```
├── index.html          # Main HTML file
├── styles.css          # CSS styles
├── script.js           # Frontend JavaScript
├── server.js           # Backend server
├── missingMoneySearch.js  # Playwright automation script
├── cloudflareSolver.js    # 2captcha integration
└── package.json        # Dependencies
```

## Notes

- Playwright requires Chromium to be installed. This is handled automatically in Railway via the `postinstall` script.
- The 2captcha API key should be kept secret and stored as an environment variable.
- Railway automatically handles HTTPS/SSL certificates for custom domains.

## Troubleshooting

### Playwright not installing on Railway

If Playwright fails to install, Railway may need more build time. Check the build logs and ensure the `postinstall` script runs successfully.

### Domain not connecting

- Verify DNS records in GoDaddy match Railway's requirements
- Wait for DNS propagation (can take up to 48 hours)
- Check Railway's domain status in the dashboard

### API calls failing

- Ensure environment variables are set correctly in Railway
- Check that the server is running (view logs in Railway dashboard)
- Verify CORS settings if making requests from a different domain

