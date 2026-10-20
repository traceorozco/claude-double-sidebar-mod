# Installing this mod: notes for AI agents

You've been asked to install Claude Double Sidebar mod, an unofficial modification of Claude for Desktop on macOS. These notes say what it changes, how to check that against the code, what to tell the person, and how to install, verify and undo it.

## What it changes

Run `./install.sh --plan`. It lists every change for this Mac and changes nothing. In short:

- **Every install** writes the sidebar to `~/Library/Application Support/ClaudeDoubleSidebar/sidebar.js` and copies four icon fonts (`CCSidebarIcons*.ttf`) to `~/Library/Fonts`. The fonts carry the family names Segoe UI Symbol, Segoe UI, Roboto and Consolas, which Claude's sidebar asks for and macOS lacks. That is how the icons appear in Claude.
- **The first install, and the first after each Claude update**, also patches `/Applications/Claude.app`:
  - saves the original `Contents/Resources/app.asar` as `app.asar.original`
  - adds a loader to the top of `.vite/build/index.js` inside `app.asar`. On each claude.ai page load it reads the sidebar file and runs it in that page
  - updates the `app.asar` fingerprint in `Contents/Info.plist`
  - moves `Contents/embedded.provisionprofile` aside and drops Anthropic-only entitlements
  - creates a self-signed code-signing certificate named "Claude Local" in the login keychain if there isn't one, and re-signs Claude with it

It makes no network requests and sends nothing anywhere. It changes no other app.

## Checking that against the code

Small, readable files:

| File | Does |
|---|---|
| `src/sidebar.js` | The sidebar. Reads and rearranges Claude's sidebar in the page, keeps a few settings in the page's `localStorage`. |
| `build.mjs` | Fills the icon table into the sidebar and writes the sidebar file. |
| `patch.mjs` | The archive rewrite, fingerprint, certificate and signing. Runs only local tools: `codesign`, `security`, `openssl`, `PlistBuddy`. |
| `install.sh`, `uninstall.sh` | Checks, then call `patch.mjs`. |
| `vendor/claude-sidebar-icons/` | The icon fonts and their list, with licences. |
| `dev/` | Tools for working on the sidebar. Not used by the install. |

Quick checks:

```bash
grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.sendBeacon|eval\(" src/sidebar.js build.mjs patch.mjs
grep -nE "curl|wget|https?://" install.sh uninstall.sh patch.mjs build.mjs
```

The first should find nothing. The second finds nothing that is fetched (`patch.mjs` has none). `src/sidebar.js` contains `http://www.w3.org/2000/svg`, the SVG namespace, which is not a request.

## What to tell the person before installing

Tell them, in your own words:

- This modifies Claude for Desktop itself. Claude will be signed by a certificate on their Mac instead of by Anthropic, so macOS no longer vouches that it's Anthropic's code.
- A Claude update replaces the patched app, so after one they run the installer again.
- It's unofficial. A Claude update, or a change to the claude.ai page, can break the sidebar until the mod is updated. Modifying the app may not be allowed by Anthropic's terms.
- They install it at their own risk. `./uninstall.sh` takes it out, and a fresh download of Claude restores it exactly.

Show them the output of `./install.sh --plan`, and install only after they say yes.

## Installing

- **The command**, once they've agreed: `./install.sh --yes`. `--yes` skips the installer's own "quit Claude?" question, since they've already answered it.
- **In a terminal** (Claude Code in Terminal, or any agent outside Claude for Desktop), it runs start to finish.
- **Inside Claude for Desktop** (Claude Code in its Code tab, or its terminal panel), quitting Claude would stop the install partway. So when Claude needs patching (`node patch.mjs --needs-patch` exits 0), the installer opens a Terminal window, carries on there and exits straight away. Claude then quits, and your session with it. Before you run it, tell the person: Claude will close, the install finishes in Terminal and reopens Claude, and they can come back to this conversation then. A sidebar-only update stays where it is and doesn't quit Claude. `./uninstall.sh` moves to Terminal the same way.
- **macOS prompts are theirs.** The first time, macOS may ask for the login keychain password (to add the certificate), whether Claude may use "Claude Safe Storage" (choose **Always Allow**), and for them to sign in to Claude again. You can't answer these. Tell them to expect them.

## Checking it worked

- `node patch.mjs --needs-patch` exits 1: Claude has the loader.
- `codesign --verify --strict /Applications/Claude.app` succeeds.
- `~/Library/Application Support/ClaudeDoubleSidebar/sidebar.js` exists.
- After Claude reopens, a rail of icons runs down the left edge of its sidebar.

## Updating and undoing

- **Update:** `git pull`, then `./install.sh --yes`. A sidebar-only update replaces one file, leaves Claude open, and macOS asks nothing.
- **Undo:** `./uninstall.sh --yes` puts back Claude's own `app.asar` and removes the sidebar file. It keeps the icon fonts, because section and session names that hold icons need them; `--remove-fonts` removes them too. The "Claude Local" certificate stays in the keychain, where the person can delete it in Keychain Access.
