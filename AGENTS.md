# Installing this mod: notes for AI agents

You've been asked to install Claude Double Sidebar mod, an unofficial modification of Claude for Desktop on macOS. These notes say what it changes, how to check that against the code, what to tell the person, and how to install, verify and undo it.

## What it changes

Run `./install.sh --plan`. It lists every change for this Mac and changes nothing. In short:

- **Every install** writes the sidebar to `~/Library/Application Support/ClaudeDoubleSidebar/sidebar.js` and copies four icon fonts (`CCSidebarIcons*.ttf`) to `~/Library/Fonts`. The fonts carry the family names Segoe UI Symbol, Segoe UI, Roboto and Consolas, which Claude's sidebar asks for and macOS lacks. That is how the icons appear in Claude.
- **Every install** also sets up a background agent, `~/Library/LaunchAgents/local.claude-double-sidebar.plist`, unless run with `--no-agent`. launchd runs `agent.mjs` from the cloned folder every minute and when Claude's `Info.plist` changes. After a Claude update it patches Claude again the next time Claude is closed, and posts a macOS notification. It leaves a Claude it doesn't recognise alone, and handles each Claude build once.
- **The debug port.** The first install writes `on` to `~/Library/Application Support/ClaudeDoubleSidebar/debug-port`, unless run with `--no-debug-port`. The loader reads it each time Claude starts. When it's `on`, Claude opens its Chromium debug port on 127.0.0.1:9339 and runs the sidebar in the page's own world, so you can inspect and change the sidebar live. Any program on the Mac can then read and control Claude. `node patch.mjs --debug-port off` switches it off from the next launch.
- **The first install, and the first after each Claude update**, also patches `/Applications/Claude.app`. It makes every change below to a copy of Claude.app beside it, signs and checks the copy, then swaps it in. If any step fails, Claude is left as it was:
  - saves the original `Contents/Resources/app.asar` as `app.asar.original`
  - adds a loader to the top of `.vite/build/index.js` inside `app.asar`. On each claude.ai page load it reads the sidebar file and runs it in that page
  - updates the `app.asar` fingerprint in `Contents/Info.plist`
  - moves `Contents/embedded.provisionprofile` aside and drops Anthropic-only entitlements
  - creates a self-signed code-signing certificate named "Claude Local" in the login keychain if there isn't one, and re-signs Claude with it. The signature's designated requirement accepts either that certificate or Anthropic's Developer ID (team Q6L2SF6YDW), so Claude's own updater can still install Anthropic's updates

It makes no network requests and sends nothing anywhere. With the debug port on, Claude listens on 127.0.0.1:9339, which only programs on the same Mac can reach. It changes no other app.

## Checking that against the code

Small, readable files:

| File | Does |
|---|---|
| `src/sidebar.js` | The sidebar. Reads and rearranges Claude's sidebar in the page, keeps a few settings in the page's `localStorage`. |
| `build.mjs` | Fills the icon table into the sidebar and writes the sidebar file. |
| `patch.mjs` | The archive rewrite, fingerprint, certificate, signing and the swap. Runs only local tools: `codesign`, `security`, `openssl`, `PlistBuddy`, `ditto`. |
| `agent.mjs` | The background agent: one check per run, plus `--install` and `--remove` for its LaunchAgent. Runs only `patch.mjs`, `ps`, `osascript`, `plutil` and `launchctl`. |
| `install.sh`, `uninstall.sh` | Checks, then call `patch.mjs` and `agent.mjs`. |
| `vendor/claude-sidebar-icons/` | The icon fonts and their list, with licences. |
| `test/` | Tests for `patch.mjs` and `agent.mjs`, run against a copy of Claude in a temporary folder. Not used by the install. |
| `dev/` | Tools for working on the sidebar through the debug port. Not used by the install. |

Quick checks:

```bash
grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.sendBeacon|eval\(" src/sidebar.js build.mjs patch.mjs
grep -nE "curl|wget|https?://" install.sh uninstall.sh patch.mjs build.mjs
```

The first should find nothing. The second finds nothing that is fetched (`patch.mjs` has none). `src/sidebar.js` contains `http://www.w3.org/2000/svg`, the SVG namespace, which is not a request.

## What to tell the person before installing

Tell them, in your own words:

- This modifies Claude for Desktop itself. Claude will be signed by a certificate on their Mac instead of by Anthropic, so macOS no longer vouches that it's Anthropic's code.
- It's unofficial. A Claude update, or a change to the claude.ai page, can break the sidebar until the mod is updated. Modifying the app may not be allowed by Anthropic's terms.
- Claude's debug port is on by default, at 127.0.0.1:9339. It lets you (the AI) inspect and work on the sidebar live. While Claude is open, any program on their Mac can read and control Claude through it, including their conversations and signed-in session. `--no-debug-port` installs with it off.
- A Claude update replaces the patched app. A background agent stays installed and patches Claude again the next time Claude is closed. They can leave it out with `--no-agent`, and then run the installer again after each Claude update.
- They install it at their own risk. `./uninstall.sh` takes it out, and a fresh download of Claude restores it exactly.

Show them the output of `./install.sh --plan`, and install only after they say yes.

## Installing

- **Where the folder lives.** The background agent runs from the cloned folder, so clone it somewhere permanent, such as `~/code/claude-double-sidebar-mod`. Not a temporary folder, and not a folder that belongs to your session, which may be deleted with it.
- **The command**, once they've agreed: `./install.sh --yes`. `--yes` skips the installer's own "quit Claude?" question, since they've already answered it.
- **Run it from a terminal** (Claude Code in Terminal, or any agent outside Claude for Desktop). That's the supported route: it runs start to finish.
- **If you're inside Claude for Desktop** (Claude Code in its Code tab, or its terminal panel), the best answer is to give the person the prompt from the README's Install section to paste into Claude Code in Terminal. If you run it anyway, quitting Claude would stop the install partway. So when Claude needs patching (`node patch.mjs --state` prints `needs-patch`), the installer opens a Terminal window, carries on there and exits straight away. Claude then quits, and your session with it. Before you run it, tell the person: Claude will close, the install finishes in Terminal and reopens Claude, and they can come back to this conversation then. A sidebar-only update stays where it is and doesn't quit Claude. `./uninstall.sh` moves to Terminal the same way.
- **macOS prompts are theirs.** The first time, macOS may ask for the login keychain password (to add the certificate), whether Claude may use "Claude Safe Storage" (choose **Always Allow**), and for them to sign in to Claude again. You can't answer these. Tell them to expect them.

## Checking it worked

- `node patch.mjs --state` prints `installed`. It prints `needs-patch` if Claude has no loader, and exits 2 with the reason if it can't read Claude.
- `codesign --verify --strict /Applications/Claude.app` succeeds.
- `~/Library/Application Support/ClaudeDoubleSidebar/sidebar.js` exists.
- With the debug port on, once Claude has reopened: `curl -s http://127.0.0.1:9339/json/version` answers.
- `launchctl print gui/$(id -u)/local.claude-double-sidebar` finds the agent, unless they chose `--no-agent`.
- After Claude reopens, a rail of icons runs down the left edge of its sidebar.

## Updating and undoing

- **Update:** `git pull`, then `./install.sh --yes`. A sidebar-only update replaces one file, leaves Claude open, and macOS asks nothing.
- **Undo:** `./uninstall.sh --yes` removes the background agent, puts back Claude's own `app.asar` and removes the sidebar file. It keeps the icon fonts, because section and session names that hold icons need them; `--remove-fonts` removes them too. The "Claude Local" certificate stays in the keychain, where the person can delete it in Keychain Access.
