#!/bin/bash
# Takes the double sidebar out of Claude: puts back Claude's own app.asar and re-signs it locally.
# For Claude exactly as Anthropic shipped it, signature and updates included, download it again.
set -e
cd "$(dirname "$0")"

if pgrep -xq Claude; then
  read -r -p "Claude needs to quit. Quit it now? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing changed."; exit 1; }
  osascript -e 'quit app "Claude"'
  for _ in $(seq 1 30); do pgrep -xq Claude || break; sleep 0.5; done
fi

node patch.mjs --restore
open -a "${CLAUDE_APP:-/Applications/Claude.app}"
