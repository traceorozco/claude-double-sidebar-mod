// Claude Double Sidebar, drawn inside Claude's own sidebar: a rail of the Code tab's sections (Claude's
// custom groups) down the sidebar's left edge, and the sidebar showing only the chosen section.
// Home shows Claude's sidebar as it is. Runs in the claude.ai page; touches nothing but the DOM.
//
// A section's icon is part of its name: a private-use character from the Claude sidebar icons font
// (github.com/traceorozco/claude-sidebar-icons), drawn by the fonts installed alongside, so Claude's own
// sidebar shows it too. Picking an icon writes that character at the front of the name being edited.

const KEY_LANE = 'doubleSidebar.lane'
const RAIL_W = 48
const ICON_FONT = '"Segoe UI Symbol"'

// [name, character, category] for every icon in the font, filled in from icons.tsv when the patch is built
const ICON_TABLE = __ICON_TABLE__
const ICON_BY_NAME = Object.fromEntries(ICON_TABLE.map(([name, ch]) => [name, ch]))
const FOLDER = ICON_BY_NAME.folder
const HOME = ICON_BY_NAME.home

// Lucide line icons (ISC license) for the controls that aren't sections
const UI = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  tree: '<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
}
const svg = name => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name]}</svg>`
const glyph = ch => { const s = document.createElement('span'); s.setAttribute('data-ds-glyph', ''); s.setAttribute('aria-hidden', 'true'); s.textContent = ch; return s }

// "<icon> name" → { icon, text }; icon is null when the name has none
const LEAD = /^([\u{F0000}-\u{FFFFD}])\s*/u
const splitName = name => { const m = LEAD.exec(name); return m ? { icon: m[1], text: name.slice(m[0].length) } : { icon: null, text: name } }

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

const STYLE = `
/* room for the rail as padding, not margin: the body clips what leaves its box, and the footer below
   reaches back over the rail to the window's edge */
/* !important: Claude 3's panels look sets the body's padding with a more specific rule */
aside.dframe-sidebar[data-ds] > .dframe-sidebar-body { padding-inline-start: calc(${RAIL_W}px + 0.5rem) !important; }
/* one rule under the header, across the rail and the sidebar */
aside.dframe-sidebar[data-ds] > .df-titlebar { box-shadow: inset 0 -1px 0 var(--ds-line); }
/* the footer (account, settings) runs to the window's left edge like the header; the rail stops above it */
aside.dframe-sidebar[data-ds] > .dframe-sidebar-body .df-bottom-tray { margin-inline-start: -${RAIL_W}px !important; }
.dframe-root[data-ds-host]:not([data-ds-closed]) > [data-ds-rail] { bottom: var(--ds-foot, 0px); }
.dframe-root[data-ds-closed] > main.dframe-content { left: ${RAIL_W}px !important; }
.dframe-root[data-ds-closed] > [data-ds-rail] { border-top: 1px solid var(--ds-line); }
/* the account avatar at the rail's foot, only while the sidebar (and its footer) is closed */
[data-ds-rail] [data-ds-subs] { margin-top: auto; }
[data-ds-rail] [data-ds-avatar] { flex: none; }
.dframe-root:not([data-ds-closed]) > [data-ds-rail] [data-ds-avatar] { display: none; }
[data-ds-rail] [data-ds-avatar] [data-cds="Avatar"] { pointer-events: none; }
.dframe-root[data-ds-host] { --ds-line: rgb(0 0 0 / .08); --ds-rail: rgb(0 0 0 / .028); --ds-hover: rgb(0 0 0 / .05); --ds-on: rgb(0 0 0 / .085);
  --ds-menu: #fff; --ds-menu-ink: #3d3d3a; --ds-menu-line: #d7d7d5; --ds-tip: #1f1e1d; --ds-tip-ink: #fff; }
[data-mode="dark"] .dframe-root[data-ds-host], .dframe-root[data-ds-host][data-mode="dark"] { --ds-line: rgb(255 255 255 / .08); --ds-rail: rgb(0 0 0 / .2);
  --ds-hover: rgb(255 255 255 / .06); --ds-on: rgb(255 255 255 / .1); --ds-menu: #30302e; --ds-menu-ink: #e8e6dc; --ds-menu-line: rgb(255 255 255 / .1);
  --ds-tip: #f5f4ee; --ds-tip-ink: #1f1e1d; }
/* each glyph carries 0.28em of blank space after its drawing: shifted by half of it, the drawing sits centred */
[data-ds-glyph] { display: inline-block; font-family: ${ICON_FONT}; font-style: normal; font-weight: 400; line-height: 1; transform: translateX(0.14em); }
[data-ds-rail] { box-sizing: border-box; position: absolute; z-index: 40; inset-inline-start: 0; top: 46px; bottom: 0; width: ${RAIL_W}px;
  background: color-mix(in srgb, var(--ds-rail-base, #f9f9f7), black 2.8%);
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 0;
  border-inline-end: 1px solid var(--ds-line); overflow-y: auto; scrollbar-width: none; }
[data-ds-rail] button { all: unset; box-sizing: border-box; flex: none; width: 32px; height: 32px; border-radius: 8px;
  display: grid; place-items: center; cursor: default; color: color-mix(in srgb, currentColor 72%, transparent); font-size: 17px; }
[data-ds-rail] button svg { width: 15px; height: 15px; }
/* the new-section button: Claude's own New circle (its colours and hover darkening come from Claude's df-new-circle rules) */
[data-ds-rail] .df-new-circle { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; color: var(--cds-text-secondary, currentColor); }
[data-ds-rail] button:hover .df-new-circle { color: var(--cds-text-primary, currentColor); }
[data-ds-rail] .df-new-circle svg { width: 13px; height: 13px; stroke-width: 2.2; }
/* sections are categories: their names in capitals, a pixel smaller than Claude's group labels */
aside.dframe-sidebar :is([data-group-section^="custom-"], [data-pinned-list], [data-recents-list]) [data-sidebar-group-label] [data-group-name] { text-transform: uppercase; font-size: 11px; letter-spacing: 0.03em; }
[data-ds-tip][data-caps] { text-transform: uppercase; font-size: 11px; letter-spacing: 0.03em; }
[data-ds-rail] button:hover { background: var(--ds-hover); color: currentColor; }
[data-ds-rail] button[aria-pressed="true"] { background: var(--ds-on); color: currentColor; }
[data-ds-rail] button:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 40%, transparent); outline-offset: 1px; }
[data-ds-rail] hr { all: unset; flex: none; width: 24px; border-top: 1px solid var(--ds-line); margin: 2px 0; }
aside.dframe-sidebar[data-ds-lane]:not([data-ds-lane="home"]) [data-testid="nav-pin-rows"],
aside.dframe-sidebar[data-ds-lane]:not([data-ds-lane="home"]) [data-pinned-list] { display: none !important; }
/* Recents is the list that stretches the sidebar to the window's foot: kept in place, emptied */
aside.dframe-sidebar[data-ds-lane]:not([data-ds-lane="home"]) [data-recents-list] > * { display: none !important; }
/* subsections: a section's sessions grouped by the category in their titles ("category / topic") */
[data-ds-sub] { display: flex; align-items: center; gap: 4px; margin: 6px 0 1px; padding: 0 8px 0 10px; height: 24px; border-radius: 6px;
  font-size: 12px; color: var(--cds-text-muted, #898781); cursor: default; user-select: none; }
[data-ds-sub]:hover { color: var(--cds-text-secondary, #52514e); background: var(--ds-hover); }
[data-ds-sub] svg { width: 12px; height: 12px; flex: none; transition: transform .15s; }
[data-ds-sub][aria-expanded="false"] svg { transform: rotate(-90deg); }
[data-ds-sub] [data-ds-count] { margin-inline-start: auto; font-size: 11px; opacity: .7; }
[data-ds-sub] [data-ds-subicon] { display: inline-grid; place-items: center; width: 16px; font-size: 13px; margin-inline-end: 2px; }
[data-ds-sub] [data-ds-subicon][hidden] { display: none; }
[data-ds-sub-hidden] { display: none !important; }
[data-ds-menuitem]:hover, [data-ds-menuitem]:focus-visible { background: var(--cds-fill-ghost-hover, rgb(0 0 0 / .05)); }
[data-ds-menu] > [data-ds-heading] { padding: 6px 8px 2px; font-size: 12px; color: color-mix(in srgb, currentColor 55%, transparent); }
[data-ds-menu] > hr { all: unset; display: block; height: 1px; margin: 4px 6px; background: var(--ds-menu-line); }
[data-ds-menu] > input { all: unset; box-sizing: border-box; display: block; width: calc(100% - 8px); margin: 4px; height: 30px; padding: 0 8px; border-radius: 7px; font-size: 13px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
[data-ds-menu] > input:focus { border-color: color-mix(in srgb, currentColor 40%, transparent); }
[data-ds-tip] { position: fixed; z-index: 2147483001; pointer-events: none; padding: 4px 8px; border-radius: 6px;
  background: var(--ds-tip, #1f1e1d); color: var(--ds-tip-ink, #fff); font-family: inherit; font-size: 12px; line-height: 16px; font-weight: 500; white-space: nowrap; }
[data-ds-menu] { position: fixed; z-index: 2147483000; min-width: 180px; padding: 4px; border-radius: 11px; font-family: inherit; font-size: 14px;
  background: var(--ds-menu); color: var(--ds-menu-ink); border: 1px solid var(--ds-menu-line); box-shadow: 0 5px 14px rgb(0 0 0 / .09); }
[data-ds-menu] > button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; border-radius: 7px; cursor: default; }
[data-ds-menu] > button:hover, [data-ds-menu] > button:focus-visible { background: var(--ds-hover); }
[data-ds-menu] > button svg { width: 16px; height: 16px; flex: none; }
[data-ds-menu][data-picker] { width: 312px; min-width: 0; padding: 0; display: flex; flex-direction: column; max-height: min(380px, calc(100vh - 16px)); overflow: hidden; }
[data-ds-picker] { display: flex; flex-direction: column; min-height: 0; flex: 1; }
[data-ds-picker] > label { flex: none; display: flex; align-items: center; gap: 6px; margin: 8px 8px 4px; padding: 0 8px; height: 32px; border-radius: 8px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent); color: color-mix(in srgb, currentColor 60%, transparent); }
[data-ds-picker] > label:focus-within { border-color: color-mix(in srgb, currentColor 40%, transparent); }
[data-ds-picker] > label svg { width: 15px; height: 15px; flex: none; }
[data-ds-picker] > label input { all: unset; flex: 1; min-width: 0; font-size: 13px; color: var(--ds-menu-ink, currentColor); }
[data-ds-picker] > label input::placeholder { color: color-mix(in srgb, currentColor 50%, transparent); }
[data-ds-grid] { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); justify-items: center; gap: 2px; padding: 4px 8px 8px; overflow-y: auto; min-height: 0; flex: 1; align-content: start; }
[data-ds-grid] > button { all: unset; box-sizing: border-box; width: 34px; height: 34px; border-radius: 7px;
  display: grid; place-items: center; font-size: 19px; cursor: default; border: 1px solid transparent; }
[data-ds-grid] > button:hover, [data-ds-grid] > button:focus-visible { background: color-mix(in srgb, currentColor 7%, transparent); }
[data-ds-grid] > button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 9%, transparent); border-color: color-mix(in srgb, currentColor 30%, transparent); }
[data-ds-grid] > button[hidden] { display: none; }
[data-ds-grid] > p { grid-column: 1 / -1; margin: 8px 2px; font-size: 13px; color: color-mix(in srgb, currentColor 55%, transparent); }
button[data-ds-edit] { all: unset; display: inline-grid; place-items: center; flex: none; width: 24px; height: 24px; margin-inline-end: 4px; border-radius: 6px;
  cursor: default; font-size: 15px; box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent); }
button[data-ds-edit]:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
button[data-ds-edit] svg { width: 14px; height: 14px; }
[data-ds-iconpick] { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
[data-ds-iconpick] > span { font-size: 13px; color: color-mix(in srgb, currentColor 65%, transparent); }
[data-ds-iconpick] [data-ds-picker] > label { margin: 0 0 4px; }
[data-ds-iconpick] [data-ds-grid] { grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); max-height: 200px; padding: 0; }
`

// Claude's custom groups, in sidebar order: { id, name, icon, text }
function sections() {
  return [...document.querySelectorAll('aside.dframe-sidebar [data-group-list][data-group-section^="custom-"]')]
    .map(l => { const name = l.getAttribute('data-group-label') || 'Section'; return { id: l.getAttribute('data-group-list'), name, ...splitName(name) } })
}
const groupEl = id => document.querySelector(`aside.dframe-sidebar [data-group-list="${CSS.escape(id)}"]`)

function applyLane(aside, lane) {
  aside.setAttribute('data-ds-lane', lane)
  let style = document.getElementById('ds-lane-style')
  if (!style) { style = document.createElement('style'); style.id = 'ds-lane-style'; document.head.append(style) }
  style.textContent = lane === 'home' ? '' :
    `aside.dframe-sidebar [data-group-list]:not([data-group-list="${CSS.escape(lane)}"]):not([data-recents-list]) { display: none !important; }`
  if (lane !== 'home') {
    // the chosen section opens if Claude has it collapsed
    groupEl(lane)?.querySelector('[data-group-toggle][aria-expanded="false"]')?.click()
  }
}

// --- tooltip: a name as Claude's tooltips look, beside the control (the rail) or centred above it (a
// picker's icons); inside a dialog when the control is in one, so it stacks over the dialog
let tip, tipTimer
function showTip(anchor, text, place = 'right', caps = false) {
  clearTimeout(tipTimer)
  tipTimer = setTimeout(() => {
    tip ??= Object.assign(document.createElement('div'), { role: 'tooltip' })
    tip.setAttribute('data-ds-tip', '')
    tip.textContent = text
    tip.toggleAttribute('data-caps', caps)
    ;(anchor.closest('[role="dialog"]') || document.querySelector('.dframe-root[data-ds-host]') || document.body).append(tip)
    const r = anchor.getBoundingClientRect()
    if (place === 'top') {
      tip.style.left = `${Math.max(4, Math.min(r.left + r.width / 2 - tip.offsetWidth / 2, innerWidth - tip.offsetWidth - 4))}px`
      tip.style.top = `${r.top - tip.offsetHeight - 6}px`
    } else {
      tip.style.left = `${r.right + 8}px`
      tip.style.top = `${r.top + r.height / 2 - tip.offsetHeight / 2}px`
    }
  }, 250)
}
function hideTip() { clearTimeout(tipTimer); tip?.remove() }

// --- menus
function closeMenus() { hideTip(); document.querySelectorAll('[data-ds-menu]').forEach(m => m.remove()) }
function popMenu(anchor, fill, { picker = false, keepFocus = false } = {}) {
  closeMenus(); hideTip()
  const m = document.createElement('div')
  m.setAttribute('data-ds-menu', '')
  m.setAttribute('role', 'menu')
  if (picker) m.setAttribute('data-picker', '')
  fill(m)
  // inside the aside so Claude's theme variables reach it
  ;(document.querySelector('.dframe-root[data-ds-host]') || document.body).append(m)
  const r = anchor.getBoundingClientRect()
  m.style.left = `${Math.min(r.right + 6, innerWidth - m.offsetWidth - 8)}px`
  m.style.top = `${Math.max(8, Math.min(r.top, innerHeight - m.offsetHeight - 8))}px`
  const close = e => {
    if (e.type === 'keydown' && e.key !== 'Escape') return
    if (e.type === 'pointerdown' && m.contains(e.target)) return
    m.remove(); removeEventListener('pointerdown', close, true); removeEventListener('keydown', close, true)
  }
  setTimeout(() => { addEventListener('pointerdown', close, true); addEventListener('keydown', close, true) })
  if (keepFocus) m.onpointerdown = e => e.preventDefault()
  else (m.querySelector('input') || m.querySelector('button'))?.focus()
  return m
}
function item(m, label, icon, run) {
  const b = document.createElement('button')
  b.setAttribute('role', 'menuitem')
  b.innerHTML = svg(icon) + '<span></span>'
  b.lastChild.textContent = label
  b.onclick = () => { closeMenus(); run() }
  m.append(b)
}

// the icon picker: a search over name and category, and every icon as a button in a scrolling grid
function makePicker(current, onPick) {
  const wrap = document.createElement('div')
  wrap.setAttribute('data-ds-picker', '')
  const label = document.createElement('label')
  label.innerHTML = svg('search')
  const search = document.createElement('input')
  search.type = 'text'
  search.placeholder = 'Search icons'
  search.setAttribute('aria-label', 'Search icons')
  label.append(search)
  const grid = document.createElement('div')
  grid.setAttribute('data-ds-grid', '')
  grid.setAttribute('role', 'radiogroup')
  grid.setAttribute('aria-label', 'Icons')
  const none = document.createElement('p')
  none.textContent = 'No icons match'
  none.hidden = true
  for (const [name, ch, key] of ICON_TABLE) {
    const c = document.createElement('button')
    c.type = 'button'
    c.onpointerenter = () => showTip(c, name, 'top')
    c.onpointerleave = hideTip
    c.onfocus = () => showTip(c, name, 'top')
    c.onblur = hideTip
    c.dataset.find = `${name} ${key}`.toLowerCase()
    c.setAttribute('role', 'radio')
    c.setAttribute('aria-label', name)
    c.setAttribute('aria-pressed', String(current === ch))
    c.append(glyph(ch))
    c.onclick = e => {
      e.preventDefault()
      hideTip()
      grid.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === c)))
      onPick(ch)
    }
    grid.append(c)
  }
  grid.append(none)
  search.oninput = () => {
    const q = search.value.trim().toLowerCase()
    let shown = 0
    for (const c of grid.querySelectorAll('button')) { c.hidden = !!q && !c.dataset.find.includes(q); if (!c.hidden) shown++ }
    none.hidden = shown > 0
    grid.scrollTop = 0
  }
  // Enter in the search picks the first match
  search.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); grid.querySelector('button:not([hidden])')?.click() } }
  wrap.append(label, grid)
  // keep the selected icon in view
  requestAnimationFrame(() => grid.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' }))
  return wrap
}

// write the icon at the front of the name in a field Claude owns (React-controlled: set, then announce)
function setFieldIcon(field, ch, text) {
  const value = field.isContentEditable ? field.textContent : field.value
  const next = `${ch} ${text ?? splitName(value).text}`
  if (field.isContentEditable) field.textContent = next
  else Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, next)
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
}
const fieldIcon = field => splitName(field.isContentEditable ? field.textContent : field.value).icon

// Claude's own section menu, the one a right-click on a section header opens
function claudeSectionMenu(id) {
  const label = groupEl(id)?.querySelector('[data-sidebar-group-label]')
  if (!label) return false
  const r = label.getBoundingClientRect()
  label.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 24, clientY: r.top + r.height / 2 }))
  return true
}
const waitFor = (find, ms = 1500) => new Promise(resolve => {
  const t0 = Date.now()
  const step = () => { const v = find(); if (v || Date.now() - t0 > ms) resolve(v); else requestAnimationFrame(step) }
  step()
})
const menuItem = re => [...document.querySelectorAll('[role="menuitem"]')].find(e => re.test(e.textContent.trim()))

// New section is in that menu: open it from any section, then press it; Claude's dialog takes the name
async function newSection() {
  const first = sections()[0]
  if (!first || !claudeSectionMenu(first.id)) return
  ;(await waitFor(() => menuItem(/^New section$/)))?.click()
}
// A section's name, rewritten through Claude's own Rename: the field it opens takes the new name, then Enter
const renameField = id => groupEl(id)?.querySelector('[data-sidebar-group-label] input, [data-sidebar-group-label] [contenteditable="true"]')
async function renameTo(id, name) {
  let field = renameField(id)
  if (!field) {
    if (!claudeSectionMenu(id)) return
    ;(await waitFor(() => menuItem(/^Rename/)))?.click()
    field = await waitFor(() => renameField(id))
    if (!field) return
  }
  const { icon, text } = splitName(name)
  setFieldIcon(field, icon, text)
  for (const type of ['keydown', 'keyup']) field.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
}
// Change icon from the rail: the picker beside the rail button, the pick saved straight into the name
function changeIcon(id, anchor) {
  const s = sections().find(x => x.id === id)
  if (!s) return
  popMenu(anchor, m => m.append(makePicker(s.icon, ch => { closeMenus(); renameTo(id, `${ch} ${s.text}`) })), { picker: true })
}

// Claude's New section dialog: an icon row under the name
function decorateSectionDialog() {
  for (const dlg of document.querySelectorAll('[role="dialog"]')) {
    if (dlg.querySelector('[data-ds-iconpick]')) continue
    const input = dlg.querySelector('input[placeholder="Section name"]')
    if (!input) continue
    const submit = [...dlg.querySelectorAll('button')].find(b => /^Create section/.test(b.textContent.trim()))
    let row = input
    while (row.parentElement && row.parentElement !== dlg && !(submit && row.parentElement.contains(submit))) row = row.parentElement
    const box = document.createElement('div')
    box.setAttribute('data-ds-iconpick', '')
    box.innerHTML = '<span>Icon</span><div></div>'
    box.lastChild.replaceWith(makePicker(fieldIcon(input), ch => setFieldIcon(input, ch)))
    row.after(box)
  }
}

// While Claude renames a section in place, an icon button sits in front of the name field and opens the
// picker without taking the field's focus, so the rename carries on and Enter saves name and icon together
function decorateRename() {
  for (const s of sections()) {
    const label = groupEl(s.id)?.querySelector('[data-sidebar-group-label]')
    if (!label) continue
    const field = label.querySelector('input, [contenteditable="true"]')
    const marks = label.querySelectorAll('button[data-ds-edit]')
    if (!field) { marks.forEach(m => m.remove()); continue }
    let host = field
    while (host.parentElement && host.parentElement !== label) host = host.parentElement
    let mark = host.previousElementSibling?.matches?.('button[data-ds-edit]') ? host.previousElementSibling : null
    for (const m of marks) if (m !== mark) m.remove()
    const ch = fieldIcon(field) || FOLDER
    if (!mark) {
      mark = document.createElement('button')
      mark.type = 'button'
      mark.setAttribute('data-ds-edit', '')
      mark.setAttribute('aria-label', 'Section icon')
      mark.onpointerdown = e => e.preventDefault()
      mark.onclick = e => {
        e.preventDefault(); e.stopPropagation()
        // the name as typed so far: the search takes the focus, and Claude may end the rename when the field loses it
        const typed = splitName(field.isContentEditable ? field.textContent : field.value).text || s.text
        popMenu(mark, m => m.append(makePicker(fieldIcon(field), picked => {
          closeMenus()
          const live = renameField(s.id)
          if (live) setFieldIcon(live, picked, typed)
          else renameTo(s.id, `${picked} ${typed}`)
        })), { picker: true })
      }
      host.before(mark)
    }
    if (mark.textContent !== ch) mark.replaceChildren(glyph(ch))
  }
}

// Sessions take an icon the same way: while a session is renamed (its row in the sidebar, or its title
// above the conversation), an icon button sits in front of the field. If the field closes while the
// picker is open, the pick goes in through Claude's Rename again, with the name as it was typed.
const paneTitle = () => document.querySelector('button[data-pane-title]')
function sessionFields() {
  const fields = [...document.querySelectorAll('aside [data-row-key]:not([data-row-key^="label:"]) input, aside [data-row-key]:not([data-row-key^="label:"]) [contenteditable="true"]')]
    .map(f => ({ field: f, key: f.closest('[data-row-key]').getAttribute('data-row-key') }))
  // the title above the conversation: Claude swaps its button for a field in the same place
  const header = document.querySelector('[data-pane-title-input], input[aria-label*="session" i]:not(aside input)')
  if (header && !fields.some(x => x.field === header)) fields.push({ field: header, key: 'pane' })
  return fields
}
async function renameSession(key, name) {
  const find = () => key === 'pane'
    ? document.querySelector('[data-pane-title-input], input[aria-label*="session" i]:not(aside input)')
    : document.querySelector(`aside [data-row-key="${CSS.escape(key)}"] input, aside [data-row-key="${CSS.escape(key)}"] [contenteditable="true"]`)
  let field = find()
  if (!field) {
    if (key === 'pane') paneTitle()?.click()
    else {
      document.querySelector(`aside [data-row-key="${CSS.escape(key)}"] button[aria-label^="More options for"]`)?.click()
      ;(await waitFor(() => menuItem(/^Rename/)))?.click()
    }
    field = await waitFor(find)
    if (!field) return
  }
  const { icon, text } = splitName(name)
  setFieldIcon(field, icon, text)
  for (const type of ['keydown', 'keyup']) field.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
}
function decorateSessionRename() {
  const live = sessionFields()
  for (const m of document.querySelectorAll('button[data-ds-edit][data-session]')) if (!live.some(x => x.field === m.nextElementSibling)) m.remove()
  for (const { field, key } of live) {
    let mark = field.previousElementSibling?.matches?.('button[data-ds-edit]') ? field.previousElementSibling : null
    const ch = fieldIcon(field) || '\u{F0000}'
    if (!mark) {
      mark = document.createElement('button')
      mark.type = 'button'
      mark.setAttribute('data-ds-edit', '')
      mark.setAttribute('data-session', '')
      mark.setAttribute('aria-label', 'Session icon')
      mark.onpointerdown = e => e.preventDefault()
      mark.onclick = e => {
        e.preventDefault(); e.stopPropagation()
        const typed = splitName(field.isContentEditable ? field.textContent : field.value).text
        popMenu(mark, m => m.append(makePicker(fieldIcon(field), picked => {
          closeMenus()
          if (field.isConnected) setFieldIcon(field, picked, typed)
          else renameSession(key, `${picked} ${typed}`)
        })), { picker: true })
      }
      field.before(mark)
    }
    const shown = fieldIcon(field)
    if (mark.dataset.icon !== (shown || '')) { mark.dataset.icon = shown || ''; mark.replaceChildren(shown ? glyph(shown) : Object.assign(document.createElement('span'), { innerHTML: svg('palette') })) }
  }
}

// --- subsections. A session titled "category / topic" (an icon may lead) belongs to that category. In a
// section's view its sessions are ordered under one collapsible heading per category, sessions with no
// category first. Claude's rows are only reordered (CSS order) and hidden, never moved or rewritten.
const KEY_COLLAPSED = 'doubleSidebar.collapsedSubsections'
// each subsection's icon, by name; one not listed shows none. In a section named Work every subsection is a
// client or employer, so it takes the briefcase
const SUB_ICONS = {
  research: 'search', design: 'pen-tool', build: 'shovel', tool: 'wrench', docs: 'notebook', fix: 'bug',
  plan: 'calendar', output: 'package', housekeeping: 'broom', app: 'beaker', experiment: 'beaker',
}
function subIcon(list, name) {
  const key = name.toLowerCase()
  const icon = SUB_ICONS[key] || (/^work$/i.test(splitName(list.getAttribute('data-group-label') || '').text) ? 'briefcase' : null)
  return icon ? ICON_BY_NAME[icon] : null
}
// the session's full title: its ··· button names it, and still does while the shown label is shortened
function rowTitle(row) {
  const more = row.querySelector('button[aria-label^="More options for "]')?.getAttribute('aria-label')
  return more ? more.slice('More options for '.length).trim() : (row.querySelector('[data-row-label]')?.innerText || '').split('\n')[0].trim()
}
// Inside its subsection a session reads without the category: "output / sketches" shows as "sketches".
// Display only, on the label's own text node; the title itself is untouched and comes back on leaving.
const fullText = new WeakMap()
function labelText(row) {
  const label = row.querySelector('[data-row-label]')
  if (!label) return null
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (fullText.has(n) || / \/ /.test(n.nodeValue)) return n
  return null
}
function shortenLabel(row, on) {
  const node = labelText(row)
  if (!node) return
  const full = fullText.get(node)
  // Claude rewrote it (a rename): what it holds now is the full text
  const current = full && node.nodeValue !== full.short ? null : full
  if (!current && fullText.has(node)) fullText.delete(node)
  if (on) {
    const original = current ? current.original : node.nodeValue
    const { icon, text } = splitName(original)
    const i = text.indexOf(' / ')
    if (i < 0) return
    const short = `${icon ? icon + ' ' : ''}${text.slice(i + 3)}`
    if (node.nodeValue !== short) node.nodeValue = short
    fullText.set(node, { original, short })
  } else if (current) {
    node.nodeValue = current.original
    fullText.delete(node)
  }
}
function categoryOf(title) {
  const { text } = splitName(title)
  const i = text.indexOf(' / ')
  return i > 0 ? text.slice(0, i).trim() : null
}
const flexItems = list => [...list.children].flatMap(c => getComputedStyle(c).display === 'contents' ? [...c.children] : [c])
function clearSubsections(list) {
  if (!list.hasAttribute('data-ds-grouped')) return
  list.removeAttribute('data-ds-grouped')
  list.querySelectorAll('[data-ds-sub]').forEach(h => h.remove())
  for (const el of list.querySelectorAll('[data-ds-sub-hidden]')) el.removeAttribute('data-ds-sub-hidden')
  for (const r of list.querySelectorAll('[data-row-key]')) shortenLabel(r, false)
  for (const el of flexItems(list)) el.style.removeProperty('order')
}
const KEY_SUBS = 'doubleSidebar.subsections'
function groupSubsections(lane) {
  const on = load(KEY_SUBS, true)
  const targets = !on ? [] : lane === 'home'
    ? [...document.querySelectorAll('aside.dframe-sidebar :is([data-group-list][data-group-section^="custom-"], [data-pinned-list])')]
    : [groupEl(lane)].filter(Boolean)
  for (const l of document.querySelectorAll('aside.dframe-sidebar :is([data-group-list], [data-pinned-list])')) if (!targets.includes(l)) clearSubsections(l)
  for (const list of targets) groupList(list, lane !== 'home')
}
function groupList(list, expand = false) {
  const id = list.getAttribute('data-group-list') || 'pinned'
  // every session of the section, not the first few: Claude's Show more, pressed once per visit. In Home only
  // for a section already showing a subsection, so sections without any keep Claude's short list
  const shownCategorized = () => [...list.querySelectorAll('[data-row-key]:not([data-row-key^="label:"])')].some(r => categoryOf(rowTitle(r)))
  if (!list.hasAttribute('data-ds-expanded') && (expand || shownCategorized())) {
    const more = list.querySelector('[data-row-key^="label:showmore:"] button')
    if (more) { list.setAttribute('data-ds-expanded', ''); more.click(); return }
  }
  const items = flexItems(list).filter(el => !el.matches('[data-ds-sub]'))
  // sessions, not the heading or Claude's Show more / Show less row (their keys start with label:)
  const rows = items.filter(el => el.matches('[data-row-key]') && !el.matches('[data-row-key^="label:"]'))
  const cats = new Map()
  for (const r of rows) { const c = categoryOf(rowTitle(r)); if (c) (cats.get(c) || cats.set(c, []).get(c)).push(r) }
  if (!cats.size) { clearSubsections(list); return }
  list.setAttribute('data-ds-grouped', '')
  const collapsed = new Set(load(KEY_COLLAPSED, []))
  const setOrder = (el, o) => { if (el.style.order !== String(o)) el.style.order = String(o) }
  const heading = el => (el.matches('[data-row-key^="label:"]') && !el.matches('[data-row-key^="label:showmore:"]')) || !!el.querySelector?.(':scope > [data-sidebar-group-label], :scope [data-group-toggle]') && !el.matches('[data-row-key]')
  // Pinned's leading block (pinned projects) stays right under its heading
  const leading = el => el.matches('[data-pinned-leading]')
  for (const el of items) setOrder(el, heading(el) ? -2 : leading(el) ? -1 : rows.includes(el) ? 0 : 100000)
  let o = 10
  // headings in the order Claude lists their sessions: A–Z when the section sorts by name, the most recently
  // active first when it sorts by recency (Claude's own Group and sort setting decides)
  const names = [...cats.keys()]
  for (const name of names) {
    const key = `${id}\n${name}`
    let head = [...list.querySelectorAll(':scope > [data-ds-sub]')].find(h => h.dataset.name === name)
    if (!head) {
      head = document.createElement('div')
      head.setAttribute('data-ds-sub', '')
      head.setAttribute('role', 'button')
      head.tabIndex = 0
      head.dataset.name = name
      head.innerHTML = svg('caret') + '<span data-ds-subicon></span><span data-ds-subname></span><span data-ds-count></span>'
      head.querySelector('[data-ds-subname]').textContent = name
      const toggle = () => {
        const set = new Set(load(KEY_COLLAPSED, []))
        set.has(key) ? set.delete(key) : set.add(key)
        save(KEY_COLLAPSED, [...set])
        groupList(list, expand)
      }
      head.onclick = toggle
      head.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }
      list.append(head)
    }
    const shut = collapsed.has(key)
    const ic = subIcon(list, name) || ''
    const slot = head.querySelector('[data-ds-subicon]')
    if (slot && slot.textContent !== ic) { slot.replaceChildren(ic ? glyph(ic) : ''); slot.hidden = !ic }
    head.setAttribute('aria-expanded', String(!shut))
    const count = String(cats.get(name).length)
    if (head.lastChild.textContent !== count) head.lastChild.textContent = count
    setOrder(head, o)
    for (const r of cats.get(name)) { setOrder(r, o + 1); r.toggleAttribute('data-ds-sub-hidden', shut); shortenLabel(r, true) }
    o += 10
  }
  for (const h of list.querySelectorAll(':scope > [data-ds-sub]')) if (!cats.has(h.dataset.name)) h.remove()
  for (const r of rows) if (!categoryOf(rowTitle(r))) { r.removeAttribute('data-ds-sub-hidden'); shortenLabel(r, false) }
}

// "Move to subsection…" in a session's own menu, after Claude's Move to items. It lists the section's
// subsections, takes a new one's name, or clears it; the session is renamed "category / topic" to match.
function sectionCategories(list) {
  const cats = new Set()
  for (const r of list?.querySelectorAll('[data-row-key]:not([data-row-key^="label:"])') || []) { const c = categoryOf(rowTitle(r)); if (c) cats.add(c) }
  return [...cats].sort((a, b) => a.localeCompare(b))
}
function moveToSubsection(row, anchor) {
  const key = row.getAttribute('data-row-key')
  const { icon, text } = splitName(rowTitle(row))
  const i = text.indexOf(' / ')
  const current = i > 0 ? text.slice(0, i).trim() : null
  const topic = i > 0 ? text.slice(i + 3).trim() : text
  const named = cat => `${icon ? icon + ' ' : ''}${cat ? cat + ' / ' : ''}${topic}`
  popMenu(anchor, m => {
    const cats = sectionCategories(row.closest('[data-group-list]'))
    if (cats.length) {
      const h = document.createElement('div'); h.setAttribute('data-ds-heading', ''); h.textContent = 'Subsections'; m.append(h)
      for (const c of cats) item(m, c === current ? `${c}  ✓` : c, 'caret', () => { if (c !== current) renameSession(key, named(c)) })
      m.append(document.createElement('hr'))
    }
    const input = document.createElement('input')
    input.placeholder = 'New subsection'
    input.setAttribute('aria-label', 'New subsection')
    input.onkeydown = e => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      const c = input.value.trim().replace(/\s*\/\s*/g, ' ')
      if (c) { closeMenus(); renameSession(key, named(c)) }
    }
    m.append(input)
    if (current) { m.append(document.createElement('hr')); item(m, 'No subsection', 'more', () => renameSession(key, named(null))) }
  })
  // straight to typing when the section has no subsections yet
  setTimeout(() => { const m = document.querySelector('[data-ds-menu]'); if (m && !m.querySelector('[data-ds-heading]')) m.querySelector('input')?.focus() })
}
function decorateRowMenu() {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (menu.querySelector('[data-ds-menuitem]')) continue
    const trigger = document.getElementById(menu.getAttribute('aria-labelledby') || '')
    const row = trigger?.closest('aside [data-row-key]')
    if (!row || /^label:/.test(row.getAttribute('data-row-key')) || !row.closest('[data-group-list]')) continue
    const after = menu.querySelector('[data-testid="move-to-group-trigger"]')
    const after2 = after?.nextElementSibling?.matches('[role="menuitem"]') ? after.nextElementSibling : after
    const model = [...menu.querySelectorAll('[role="menuitem"]')].find(e => /^Rename/.test(e.textContent.trim()))
    if (!after2 || !model) continue
    const mine = model.cloneNode(true)
    mine.removeAttribute('id'); mine.removeAttribute('aria-keyshortcuts'); mine.removeAttribute('data-highlighted')
    mine.setAttribute('data-ds-menuitem', '')
    mine.querySelectorAll('kbd, [data-cds="Shortcut"]').forEach(k => k.remove())
    const textNode = [...mine.querySelectorAll('*')].reverse().find(e => e.children.length === 0 && /Rename/.test(e.textContent))
    if (textNode) textNode.textContent = 'Move to subsection…'
    mine.onclick = e => {
      e.preventDefault(); e.stopPropagation()
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      setTimeout(() => moveToSubsection(row, row), 60)
    }
    after2.after(mine)
  }
}

function render(aside) {
  // the rail lives on the window frame, not in the sidebar: closed, Claude shrinks the sidebar to its toolbar
  const host = aside.closest('.dframe-root') || aside.parentElement
  host.setAttribute('data-ds-host', '')
  host.toggleAttribute('data-ds-closed', !!document.querySelector('button[aria-label="Show sidebar"]'))
  // the footer's height, so the rail can stop above it while the sidebar is open
  const tray = aside.querySelector('.df-bottom-tray')
  const foot = tray ? `${Math.round(window.innerHeight - tray.getBoundingClientRect().top)}px` : '0px'
  if (host.style.getPropertyValue('--ds-foot') !== foot) host.style.setProperty('--ds-foot', foot)
  // the rail's tint sits on the sidebar's own colour, read off it (Claude paints it, not the frame)
  const bg = getComputedStyle(aside).backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && host.style.getPropertyValue('--ds-rail-base') !== bg) host.style.setProperty('--ds-rail-base', bg)
  let rail = host.querySelector(':scope > [data-ds-rail]')
  if (!rail) { rail = document.createElement('nav'); rail.setAttribute('data-ds-rail', ''); rail.setAttribute('aria-label', 'Sections'); host.append(rail) }
  aside.querySelector(':scope > [data-ds-rail]')?.remove()
  aside.setAttribute('data-ds', '')
  const list = sections()
  let lane = load(KEY_LANE, 'home')
  if (lane !== 'home' && !list.some(s => s.id === lane)) lane = 'home'
  // Claude's account button stays in the page while the sidebar is closed, only faded out with it
  const account = document.querySelector('[data-testid="user-menu-button"]')
  const avatar = account?.querySelector('[data-cds="Avatar"]')
  const subsOn = load(KEY_SUBS, true)
  const sig = JSON.stringify([lane, list, avatar?.outerHTML || '', subsOn])
  if (rail.dataset.sig === sig) return
  rail.dataset.sig = sig
  rail.replaceChildren()
  const button = (label, content, onClick, caps = false) => {
    const b = document.createElement('button')
    b.setAttribute('aria-label', label)
    if (typeof content === 'string') b.innerHTML = svg(content)
    else b.append(content)
    b.onclick = onClick
    b.onpointerenter = () => showTip(b, label, 'right', caps)
    b.onpointerleave = hideTip
    b.onfocus = () => showTip(b, label, 'right', caps)
    b.onblur = hideTip
    rail.append(b)
    return b
  }
  const lanePress = id => () => { hideTip(); save(KEY_LANE, id); render(aside) }
  button('Home', glyph(HOME), lanePress('home')).setAttribute('aria-pressed', String(lane === 'home'))
  rail.append(document.createElement('hr'))
  for (const s of list) {
    const b = button(s.text, glyph(s.icon || FOLDER), lanePress(s.id), true)
    b.setAttribute('aria-pressed', String(lane === s.id))
    b.oncontextmenu = e => {
      e.preventDefault()
      popMenu(b, m => {
        item(m, 'New session', 'plus', () => groupEl(s.id)?.querySelector('button[aria-label^="New session"]')?.click())
        item(m, 'Change icon…', 'palette', () => changeIcon(s.id, b))
        item(m, 'Section options…', 'more', () => claudeSectionMenu(s.id))
      })
    }
  }
  if (list.length) {
    rail.append(document.createElement('hr'))
    const plus = button('New section', 'plus', newSection)
    const circle = document.createElement('span')
    circle.className = 'df-new-circle'
    circle.innerHTML = svg('plus')
    plus.replaceChildren(circle)
  }
  // named for what a click does next
  const subs = button(subsOn ? 'Show all' : 'Show by subsection', 'tree', () => { hideTip(); save(KEY_SUBS, !load(KEY_SUBS, true)); render(aside); groupSubsections(lane) })
  subs.setAttribute('data-ds-subs', '')
  subs.setAttribute('aria-pressed', String(subsOn))
  if (avatar) {
    const me = button((account.innerText || 'Account').split('\n').map(t => t.trim()).filter(t => t.length > 1 && t !== '·').join(' · ') || 'Account', avatar.cloneNode(true), () => {
      hideTip()
      document.querySelector('[data-testid="user-menu-button"]')?.click()
    })
    me.setAttribute('data-ds-avatar', '')
    me.setAttribute('aria-haspopup', 'menu')
  }
  applyLane(aside, lane)
}

function start() {
  let style = document.getElementById('ds-style')
  if (!style) { style = document.createElement('style'); style.id = 'ds-style'; document.head.append(style) }
  style.textContent = STYLE
  let queued = false
  const tick = () => {
    queued = false
    const aside = document.querySelector('aside.dframe-sidebar')
    if (aside) render(aside)
    decorateSectionDialog()
    decorateRename()
    if (aside) groupSubsections(aside.getAttribute('data-ds-lane') || 'home')
    decorateSessionRename()
    decorateRowMenu()
  }
  // next frame, or a timer when the window is in the background and frames are paused
  const run = () => { if (queued) tick() }
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); setTimeout(run, 120) } })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  tick()
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true })
else start()
