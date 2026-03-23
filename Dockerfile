# Headed Playwright + Xvfb for Cloudflare-friendly automation (virtual display, not headless)
# Railway: set root directory to repo root; builder uses Dockerfile automatically when present.
# Env: USE_XVFB_HEADED=true (set below); PORT from Railway

FROM mcr.microsoft.com/playwright:v1.57.0-jammy

USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
# Skip postinstall browser download — base image already includes Chromium for this Playwright version
RUN npm ci --omit=dev --ignore-scripts

COPY . .

RUN chmod +x scripts/start-with-xvfb.sh

# Match Playwright version in image; browsers are preinstalled in base image
ENV NODE_ENV=production
ENV USE_XVFB_HEADED=true
# xvfb-run assigns DISPLAY automatically
EXPOSE 3000

CMD ["./scripts/start-with-xvfb.sh"]
