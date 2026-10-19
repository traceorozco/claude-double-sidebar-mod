(() => {
  const g = document.querySelector('[data-group-name]')
  let side = g
  while (side && !(side.getBoundingClientRect().height > window.innerHeight * 0.7 && side.getBoundingClientRect().width < 500)) side = side.parentElement
  const attrs = n => [...n.attributes].filter(a => !['class','style'].includes(a.name)).map(a => a.name + (a.value ? '=' + a.value.slice(0, 40) : '')).join(' ')
  const out = []
  const walk = (n, d) => {
    if (d > 9 || out.length > 220) return
    const r = n.getBoundingClientRect()
    const text = n.children.length === 0 ? (n.textContent || '').trim().slice(0, 40) : ''
    out.push('  '.repeat(d) + n.tagName.toLowerCase() + ' {' + attrs(n) + '} .' + String(n.className).slice(0, 60) + ` ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` + (text ? ' "' + text + '"' : ''))
    for (const c of n.children) walk(c, d + 1)
  }
  walk(side, 0)
  return out.join('\n')
})()
