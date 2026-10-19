(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
  const out = []
  const scroll = document.querySelector('.dframe-nav-scroll')
  // the sidebar's root: walk up from the scroll area while width stays sidebar-sized
  let root = scroll; while (root.parentElement && root.parentElement.getBoundingClientRect().width < 400) root = root.parentElement
  const attrs = n => [...n.attributes].filter(a => !['class','style'].includes(a.name)).map(a => a.name + (a.value ? '=' + a.value.slice(0, 40) : '')).join(' ')
  out.push('ROOT ' + root.tagName + ' {' + attrs(root) + '} .' + String(root.className).slice(0, 80))
  for (const c of root.children) { const r = c.getBoundingClientRect(); out.push('  child ' + c.tagName + ' {' + attrs(c) + '} ' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)) }
  for (const l of document.querySelectorAll('[data-group-list]')) {
    if (!vis(l)) continue
    const rows = [...l.querySelectorAll('[data-row-key]')].filter(vis)
    out.push(`GROUP "${l.getAttribute('data-group-label')}" {${attrs(l)}} rows=${rows.length}`)
    for (const r of rows.slice(0, 4)) out.push('   ' + r.getAttribute('data-row-key') + ' | ' + (r.innerText || '').trim().split('\n')[0].slice(0, 50))
  }
  return out.join('\n')
})()
