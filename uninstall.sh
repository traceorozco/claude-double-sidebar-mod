#!/bin/bash
# Takes the double sidebar out of Claude: puts back Claude's own app.asar, re-signs it locally, and removes
# the sidebar file. For Claude exactly as Anthropic shipped it, signature and updates included, download it
# again from claude.ai/download.
#
#   ./uninstall.sh                 uninstall, asking before it quits Claude; keeps the icon fonts
#   ./uninstall.sh --yes           without asking
#   ./uninstall.sh --remove-fonts  also remove the icon fonts. Section and session names that hold icons
#                                  then show empty boxes where the icons were
set -e
cd "$(dirname "$0")"

APP="${CLAUDE_APP:-/Applications/Claude.app}"
YES=false; FONTS=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=true ;;
    --remove-fonts) FONTS=true ;;
    *) echo "Unknown option: $arg (use --yes or --remove-fonts)"; exit 1 ;;
  esac
done

if pgrep -xq Claude; then
  if ! $YES; then
    read -r -p "Claude needs to quit. Quit it now? [y/N] " answer
    [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing changed."; exit 1; }
  fi
  osascript -e 'quit app "Claude"'
  for _ in $(seq 1 30); do pgrep -xq Claude || break; sleep 0.5; done
fi

node patch.mjs --restore
rm -rf "$HOME/Library/Application Support/ClaudeDoubleSidebar"
if $FONTS; then
  rm -f "$HOME"/Library/Fonts/CCSidebarIcons*.ttf
  echo "Removed the icon fonts."
fi
open -a "$APP"
