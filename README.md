# Claude Double Sidebar mod

**Unofficial.** Not made by or affiliated with Anthropic.

A double sidebar for the Code tab in Claude for Desktop on macOS, drawn inside Claude's own sidebar:

- A rail down the sidebar's left edge with Home and one icon per section. Hover an icon for the section's name.
- Click a section and the sidebar shows only that section's sessions. Home shows everything.
- Right-click a section on the rail for New session, Change icon and Claude's own section options.
- The + at the foot of the rail makes a new section, with an icon picked in Claude's New section dialog.
- Icons on sections and sessions: rename one and pick from 177 line icons, with search.

The icons are part of the names themselves, a character drawn by the [Claude sidebar icons](https://github.com/traceorozco/claude-sidebar-icons) font, so Claude shows them everywhere it shows a name.

## How it works

Claude's sidebar is part of the claude.ai page the app loads. The patch adds the sidebar's code to the script Claude runs in that page, so it builds on Claude's real sidebar. Nothing sits on top of Claude: dialogs, menus and Settings work as they always do.

That means changing Claude.app itself. Claude checks its files against a fingerprint in its signed settings, so the patch updates the fingerprint and signs Claude again with a certificate on your Mac called **Claude Local**, which the installer makes the first time. The same certificate every time keeps macOS's keychain and privacy permissions for Claude in place across installs.

What you give up:

- Claude's automatic updates stop working. To update, download Claude again from claude.ai/download, then run the installer again.
- Claude is no longer signed by Anthropic on your Mac. It's signed by your own certificate instead.

## Install

Needs macOS, [Node.js](https://nodejs.org) 18 or newer, and Apple's command line tools (`xcode-select --install`).

Run it from Terminal, not from inside Claude, because it quits Claude while it patches:

```bash
git clone https://github.com/traceorozco/claude-double-sidebar-mod.git
cd claude-double-sidebar-mod
./install.sh
```

The first time, macOS may ask:

- for your login keychain password, so the installer can add the **Claude Local** certificate
- whether Claude can use **Claude Safe Storage**: choose **Always Allow**
- you to sign in to Claude again

## After every Claude update

A new Claude replaces the patched one, so the sidebar disappears. Run the installer again:

```bash
cd claude-double-sidebar-mod
git pull
./install.sh
```

## Uninstall

```bash
./uninstall.sh
```

This puts back Claude's own files and signs it with your certificate. For Claude exactly as Anthropic ships it, with its own signature and updates, download it again from claude.ai/download.

## Working on the sidebar

The code is `src/sidebar.js`. `node patch.mjs --dev` installs a development build: Claude opens a debug port on 127.0.0.1:9339 and reads `dist/sidebar.js` from this folder on every page load, so `node build.mjs` and a reload (⌘R) show a change. Never leave a dev build installed day to day. Run `./install.sh` when you're done.

## Licences

Icons from [Lucide](https://lucide.dev) (ISC) and [Tabler Icons](https://tabler.io/icons) (MIT), through [Claude sidebar icons](https://github.com/traceorozco/claude-sidebar-icons). See `vendor/claude-sidebar-icons/licenses/`.
