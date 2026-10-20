#!/bin/bash
# Installs or updates the double sidebar in Claude for Desktop on this Mac. Started inside Claude for
# Desktop, it moves to a Terminal window when it has to quit Claude.
# The first time, and after each Claude update, it patches Claude (and quits it while it does). Any other
# time it only replaces the sidebar file, and Claude stays open.
#
#   ./install.sh          install or update, asking before it quits Claude
#   ./install.sh --plan   list every change it would make, and change nothing
#   ./install.sh --yes    install or update without asking (quits Claude if it needs to)
set -e
cd "$(dirname "$0")"

APP="${CLAUDE_APP:-/Applications/Claude.app}"
YES=false; PLAN=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y) YES=true ;;
    --plan) PLAN=true ;;
    *) echo "Unknown option: $arg (use --plan or --yes)"; exit 1 ;;
  esac
done

[ "$(uname)" = Darwin ] || { echo "This only runs on macOS."; exit 1; }
[ -d "$APP" ] || { echo "Claude isn't at $APP. Install it from claude.ai/download first."; exit 1; }
command -v node >/dev/null || { echo "This needs Node.js 18 or newer: nodejs.org"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || { echo "This needs Node.js 18 or newer. You have $(node -v)."; exit 1; }
command -v codesign >/dev/null || { echo "This needs Apple's command line tools. Run: xcode-select --install"; exit 1; }

if $PLAN; then node patch.mjs --plan; exit 0; fi

# Run from inside Claude for Desktop (by Claude, or in its terminal), quitting Claude would stop this
# partway. So when Claude needs patching, the install moves to a Terminal window, which outlives Claude.
if [ "${__CFBundleIdentifier:-}" = com.anthropic.claudefordesktop ] && node patch.mjs --needs-patch; then
  run="${TMPDIR:-/tmp}/claude-double-sidebar-install.command"
  args=""; for a in "$@"; do args+=" $(printf %q "$a")"; done
  printf '#!/bin/bash\ncd %q && ./install.sh%s\n' "$PWD" "$args" > "$run"
  chmod +x "$run"
  open -a Terminal "$run"
  echo "Claude has to quit while it's patched, so the install continues in a Terminal window."
  exit 0
fi

if node patch.mjs --needs-patch; then
  if pgrep -xq Claude; then
    if ! $YES; then
      read -r -p "Claude needs to quit while it's patched. Quit it now? [y/N] " answer
      [[ "$answer" =~ ^[Yy] ]] || { echo "Nothing changed."; exit 1; }
    fi
    osascript -e 'quit app "Claude"'
    for _ in $(seq 1 30); do pgrep -xq Claude || break; sleep 0.5; done
    pgrep -xq Claude && { echo "Claude is still open. Quit it and run this again."; exit 1; }
  fi
  # the final build only: --dev opens a debug port and is for working on the sidebar itself
  node patch.mjs
  echo "Opening Claude. If macOS asks about \"Claude Safe Storage\", choose Always Allow."
  open -a "$APP"
else
  node patch.mjs
  echo "Quit and reopen Claude to load the updated sidebar."
fi
