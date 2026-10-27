// Plain view (#plain): tiles rise in as they scroll into view, numbers count up, and tiles tilt toward the
// pointer. Separate from main.js so it still works where the 3D view can't load.
const plain = document.getElementById('plain')
const still = matchMedia('(prefers-reduced-motion: reduce)').matches

function countUp(el) {
  const to = Number(el.dataset.count)
  const decimals = (el.dataset.count.split('.')[1] ?? '').length
  const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (still) return (el.textContent = fmt(to))
  const t0 = performance.now()
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 1400)
    el.textContent = fmt(to * (1 - (1 - k) ** 3)) // ease-out
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

const reveal = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    e.target.classList.add('in')
    e.target.querySelectorAll('[data-count]').forEach(countUp)
    reveal.unobserve(e.target)
  }
}, { threshold: 0.12 })

plain.querySelectorAll('.tile').forEach((tile, i) => {
  tile.style.setProperty('--d', `${(i % 4) * 80}ms`) // stagger across a row
  reveal.observe(tile)
  tile.querySelectorAll('.chip').forEach((chip, j) => chip.style.setProperty('--i', j))
  if (still) return
  tile.addEventListener('pointermove', (e) => {
    const r = tile.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    tile.style.setProperty('--rx', `${(0.5 - y) * 5}deg`)
    tile.style.setProperty('--ry', `${(x - 0.5) * 5}deg`)
  })
  tile.addEventListener('pointerleave', () => ['--rx', '--ry'].forEach((p) => tile.style.removeProperty(p)))
})

// "Open the 3D room" just presses the header toggle (main.js owns the switch)
plain.querySelectorAll('[data-plain-off]').forEach((b) => b.addEventListener('click', () => {
  scrollTo({ top: 0 })
  document.getElementById('plain-toggle').click()
}))
