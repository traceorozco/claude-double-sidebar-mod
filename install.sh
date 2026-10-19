#!/bin/bash
# Installs the double sidebar into Claude for Desktop on this Mac. Run it from Terminal, not from a
# Claude session: it quits Claude while it patches. Run it again after every Claude update.
set -e
cd "$(dirname "$0")"

APP="${CLAUDE_APP:-/Applications/Claude.app}"

[ "$(uname)" = Darwin ] || { echo "This only runs on macOS."; exit 1; }
[ -d "$APP" ] || { echo "Claude isn't at $APP. Install it from claude.ai/download first."; exit 1; }
command -v node >/dev/null || { echo "This needs Node.js 18 or newer: nodejs.org"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "This needs Node.js 18 or newer. You have $(node -v)."; exit 1; }
command -v codesign >/dev/null || { echo "This needs Apple's command line tools. Run: xcode-select --install"; exit 1; }

if pgrep -xq Claude; then
  read -r -p "Claude needs to quit while it's patched. Quit it now? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing changed."; exit 1; }
  osascript -e 'quit app "Claude"'
  for _ in $(seq 1 30); do pgrep -xq Claude || break; sleep 0.5; done
  pgrep -xq Claude && { echo "Claude is still open. Quit it and run this again."; exit 1; }
fi

# the final build only: --dev opens a debug port and is for working on the sidebar itself
node patch.mjs

echo "Opening Claude. If macOS asks about \"Claude Safe Storage\", choose Always Allow."
open -a "$APP"
