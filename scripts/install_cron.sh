#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.dawson.jobcrawler.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.dawson.jobcrawler.plist"

# Unload if already loaded
if launchctl list | grep -q com.dawson.jobcrawler; then
  echo "Unloading existing job..."
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi

# Copy plist
cp "$PLIST_SRC" "$PLIST_DST"
echo "Installed plist to $PLIST_DST"

# Load
launchctl load "$PLIST_DST"
echo "Loaded com.dawson.jobcrawler"

# Verify
if launchctl list | grep -q com.dawson.jobcrawler; then
  echo "Verified: job crawler scheduled for 1:00 AM nightly"
  echo ""
  echo "Useful commands:"
  echo "  Check status:  launchctl list | grep jobcrawler"
  echo "  Run now:       launchctl start com.dawson.jobcrawler"
  echo "  Unload:        launchctl unload $PLIST_DST"
  echo "  View logs:     tail -f ~/u01/search/crawler/logs/launchd_stdout.log"
else
  echo "ERROR: Failed to load job"
  exit 1
fi
