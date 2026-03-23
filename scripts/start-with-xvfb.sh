#!/usr/bin/env bash
# Virtual display for headed Chromium (Cloudflare-friendly) on servers without a monitor.
# Railway/Docker: USE_XVFB_HEADED=true + this script as CMD.

set -euo pipefail

export USE_XVFB_HEADED="${USE_XVFB_HEADED:-true}"

echo "[XVFB] Starting via xvfb-run (headed Chromium, USE_XVFB_HEADED=$USE_XVFB_HEADED)"
exec xvfb-run -a -s "-screen 0 1920x1080x24 -ac -nolisten tcp" node server.js
