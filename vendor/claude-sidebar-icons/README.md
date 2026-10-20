# Claude sidebar icons

The source for the line-icon font the [Claude Double Sidebar plugin](https://github.com/traceorozco/claude-double-sidebar-plugin) installs: 245 icons on private-use characters (U+F0000 to U+F00F4), drawn by Claude Desktop's own sidebar.

![All 245 icons, colour version](previews/colour.png)

## Two versions

- **Colour** (`fonts/colour/`): each icon's line in the text colour, with one part filled in terracotta at 35%. This is what the plugin ships.
- **Mono** (`fonts/mono/`): the same lines, no fill.

![All 245 icons, mono version](previews/mono.png)

Both use the same characters, so a section or session name keeps its icon whichever is installed.

## Use the fonts

Copy the four `.ttf` files from one folder into `~/Library/Fonts`, then restart Claude. They're named after fonts Claude's sidebar asks for and macOS doesn't have (Segoe UI Symbol, Segoe UI, Roboto, Consolas), which is how the icons reach the sidebar. Install one version at a time: the second replaces the first.

`icons.tsv` lists every icon: the character itself, its codepoint, the name the plugin's `/sidebar icon` and picker use, and its source SVG.

## Build them

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python build.py fonts/colour
.venv/bin/python build.py --mono fonts/mono
```

To add an icon: put its SVG in `icons/lucide/`, `icons/tabler/` or `icons/custom/`, and add a line to `MAP` in `build.py` with the next free codepoint. Never renumber an existing one: names in the sidebar hold the character. A spot of `"auto"` fills the largest closed shape; a list of element indexes or a path picks the filled part by hand.

`tools/preview.swift` renders a font with macOS's own text engine, the one the sidebar uses:

```bash
swiftc -O tools/preview.swift -o /tmp/preview && /tmp/preview fonts/colour/CCSidebarIcons.ttf previews/colour.png
```

## Licences

Icons from [Lucide](https://lucide.dev) (ISC) and [Tabler Icons](https://tabler.io/icons) (MIT), some redrawn in `icons/custom/`. See `licenses/`. Unofficial; not made by or affiliated with Anthropic.
