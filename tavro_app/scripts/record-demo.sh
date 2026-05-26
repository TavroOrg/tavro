#!/usr/bin/env bash
# record-demo.sh — Launch Playwright Codegen against the Tavro Portal dev server.
#
# Usage:
#   ./scripts/record-demo.sh                        # record from home page
#   ./scripts/record-demo.sh /catalog               # start on a specific route
#   ./scripts/record-demo.sh /catalog my-test.spec  # custom output filename
#
# Codegen opens a browser + inspector UI. Interact with the app and the
# inspector auto-generates a Playwright test. Close the browser to save.
#
# Prerequisites:
#   - Playwright installed:  npm install
#   - Browsers installed:    npx playwright install chromium
#   - Dev server running on :9000, OR the script will auto-start one.

set -euo pipefail

PORT=9000
BASE_URL="http://localhost:${PORT}"
START_ROUTE="${1:-/}"
OUTPUT_FILE="${2:-tests/e2e/recorded-demo.spec.ts}"

# Check if dev server is already running
if ! curl -sf "${BASE_URL}" > /dev/null 2>&1; then
  echo "Dev server not detected on :${PORT}. Starting it in the background..."
  (cd "$(dirname "$0")/.." && npm run dev &)
  echo "Waiting for dev server..."
  for i in $(seq 1 20); do
    sleep 1
    if curl -sf "${BASE_URL}" > /dev/null 2>&1; then
      echo "Dev server ready."
      break
    fi
    if [ "$i" -eq 20 ]; then
      echo "ERROR: Dev server did not start in time." >&2
      exit 1
    fi
  done
fi

echo ""
echo "Launching Playwright Codegen..."
echo "  Start URL : ${BASE_URL}${START_ROUTE}"
echo "  Output    : ${OUTPUT_FILE}"
echo ""
echo "Tip: In the browser, log in via the UI — Codegen will record the full flow."
echo "     Close the browser window when you're done recording."
echo ""

npx playwright codegen \
  --output "${OUTPUT_FILE}" \
  "${BASE_URL}${START_ROUTE}"

echo ""
echo "Recording saved to: ${OUTPUT_FILE}"
