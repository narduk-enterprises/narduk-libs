// Draws a baked cutout (gen/cutouts/<name>.json) as one static SVG with the harbor tokens,
// plus the scene's own data on top, and screenshots it next to the GL renders.
// node gen/cutsvg.mjs  -> gen/renders/<scene>.<size>.cutout-<scheme>.png and gen/cutouts/<scene>-<scheme>.svg
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { LOOKS } from './style.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(join(here, 'data.json'), 'utf8'))
// Census TIGERweb county outlines (public domain) follow the river, unlike the app's simplified shapes.
const tiger = JSON.parse(readFileSync(join(here, 'counties.tiger.json'), 'utf8'))
data.marcGeo = { type: 'FeatureCollection', features: tiger.features.map((f) => ({ ...f, properties: { fips: f.properties.GEOID, name: f.properties.NAME.replace(/ County$/, '') } })) }
const out = join(here, 'renders')
mkdirSync(out, { recursive: true })

const STATUS = {
  'Not started': { r: 5, fill: '#c3cad0', stroke: '#5b6b75', sw: 1.5 },
  Planning: { r: 6, fill: '#ffffff', stroke: '#8ea6c4', sw: 3.5 },
  Funded: { r: 7, fill: '#c98f1a', stroke: '#ffffff', sw: 2 },
  'In progress': { r: 7, fill: '#24689f', stroke: '#ffffff', sw: 2 },
  Complete: { r: 7, fill: '#1d5c3a', stroke: '#ffffff', sw: 2, core: true },
}
const LEVEL = { 'Very Low': '#dbe9f4', Low: '#9fc5e3', Moderate: '#f2c45a', High: '#e07b39', 'Very High': '#bf3b2c' }

function projector(c) {
  const [W0, , E0, N0] = c.bbox
  const mx = (lon) => (lon + 180) / 360
  const my = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
  const k = c.viewBox[0] / (mx(E0) - mx(W0))
  return ([lon, lat]) => [(mx(lon) - mx(W0)) * k, (my(lat) - my(N0)) * k]
}
const ringD = (P, ring) => {
  const pts = ring.map(P).map(([x, y]) => [Math.round(x), Math.round(y)]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
  return 'M' + pts.map((p) => p.join(' ')).join('L') + 'Z'
}
const geomD = (P, g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((poly) => poly.map((r) => ringD(P, r))).join('')
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

function svg(sceneId, sizeId, scheme, opts = {}) {
  const c = JSON.parse(readFileSync(join(here, 'cutouts', `${sceneId}.${sizeId}.json`), 'utf8'))
  const t = LOOKS.harbor[scheme]
  const P = projector(c)
  const L = Object.fromEntries(c.layers.map((l) => [l.id, l.d]))
  const [w, h] = c.viewBox
  const ink = t.label
  // KC dark: rivers cross light county fills, so a near-black river and near-black outlines read as cracks.
  // Rivers take a mid blue, outlines the boundary token one step lighter, label halos a slate instead of black.
  const marcDark = sceneId === 'marc' && scheme === 'dark'
  const waterFill = marcDark ? '#2c4c62' : t.water
  const haloStroke = marcDark ? '#4a7189' : t.halo
  const shoreStroke = marcDark ? '#7396ad' : t.shore
  const countyLine = marcDark ? '#7a8895' : scheme === 'dark' ? '#1a2128' : '#ffffff'
  const labelHalo = marcDark ? '#33414d' : t.labelHalo
  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="group" aria-label="${sceneId} map" font-family="Inter, system-ui, sans-serif">`)
  parts.push(`<defs><clipPath id="water-clip"><path d="${L.water}"/></clipPath><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${scheme === 'dark' ? '#232b33' : '#f1f1ee'}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${scheme === 'dark' ? '#4b5864' : '#b9bfc5'}" stroke-width="1.2"/></pattern></defs>`)
  parts.push(`<rect width="${w}" height="${h}" fill="${t.land}"/>`)
  parts.push(`<path d="${L.green}" fill="${t.green}" opacity="0.8"/>`)
  if (sceneId === 'marc') {
    const covid = data.marcSummary['sars-cov-2']
    for (const f of data.marcGeo.features) {
      const lv = covid[f.properties.fips]?.level
      parts.push(`<path d="${geomD(P, f.geometry)}" fill="${lv ? LEVEL[lv] : 'url(#hatch)'}" fill-opacity="${lv ? 0.85 : 1}"/>`)
    }
  }
  parts.push(`<path d="${L.water}" fill="${waterFill}" stroke="${waterFill}" stroke-width="0.8"/>`)
  // Shoreline halo: a wide soft stroke clipped to the water, so it only shows on the water side.
  parts.push(`<path d="${L.shore}" fill="none" stroke="${haloStroke}" stroke-width="7" stroke-linejoin="round" clip-path="url(#water-clip)" opacity="0.9"/>`)
  parts.push(`<path d="${L.shore}" fill="none" stroke="${shoreStroke}" stroke-width="1.1" stroke-linejoin="round"/>`)
  parts.push(`<path d="${L.roadMinor}" fill="none" stroke="${sceneId === 'marc' ? ink : t.road}" stroke-opacity="${sceneId === 'marc' ? 0.12 : 1}" stroke-width="0.8" stroke-linecap="round"/>`)
  parts.push(`<path d="${L.roadMajor}" fill="none" stroke="${sceneId === 'marc' ? ink : t.roadMajor}" stroke-opacity="${sceneId === 'marc' ? 0.16 : 1}" stroke-width="${sceneId === 'marc' ? 0.9 : 1.6}" stroke-linecap="round" stroke-linejoin="round"/>`)
  parts.push(`<path d="${L.state}" fill="none" stroke="${t.boundary}" stroke-width="1" stroke-dasharray="4 3"/>`)
  const label = (x, y, text, { size = 11, italic = false, color = ink, op = 0.78, weight = 700, caps = true, halo = labelHalo } = {}) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="${weight}" ${italic ? 'font-style="italic"' : ''} letter-spacing="${caps ? '0.08em' : '0.02em'}" fill="${color}" fill-opacity="${op}" stroke="${halo}" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(caps ? text.toUpperCase() : text)}</text>`
  // Label placer: pins and earlier labels are obstacles; try the anchor, then above, below, right, left.
  // A label whose box leaves the frame is dropped (or clamped, for a jurisdiction that must be named).
  const obstacles = []
  const pins = []
  const placed = []
  const boxOf = (x, y, text, size, caps) => {
    const tw = text.length * size * (caps ? 0.72 : 0.56) + 6
    return [x - tw / 2, y - size, x + tw / 2, y + 3]
  }
  const hits = (b, o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]
  const inside = (b) => b[0] >= 4 && b[1] >= 4 && b[2] <= w - 4 && b[3] <= h - 22
  function place(x, y, text, opts, { clamp = false } = {}) {
    const size = opts.size ?? 11, caps = opts.caps ?? true
    const d = size + 6
    for (const [dx, dy] of [[0, 0], [0, -d], [0, d], [d * 2.5, 0], [-d * 2.5, 0], [0, -2 * d], [0, 2 * d]]) {
      let b = boxOf(x + dx, y + dy, text, size, caps)
      let ox = 0, oy = 0
      if (clamp && !inside(b)) {
        ox = Math.max(0, 4 - b[0]) - Math.max(0, b[2] - (w - 4)); oy = Math.max(0, 4 - b[1]) - Math.max(0, b[3] - (h - 22))
        b = [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy]
      }
      if (!inside(b) || obstacles.some((o) => hits(b, o))) continue
      obstacles.push(b)
      placed.push(label(Math.round(x + dx + ox), Math.round(y + dy + oy), text, opts))
      return true
    }
    return false
  }
  const pin = (x, y, r, svgText) => { obstacles.push([x - r - 2, y - r - 2, x + r + 2, y + r + 2]); pins.push(svgText) }
  if (sceneId === 'aquidneck') {
    parts.push(`<path d="${data.towns.features.map((f) => geomD(P, f.geometry)).join('')}" fill="none" stroke="${ink}" stroke-opacity="0.35" stroke-width="1.2" stroke-dasharray="5 3"/>`)
    for (const p of opts.points === false ? [] : data.points) {
      const s = STATUS[p.status]
      const [x, y] = P([p.lon, p.lat])
      const r = p.id === 'W-02' && opts.highlight !== false ? 10 : s.r
      pin(x, y, r, `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.sw}"/>` + (s.core ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="#fff"/>` : ''))
    }
    const own = ['Newport', 'Middletown', 'Portsmouth']
    for (const l of [...c.labels].sort((a, b) => own.includes(b.text) - own.includes(a.text)))
      place(l.x, l.y, l.text, { size: sizeId === 'phone' ? 10 : 12, op: own.includes(l.text) ? 0.85 : 0.5 })
  } else if (sceneId !== 'marc') {
    // Any other place: the basemap alone, with its own labels.
    for (const l of [...c.labels].sort((a, b) => a.rank - b.rank)) place(l.x, l.y, l.text, l.kind === 'water' ? { size: 11, italic: true, caps: false, weight: 500, color: t.waterLabel, halo: t.water } : { size: l.rank === 0 ? 13 : 11, op: l.rank === 0 ? 0.85 : 0.6 })
  } else {
    parts.push(`<path d="${data.marcGeo.features.map((f) => geomD(P, f.geometry)).join('')}" fill="none" stroke="${countyLine}" stroke-width="1.6" stroke-linejoin="round"/>`)
    for (const f of data.marcGeo.features) {
      // Label at the bbox centre of the largest ring (prototype; the package uses a pole of inaccessibility).
      const rings = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0])
      const ring = rings.sort((a, b) => b.length - a.length)[0].map(P)
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
      place((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2 + 6, f.properties.name, { size: sizeId === 'phone' ? 9 : 12, op: 0.85 }, { clamp: true })
    }
    const cities = sizeId === 'phone' ? ['Kansas City'] : ['Kansas City', 'Overland Park', 'Independence', "Lee's Summit", 'Liberty']
    for (const l of c.labels.filter((l) => cities.includes(l.text))) {
      const before = obstacles.length
      obstacles.push([l.x - 3, l.y - 3, l.x + 3, l.y + 3])
      if (place(l.x, l.y - 6, l.text, { size: 10, weight: 500, caps: false, op: 0.7 })) pins.push(`<circle cx="${l.x}" cy="${l.y}" r="2.2" fill="${ink}" fill-opacity="0.7"/>`)
      else obstacles.length = before
    }
  }
  parts.push(...placed, ...pins)
  const aw = Math.round(c.attribution.length * 4.9 + 12)
  parts.push(`<rect x="${w - aw - 4}" y="${h - 19}" width="${aw}" height="15" rx="3" fill="${t.land}" fill-opacity="0.85"/><text x="${w - 10}" y="${h - 8}" text-anchor="end" font-size="9" fill="${ink}" fill-opacity="0.6">${esc(c.attribution)}</text>`)
  parts.push('</svg>')
  return parts.join('')
}

const { chromium } = await import(process.env.PW_CORE)
const browser = await chromium.launch()
const SIZES = { desk: [960, 720], phone: [375, 480] }
for (const scheme of ['light', 'dark']) {
  for (const sceneId of process.env.SCENES?.split(',') ?? ['aquidneck', 'marc']) {
    for (const [sizeId, [w, h]] of Object.entries(SIZES)) {
      if (sceneId === 'aquidneck') writeFileSync(join(here, 'cutouts', `${sceneId}.${sizeId}-${scheme}-empty.svg`), svg(sceneId, sizeId, scheme, { points: false }))
      const s = svg(sceneId, sizeId, scheme)
      writeFileSync(join(here, 'cutouts', `${sceneId}.${sizeId}-${scheme}.svg`), s)
      console.log(sceneId, sizeId, scheme, 'svg', s.length, 'gz', gzipSync(s).length)
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
      const bg = scheme === 'dark' ? '#0f1a22' : LOOKS.harbor.light.water
      await page.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${w}px;height:${h}px">${s.replace('<svg ', `<svg width="${w}" height="${h}" `)}</div></body></html>`)
      await page.screenshot({ path: join(out, `${sceneId}.${sizeId}.cutout-${scheme}.png`) })
      await page.close()
    }
  }
}
await browser.close()
