#!/bin/bash
set -e

echo "=== Job Search Agent Setup ==="

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Node.js required. Install via: brew install node"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "Python 3.11+ required. Install via: brew install python@3.11"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Dashboard setup
echo "--- Installing dashboard dependencies ---"
cd "$ROOT_DIR/dashboard"
npm install

# Crawler setup
echo "--- Setting up Python virtual environment ---"
cd "$ROOT_DIR/crawler"
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium

# Create logs directory
mkdir -p "$ROOT_DIR/crawler/logs"

# Check env files
if [ ! -f "$ROOT_DIR/.env.local" ] || grep -q "your-" "$ROOT_DIR/.env.local"; then
  echo ""
  echo "WARNING: Please update .env.local with your actual keys:"
  echo "  - NEXT_PUBLIC_SUPABASE_URL"
  echo "  - NEXT_PUBLIC_SUPABASE_ANON_KEY"
  echo "  - SUPABASE_SERVICE_ROLE_KEY"
  echo "  - ANTHROPIC_API_KEY"
fi

if [ ! -f "$ROOT_DIR/crawler/.env" ] || grep -q "your-" "$ROOT_DIR/crawler/.env"; then
  echo ""
  echo "WARNING: Please update crawler/.env with your actual keys:"
  echo "  - SUPABASE_URL"
  echo "  - SUPABASE_SERVICE_KEY"
  echo "  - ANTHROPIC_API_KEY"
fi

echo ""
echo "=== Setup complete! ==="
echo "  Dashboard: cd dashboard && npm run dev"
echo "  Crawler test: cd crawler && python crawl_orchestrator.py --budget 10"
