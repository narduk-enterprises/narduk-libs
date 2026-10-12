// Writes the canvas screen fragments (frag/<surface>/<screen>.html) from real data and the uploaded
// map assets, then `dc_new.py build` turns them into the Desktop-App and Phone-App boards.
// node gen/frags.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const data = JSON.parse(readFileSync(join(here, 'data.json'), 'utf8'))
const BLOBS = JSON.parse(readFileSync(join(here, 'assets.json'), 'utf8'))
// An image with no uploaded id yet resolves to a visible PENDING path, so the build never writes "undefined".
const B = new Proxy(BLOBS, { get: (o, k) => o[k] ?? `/_blob/PENDING-${String(k)}` })
const STATES = ['live', 'loading', 'empty', 'error', 'stale', 'dark']

// Measured: gzip -9 of each baked SVG, gzip of maplibre-gl 5.9 dist JS.
const KB = { aqDesk: 83, aqPhone: 28, marcDesk: 56, marcPhone: 36, maplibre: 245 }

const STATUS = [
  { k: 'In progress', shape: 'dot', color: '#24689f' },
  { k: 'Funded', shape: 'dot', color: '#c98f1a' },
  { k: 'Planning', shape: 'ring', color: '#8ea6c4' },
  { k: 'Not started', shape: 'small', color: '#c3cad0' },
  { k: 'Complete', shape: 'core', color: '#1d5c3a' },
]
const count = Object.fromEntries(STATUS.map((s) => [s.k, data.points.filter((p) => p.status === s.k).length]))
const LEVELS = [
  ['Very Low', '#dbe9f4'],
  ['Low', '#9fc5e3'],
  ['Moderate', '#f2c45a'],
  ['High', '#e07b39'],
  ['Very High', '#bf3b2c'],
]
const covid = data.marcSummary['sars-cov-2']
const tiger = JSON.parse(readFileSync(join(here, 'counties.tiger.json'), 'utf8'))
const counties = tiger.features
  .map((f) => ({ fips: f.properties.GEOID, name: f.properties.NAME.replace(/ County$/, ''), state: f.properties.GEOID.startsWith('20') ? 'KS' : 'MO', ...covid[f.properties.GEOID] }))
  .sort((a, b) => a.name.localeCompare(b.name))

// Light and dark tokens (DESIGN.md; dark selected, not inverted).
const T = {
  light: { bg: '#f4f5f6', panel: '#ffffff', ink: '#1f2a33', muted: '#5b6670', chipInk: '#46515b', line: '#e3e7ea', chip: '#eef1f3', water: '#d3e2eb', warn: '#8a5a00', warnBg: '#fdf3dc', err: '#9b2c1f', errBg: '#fbe9e6' },
  dark: { bg: '#11161b', panel: '#1a2128', ink: '#e3e8ec', muted: '#9aa7b2', chipInk: '#b3bec8', line: '#2c353e', chip: '#232b33', water: '#0f1a22', warn: '#f2c45a', warnBg: '#3a2f14', err: '#f0a196', errBg: '#3b1f1b' },
}

// Projection shared with the baked cutouts (fitBounds parity measured at 0.000 px).
function projector(name) {
  const c = JSON.parse(readFileSync(join(here, 'cutouts', `${name}.json`), 'utf8'))
  const [W0, , E0, N0] = c.bbox
  const mx = (lon) => (lon + 180) / 360
  const my = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }
  const k = c.viewBox[0] / (mx(E0) - mx(W0))
  return ([lon, lat]) => [(mx(lon) - mx(W0)) * k, (my(lat) - my(N0)) * k]
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function mark(shape, color, r = 7, dark = false) {
  const ring = dark ? '#1a2128' : '#ffffff'
  const s = 2 * (r + 4)
  const c = r + 4
  const body = {
    dot: `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="${ring}" stroke-width="2"></circle>`,
    ring: `<circle cx="${c}" cy="${c}" r="${r - 1}" fill="${ring}" stroke="${color}" stroke-width="3.5"></circle>`,
    core: `<circle cx="${c}" cy="${c}" r="${r}" fill="${color}" stroke="${ring}" stroke-width="2"></circle><circle cx="${c}" cy="${c}" r="2.5" fill="#ffffff"></circle>`,
    small: `<circle cx="${c}" cy="${c}" r="5" fill="${color}" stroke="#5b6b75" stroke-width="1.5"></circle>`,
    hollow: `<circle cx="${c}" cy="${c}" r="${r - 1}" fill="${ring}" stroke="#8a97a3" stroke-width="2" stroke-dasharray="3 2"></circle>`,
  }[shape]
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true" style="flex: none;">${body}</svg>`
}

const ICON = {
  plus: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"></path></svg>',
  minus: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"></path></svg>',
  layers: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 1.5 5.5 8 9l6.5-3.5L8 2Zm-6.5 6L8 11.5 14.5 8M1.5 10.5 8 14l6.5-3.5" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"></path></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4" fill="none"></circle><path d="M8 4.6V8l2.4 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"></path></svg>',
  alert: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 15 14H1L8 1.8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"></path><path d="M8 6.2v3.6M8 11.8v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path></svg>',
  pin: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.5s-4.6-4.3-4.6-7.6a4.6 4.6 0 0 1 9.2 0c0 3.3-4.6 7.6-4.6 7.6Z" stroke="currentColor" stroke-width="1.4" fill="none"></path><circle cx="8" cy="6.9" r="1.6" fill="currentColor"></circle></svg>',
  bolt: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"></path></svg>',
  retry: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path></svg>',
}

const chip = (t, text, { tone = 'plain', icon = '' } = {}) => {
  const [fg, bg] = { plain: [t.chipInk, t.chip], warn: [t.warn, t.warnBg], err: [t.err, t.errBg] }[tone]
  return `<span style="display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px; background: ${bg}; color: ${fg}; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;">${icon}${text}</span>`
}

function mapFrame(t, src, alt, w, h, overlay = '', { dim = '' } = {}) {
  return `<div style="position: relative; width: ${w}; aspect-ratio: ${h}; border-radius: 12px; overflow: hidden; background: ${t.water}; border: 1px solid ${t.line}; flex: none;">
<img src="${src}" alt="${esc(alt)}" style="display: block; width: 100%; height: 100%; object-fit: cover;${dim}">${overlay}</div>`
}

// A picture of the map's zoom control, not a live one (the canvas shows one frame), so it carries no dead <button>s.
const zoom = (t, disabled = false, phone = false) => {
  const z = phone ? 44 : 36
  const btn = (label, icon) => `<span role="button" aria-label="${label}" ${disabled ? 'aria-disabled="true"' : ''} style="width: ${z}px; height: ${z}px; display: grid; place-items: center; color: ${t.ink}; opacity: ${disabled ? 0.4 : 1};">${icon}</span>`
  return `<div role="group" aria-label="Map zoom" style="position: absolute; ${phone ? 'bottom: 40px' : 'top: 12px'}; right: 12px; display: flex; flex-direction: column; border-radius: 8px; overflow: hidden; background: ${t.panel}; border: 1px solid ${t.line}; box-shadow: 0 1px 2px rgba(15, 25, 35, 0.08);">
${btn('Zoom in', ICON.plus)}<span style="height: 1px; background: ${t.line};"></span>${btn('Zoom out', ICON.minus)}</div>`
}

const cardStyle = (t) => `background: ${t.panel}; color: ${t.ink}; border: 1px solid ${t.line}; border-radius: 10px; box-shadow: 0 6px 20px rgba(15, 25, 35, 0.14);`

function tooltipCard(t, phone, pos, fill = false) {
  const p = data.points.find((q) => q.id === 'W-02')
  const w = phone ? 220 : 248
  return `<div role="tooltip" style="${pos} ${fill ? 'width: 100%;' : `width: ${w}px; max-width: calc(100% - 16px);`} box-sizing: border-box; padding: 10px 12px; ${cardStyle(t)} display: flex; flex-direction: column; gap: 4px;">
<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: ${t.muted}; font-weight: 600;">${mark('ring', '#8ea6c4', 5, t === T.dark)}${p.id} · ${p.status}</span>
<span style="font-size: 14px; font-weight: 600; line-height: 1.3;">${esc(p.title)}</span>
<span style="font-size: 12px; color: ${t.muted};">${p.town} · ${p.theme}</span></div>`
}

// Positioned in frame pixels: `pin` is the pin. The card sits above-right of it, flips left when it would
// pass the right edge, and is clamped so it never leaves the frame.
function tooltip(t, pin, frame, phone = false) {
  const w = phone ? 220 : 248
  const h = phone ? 92 : 80
  const [fw, fh] = frame
  const gap = 14
  let left = pin[0] + gap
  if (left + w > fw - 8) left = pin[0] - gap - w
  left = Math.min(Math.max(left, 8), fw - w - 8)
  const top = Math.min(Math.max(pin[1] - (phone ? 100 : 40), 8), fh - h - 8)
  return tooltipCard(t, phone, `position: absolute; left: ${((left / fw) * 100).toFixed(2)}%; top: ${((top / fh) * 100).toFixed(2)}%;`)
}

// W-02 position inside the 960x720 desk frame, and the 375x480 phone frame.
const W02 = data.points.find((q) => q.id === 'W-02')
const w02desk = projector('aquidneck.desk')([W02.lon, W02.lat])
const w02phone = projector('aquidneck.phone')([W02.lon, W02.lat])
const pct = (v, of) => `${((v / of) * 100).toFixed(2)}%`

function legend(t, { zero = false, dash = false, compact = false } = {}) {
  const rows = STATUS.map((s) => `<li style="display: flex; align-items: center; gap: ${compact ? 6 : 10}px; min-height: 28px;">${mark(s.shape, s.color, 7, t === T.dark)}<span style="flex: 1; font-size: 14px; white-space: nowrap;">${s.k}</span><span style="font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;">${dash ? '—' : zero ? '0' : count[s.k]}</span></li>`).join('')
  return `<ul aria-label="Action status" style="list-style: none; margin: 0; padding: 0; display: ${compact ? 'grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 16px' : 'flex; flex-direction: column'};">${rows}</ul>`
}

function layerToggles(t, disabled = false) {
  const box = `<span aria-hidden="true" style="width: 18px; height: 18px; box-sizing: border-box; border-radius: 4px; border: 1.5px solid ${t.muted}; background: transparent; flex: none;"></span>`
  const row = (label, note) => `<div role="checkbox" aria-checked="false" ${disabled ? 'aria-disabled="true"' : ''} aria-label="${label}" style="display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 14px; color: ${t.ink}; opacity: ${disabled ? 0.45 : 1};">${box}<span style="flex: 1;">${label}</span><span style="font-size: 12px; color: ${t.muted};">${note}</span></div>`
  return `<div role="group" aria-label="Layers" style="display: flex; flex-direction: column;"><span style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.muted};">${ICON.layers}Layers</span>${row('Sea-level rise 3 ft', 'NOAA')}${row('FEMA flood zones', 'z14+')}</div>`
}

// On a phone the zoom control (44px + 12px margin) owns the top-right corner, so status cards stop short of it.
const topCard = () => 'position: absolute; left: 12px; top: 12px;'

function banner(t, tone, icon, text, action = '', phone = false) {
  const [fg, bg] = tone === 'err' ? [t.err, t.errBg] : [t.warn, t.warnBg]
  return `<div role="status" style="${topCard()} width: fit-content; max-width: calc(100% - ${phone ? 80 : 24}px); box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: ${action && phone ? '4px 4px 4px 12px' : '8px 12px'}; border-radius: 10px; background: ${bg}; color: ${fg}; font-size: 13px; font-weight: 600; box-shadow: 0 1px 2px rgba(15, 25, 35, 0.08);">${icon}<span style="flex: 1;">${text}</span>${action}</div>`
}

const retryBtn = (t, to, phone = false) => `<button type="button" onClick="{{go.${to}}}" style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: ${phone ? 44 : 28}px; min-width: ${phone ? 44 : 0}px; padding: 0 ${phone ? 14 : 10}px; border-radius: 8px; border: 1px solid currentColor; background: none; color: inherit; font: inherit; font-size: 12px; flex: none;">${ICON.retry}Retry</button>`

function centerCard(t, title, sub) {
  return `<div role="status" style="position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 260px; max-width: calc(100% - 32px); box-sizing: border-box; padding: 16px; ${cardStyle(t)} text-align: center; display: flex; flex-direction: column; gap: 4px;"><span style="font-size: 15px; font-weight: 700;">${title}</span><span style="font-size: 13px; color: ${t.muted};">${sub}</span></div>`
}

const loadingBar = (t, phone = false) => `<div role="status" aria-label="Loading live map" style="${topCard()} width: fit-content; max-width: calc(100% - ${phone ? 80 : 24}px); box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; ${cardStyle(t)} font-size: 13px; font-weight: 600;"><span style="position: relative; width: 48px; height: 4px; border-radius: 2px; background: ${t.chip}; overflow: hidden; flex: none;"><span style="position: absolute; left: 0; top: 0; bottom: 0; width: 40%; border-radius: 2px; background: #24689f;"></span></span><span>Static map · live map loading</span></div>`

const asOf = (t, date, tone = 'plain') => chip(t, `As of ${date}`, { tone, icon: ICON.clock })
const unlocated = (t) => chip(t, '4 actions without coordinates', { icon: ICON.pin })

function panel(t, inner, extra = '') {
  return `<div style="background: ${t.panel}; color: ${t.ink}; border: 1px solid ${t.line}; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 14px; ${extra}">${inner}</div>`
}
const h2 = (t, text) => `<h2 style="margin: 0; font-size: 16px; font-weight: 700; color: ${t.ink};">${text}</h2>`
const weight = (t, text) => chip(t, text, { icon: ICON.bolt })

function screen(title, byState) {
  return `<section class="scr" aria-label="${esc(title)}">\n${STATES.map((s, i) => `  <sc-if value="{{st.${s}}}" hint-placeholder-val="{{${i === 0}}}">${byState(s)}</sc-if>`).join('\n')}\n</section>\n`
}

function body(t, inner, phone) {
  return `<div style="min-height: 100%; box-sizing: border-box; background: ${t.bg}; color: ${t.ink}; padding: ${phone ? '16px' : '24px 32px'}; display: flex; flex-direction: column; gap: 16px;">${inner}</div>`
}
function head(t, title, chips, phone) {
  return `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px;"><h1 style="margin: 0; font-size: ${phone ? 20 : 24}px; font-weight: 700; color: ${t.ink}; flex: ${phone ? '1 1 100%' : '1'};">${title}</h1>${chips}</div>`
}

// ---------- screens ----------

function aquidneckMap(state, phone) {
  const t = state === 'dark' ? T.dark : T.light
  const sz = phone ? 'phone' : 'desk'
  const gl = B[`aquidneck.${sz}.harbor-${state === 'dark' ? 'dark' : 'light'}.webp`]
  const poster = B[`aquidneck.${sz}-light.svg`]
  const posterEmpty = B[`aquidneck.${sz}-light-empty.svg`]
  const [fw, fh] = phone ? [375, 480] : [960, 720]
  const pin = phone ? w02phone : w02desk
  const showTip = state === 'live' || state === 'dark'
  // Phone: the selected point's card sits under the map, so it never covers pins or clips at the frame.
  const tip = showTip && !phone ? tooltip(t, pin, [fw, fh], phone) : ''
  const phoneTip = showTip && phone ? tooltipCard(t, phone, 'position: relative;', true) : ''
  const attr = `<span style="position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 6px; background: ${t.panel}; color: ${t.muted}; font-size: 11px; opacity: 0.92;">© OpenStreetMap · OpenFreeMap</span>`
  const over = {
    live: zoom(t, false, phone) + tip + attr,
    dark: zoom(t, false, phone) + tip + attr,
    loading: zoom(t, true, phone) + loadingBar(t, phone),
    // The empty poster carries its own baked attribution line, so no second one is overlaid here.
    empty: zoom(t, false, phone) + centerCard(t, 'No located actions', '4 actions have no coordinates'),
    error: zoom(t, true, phone) + banner(t, 'err', ICON.alert, 'Live map unavailable', retryBtn(t, 'aquidneck_map', phone), phone),
    stale: zoom(t, false, phone) + attr,
  }[state]
  const src = { live: gl, dark: gl, stale: gl, loading: poster, error: poster, empty: posterEmpty }[state]
  const alt = 'Aquidneck Island action map'
  const map = mapFrame(t, src, alt, phone ? '100%' : '960px', `${fw} / ${fh}`, over, { dim: state === 'stale' ? ' filter: saturate(0.55);' : '' })
  const date = state === 'stale' ? '6 Sep 2026 · 36 days old' : '6 Oct 2026'
  const chips = asOf(t, date, state === 'stale' ? 'warn' : 'plain') + (state === 'error' ? chip(t, 'Static map shown', { tone: 'err' }) : '')
  const side = panel(t, `${h2(t, 'Status')}${legend(t, { zero: state === 'empty', compact: phone })}${state === 'empty' ? '' : unlocated(t)}<span style="height: 1px; background: ${t.line};"></span>${layerToggles(t, state === 'loading' || state === 'error')}`, phone ? 'align-self: stretch;' : 'width: 320px; flex: none; align-self: flex-start;')
  const engine = weight(t, state === 'loading' || state === 'error' ? `Poster ${phone ? KB.aqPhone : KB.aqDesk} KB · 0 requests` : `GL · maplibre ${KB.maplibre} KB + tiles`)
  return body(t, head(t, 'Island actions', chips + engine, phone) + `<div style="display: flex; ${phone ? 'flex-direction: column;' : ''} gap: 16px; align-items: flex-start;">${map}${phoneTip}${side}</div>`, phone)
}

function aquidneckOverview(state, phone) {
  const t = state === 'dark' ? T.dark : T.light
  const sz = phone ? 'phone' : 'desk'
  const scheme = state === 'dark' ? 'dark' : 'light'
  const full = B[`aquidneck.${sz}-${scheme}.svg`]
  const empty = B[`aquidneck.${sz}-${scheme}-empty.svg`]
  const [fw, fh] = phone ? [375, 480] : [960, 720]
  const over = {
    live: '', dark: '', stale: '',
    loading: `<div role="status" style="position: absolute; left: 12px; top: 12px; padding: 8px 12px; border-radius: 10px; ${cardStyle(t)} font-size: 13px; font-weight: 600;">Loading actions</div>`,
    empty: centerCard(t, 'No located actions', '4 actions have no coordinates'),
    error: banner(t, 'err', ICON.alert, 'Actions failed to load', retryBtn(t, 'aquidneck_overview', false)),
  }[state]
  const src = ['live', 'dark', 'stale'].includes(state) ? full : empty
  const map = mapFrame(t, src, 'Aquidneck Island overview map', phone ? '100%' : '720px', `${fw} / ${fh}`, over, { dim: state === 'stale' ? ' filter: saturate(0.55);' : '' })
  const known = ['live', 'dark', 'stale'].includes(state)
  // Status segments carry their own count. Not started gets an outline so it never reads as Planning's pale blue.
  const SEG_INK = { 'In progress': '#ffffff', Funded: '#1f2a33', Planning: '#1f2a33', 'Not started': '#1f2a33', Complete: '#ffffff' }
  const towns = ['Portsmouth', 'Middletown', 'Newport'].map((town) => {
    const ps = data.points.filter((p) => p.town === town)
    const bar = STATUS.map((s) => { const n = ps.filter((p) => p.status === s.k).length; return n ? `<span aria-label="${s.k} ${n}" style="flex: ${n}; min-width: 0; height: 20px; display: grid; place-items: center; background: ${s.color}; border-radius: 4px; color: ${SEG_INK[s.k]}; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;${s.k === 'Not started' ? ' box-shadow: inset 0 0 0 1.5px #5b6b75;' : ''}">${n}</span>` : '' }).join('')
    return `<li style="display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid ${t.line};"><span style="display: flex; justify-content: space-between; font-size: 14px;"><span style="font-weight: 600;">${town}</span><span style="font-variant-numeric: tabular-nums; color: ${t.muted};">${known ? `${ps.length} actions` : '—'}</span></span>${known ? `<span style="display: flex; gap: 2px;">${bar}</span>` : `<span style="height: 20px; border-radius: 4px; background: ${t.chip};"></span>`}</li>`
  }).join('')
  const side = panel(t, `${h2(t, 'By town')}<ul style="list-style: none; margin: 0; padding: 0;">${towns}</ul>${legend(t, { compact: true, zero: state === 'empty', dash: state === 'loading' || state === 'error' })}`, phone ? 'align-self: stretch;' : 'width: 360px; flex: none; align-self: flex-start;')
  const date = state === 'stale' ? '6 Sep 2026 · 36 days old' : state === 'loading' || state === 'error' ? '—' : '6 Oct 2026'
  const chips = asOf(t, date, state === 'stale' ? 'warn' : 'plain') + weight(t, `SVG ${phone ? KB.aqPhone : KB.aqDesk} KB · 0 requests`)
  return body(t, head(t, 'Aquidneck at a glance', chips, phone) + `<div style="display: flex; ${phone ? 'flex-direction: column;' : ''} gap: 16px; align-items: flex-start;">${map}${side}</div>`, phone)
}

function marcCounties(state, phone) {
  const t = state === 'dark' ? T.dark : T.light
  const sz = phone ? 'phone' : 'desk'
  const src = B[`marc.${sz}-${state === 'dark' ? 'dark' : 'light'}.svg`]
  const [fw, fh] = phone ? [375, 480] : [960, 720]
  const known = ['live', 'dark', 'stale'].includes(state)
  const over = {
    live: '', dark: '', stale: '',
    loading: `<div role="status" style="position: absolute; left: 12px; top: 12px; padding: 8px 12px; border-radius: 10px; ${cardStyle(t)} font-size: 13px; font-weight: 600;">Loading levels</div>`,
    empty: centerCard(t, 'No county levels', 'No sites reported this week'),
    error: banner(t, 'err', ICON.alert, 'Levels failed to load', retryBtn(t, 'marc_counties', false)),
  }[state]
  const dim = known ? (state === 'stale' ? ' opacity: 0.6; filter: saturate(0.5);' : '') : ' opacity: 0.35; filter: grayscale(1);'
  const map = mapFrame(t, src, 'Kansas City region SARS-CoV-2 wastewater level by county', phone ? '100%' : '720px', `${fw} / ${fh}`, over, { dim })
  const scale = `<div style="display: flex; flex-direction: column; gap: 6px;"><span style="display: flex; gap: 2px;">${LEVELS.map(([, c]) => `<span style="flex: 1; height: 10px; background: ${c}; border-radius: 2px;"></span>`).join('')}<span style="flex: 1; height: 10px; border-radius: 2px; background: repeating-linear-gradient(45deg, ${t.chip} 0 3px, #b9bfc5 3px 4px);"></span></span><span style="display: flex; gap: 2px; font-size: 11px; color: ${t.muted};">${[...LEVELS.map(([l]) => l), 'No site'].map((l) => `<span style="flex: 1; text-align: center;">${l}</span>`).join('')}</span></div>`
  const rows = counties.map((c) => {
    const lv = LEVELS.find(([l]) => l === c.level)
    const sw = lv ? `<span style="width: 12px; height: 12px; border-radius: 3px; background: ${lv[1]}; flex: none;"></span>` : `<span style="width: 12px; height: 12px; border-radius: 3px; flex: none; background: repeating-linear-gradient(45deg, ${t.chip} 0 3px, #b9bfc5 3px 4px);"></span>`
    const lvText = known ? (c.level || 'No site') : '—'
    return `<li style="display: flex; align-items: center; gap: 10px; min-height: 30px; border-top: 1px solid ${t.line}; font-size: 14px;">${known ? sw : `<span style="width: 12px; height: 12px; border-radius: 3px; background: ${t.chip}; flex: none;"></span>`}<span style="flex: 1;">${c.name} <span style="color: ${t.muted}; font-size: 12px;">${c.state}</span></span><span style="font-variant-numeric: tabular-nums; color: ${c.level ? t.ink : t.muted};">${lvText}</span></li>`
  }).join('')
  const side = panel(t, `${h2(t, 'SARS-CoV-2 level')}${scale}<ul style="list-style: none; margin: 0; padding: 0;">${rows}</ul>`, phone ? 'align-self: stretch;' : 'width: 360px; flex: none; align-self: flex-start;')
  const date = state === 'stale' ? '27 Sep 2026 · 14 days old' : known ? '11 Oct 2026' : '—'
  const chips = asOf(t, date, state === 'stale' ? 'warn' : 'plain') + weight(t, `SVG ${phone ? KB.marcPhone : KB.marcDesk} KB · 0 requests`)
  return body(t, head(t, 'Kansas City region', chips, phone) + `<div style="display: flex; ${phone ? 'flex-direction: column;' : ''} gap: 16px; align-items: flex-start;">${map}${side}</div>`, phone)
}

// Looks and Pieces are specimen sheets: the data state does not change them, so a non-live state says so.
const galleryChip = (t, state) => (['loading', 'empty', 'error', 'stale'].includes(state) ? chip(t, 'Static gallery') : '')

function looks(state, phone) {
  const t = state === 'dark' ? T.dark : T.light
  const sz = phone ? 'phone' : 'desk'
  const dark = state === 'dark'
  const items = [
    ['Cutout', 'SVG', B[`aquidneck.${sz}-${dark ? 'dark' : 'light'}.svg`], `${phone ? KB.aqPhone : KB.aqDesk} KB · 0 requests`],
    ['Harbor', 'GL', B[`aquidneck.${sz}.harbor-${dark ? 'dark' : 'light'}.webp`], `maplibre ${KB.maplibre} KB + tiles`],
  ]
  items.push(['Ink', 'GL', B[`aquidneck.${sz}.ink-${dark ? 'dark' : 'light'}.webp`], `maplibre ${KB.maplibre} KB + tiles`])
  const [fw, fh] = phone ? [375, 480] : [960, 720]
  const cards = items.map(([name, engine, src, kb]) => `<figure style="margin: 0; display: flex; flex-direction: column; gap: 8px; ${phone ? '' : 'flex: 1; min-width: 0;'}">${mapFrame(t, src, `${name} look, Aquidneck Island`, '100%', `${fw} / ${fh}`)}<figcaption style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px;"><span style="font-size: 15px; font-weight: 700;">${name}</span>${chip(t, engine)}${weight(t, kb)}</figcaption></figure>`).join('')
  return body(t, head(t, 'Looks', chip(t, 'Same projection · 0.000 px drift') + galleryChip(t, state), phone) + `<div style="display: flex; ${phone ? 'flex-direction: column;' : ''} gap: 16px;">${cards}</div>`, phone)
}

function pieces(state, phone) {
  const t = state === 'dark' ? T.dark : T.light
  const dark = state === 'dark'
  const marks = [['dot', '#24689f', 'dot'], ['ring', '#8ea6c4', 'ring'], ['core', '#1d5c3a', 'core'], ['small', '#c3cad0', 'small'], ['hollow', '', 'hollow']]
    .map(([shape, color, name]) => `<li style="display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; color: ${t.muted};">${mark(shape, color, 7, dark)}${name}</li>`).join('') +
    `<li style="display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; color: ${t.muted};">${mark('dot', '#24689f', 10, dark)}highlight</li>`
  const labelBox = `<div style="background: ${dark ? '#1a2128' : '#f6f5f1'}; border-radius: 10px; padding: 14px 16px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 18px; border: 1px solid ${t.line};"><span style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${t.ink}; opacity: 0.85;">Middletown</span><span style="font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${t.ink}; opacity: 0.5;">Tiverton</span><span style="font-size: 12px; font-style: italic; color: ${dark ? '#7d9bb0' : '#5d7f95'};">Narragansett Bay</span><span style="font-size: 10px; font-weight: 500; color: ${t.ink}; opacity: 0.7;">Kansas City</span></div>`
  const swatches = [['land', dark ? '#1a2128' : '#f6f5f1'], ['water', dark ? '#0f1a22' : '#d3e2eb'], ['shore', dark ? '#3f5f73' : '#8fb0c4'], ['halo', dark ? '#1d3240' : '#b9d0de'], ['road', dark ? '#2e3740' : '#dcd7cb'], ['boundary', dark ? '#4b5864' : '#b7bec5']]
    .map(([n, c]) => `<li style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: ${t.muted};"><span style="width: 100%; max-width: 72px; height: 36px; box-sizing: border-box; border-radius: 8px; background: ${c}; border: 1px solid ${dark ? '#5b6a76' : '#c5cbd0'};"></span>${n}<span style="font-variant-numeric: tabular-nums; color: ${t.ink};">${c}</span></li>`).join('')
  const controls = `<div style="position: relative; height: ${phone ? 110 : 92}px; width: 60px;">${zoom(t, false, phone)}</div>`
  const grid = phone ? 'display: flex; flex-direction: column; gap: 16px;' : 'display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start;'
  const ul = (inner, gap = 18) => `<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: ${gap}px;">${inner}</ul>`
  return body(t, head(t, 'Pieces', chip(t, 'NardukGeoMap · NardukMap') + galleryChip(t, state), phone) + `<div style="${grid}">
${panel(t, `${h2(t, 'Marks')}${ul(marks)}`)}
${panel(t, `${h2(t, 'Labels')}${labelBox}`)}
${panel(t, `${h2(t, 'Tokens')}<ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;">${swatches}</ul>`)}
${panel(t, `${h2(t, 'Tooltip')}<div style="position: relative; height: 120px;">${tooltipCard(t, phone, 'position: absolute; left: 0; top: 0;')}</div>`)}
${panel(t, `${h2(t, 'Controls')}<div style="display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap;">${controls}<div style="display: flex; flex-direction: column; gap: 8px;">${asOf(t, '11 Oct 2026')}${asOf(t, '27 Sep 2026 · 14 days old', 'warn')}${chip(t, 'Static map shown', { tone: 'err' })}${unlocated(t)}</div></div>`)}
${panel(t, `${h2(t, 'Status legend')}${legend(t)}`)}
</div>`, phone)
}

const SCREENS = { 'aquidneck-map': ['Island actions', aquidneckMap], 'aquidneck-overview': ['Aquidneck at a glance', aquidneckOverview], 'marc-counties': ['Kansas City region', marcCounties], looks: ['Looks', looks], pieces: ['Pieces', pieces] }
for (const [surface, phone] of [['desktop', false], ['phone', true]]) {
  for (const [id, [title, fn]] of Object.entries(SCREENS)) {
    const html = screen(title, (s) => fn(s, phone))
    writeFileSync(join(root, 'frag', surface, `${id}.html`), html)
    console.log(surface, id, html.length)
  }
}
