// Renders the GL looks with real MapLibre + OpenFreeMap tiles for the canvas boards.
// node gen/render.mjs [look...]  -> gen/renders/<scene>.<look>-<scheme>.png
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { basemapStyle } from './style.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(process.env.PW_CORE)
const MAPLIBRE = process.env.MAPLIBRE_DIST
const data = JSON.parse(readFileSync(join(here, 'data.json'), 'utf8'))
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

const points = {
  type: 'FeatureCollection',
  features: data.points.map((p) => ({ type: 'Feature', properties: { ...STATUS[p.status], ...(p.id === 'W-02' ? { r: 10 } : {}), icon: `pin-${p.status}${p.id === 'W-02' ? '-hl' : ''}`, status: p.status, highlight: p.id === 'W-02' }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
}
const covid = data.marcSummary['sars-cov-2']
const counties = {
  ...data.marcGeo,
  features: data.marcGeo.features.map((f) => {
    const c = covid[f.properties.fips]
    return { ...f, properties: { ...f.properties, fill: c?.level ? LEVEL[c.level] : null, nodata: !c?.level } }
  }),
}

const SCENES = {
  aquidneck: { bounds: [[-71.36, 41.45], [-71.19, 41.66]], kind: 'aq' },
  marc: { bounds: [[-95.1, 38.33], [-93.95, 39.53]], kind: 'marc' },
}
const SIZES = { desk: [960, 720], phone: [375, 480] }
// SCENES=aquidneck node gen/render.mjs harbor ink   (default: every scene)
const only = process.env.SCENES?.split(',')

const browser = await chromium.launch()
const looks = process.argv.slice(2).length ? process.argv.slice(2) : ['harbor', 'ink']
for (const look of looks) {
  for (const scheme of ['light', 'dark']) {
    for (const [sceneId, scene] of Object.entries(SCENES)) {
      if (only && !only.includes(sceneId)) continue
      for (const [sizeId, [w, h]] of Object.entries(SIZES)) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
        page.on('crash', () => console.error('crash', sceneId, sizeId))
        page.on('pageerror', (e) => console.error('pageerror', e.message))
        await page.setContent(`<html><body style="margin:0"><div id="m" style="width:${w}px;height:${h}px"></div></body></html>`)
        await page.addScriptTag({ path: MAPLIBRE })
        await page.evaluate(
          async ({ style, scene, points, counties, towns, scheme, sizeId }) => {
            const ink = scheme === 'dark' ? '#d2dae1' : '#2b3742'
            const surface = scheme === 'dark' ? '#1a2128' : '#ffffff'
            const map = new maplibregl.Map({ container: 'm', style, bounds: scene.bounds, fitBoundsOptions: { padding: sizeId === 'phone' ? 16 : 32 }, attributionControl: { compact: true }, fadeDuration: 0, interactive: false })
            await new Promise((r) => map.on('load', r))
            if (scene.kind === 'aq') {
              map.addSource('towns', { type: 'geojson', data: towns })
              map.addLayer({ id: 'towns', type: 'line', source: 'towns', paint: { 'line-color': ink, 'line-opacity': 0.35, 'line-width': 1.2, 'line-dasharray': [4, 2] } }, 'water-name')
            }
            const hatch = document.createElement('canvas')
            hatch.width = hatch.height = 8
            const g = hatch.getContext('2d')
            g.fillStyle = scheme === 'dark' ? '#232b33' : '#f1f1ee'
            g.fillRect(0, 0, 8, 8)
            g.strokeStyle = scheme === 'dark' ? '#4b5864' : '#b9bfc5'
            g.lineWidth = 1
            g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke()
            map.addImage('hatch', g.getImageData(0, 0, 8, 8), { pixelRatio: 2 })
            if (scene.kind === 'marc') {
              map.addSource('c', { type: 'geojson', data: counties })
              map.addLayer({ id: 'c-fill', type: 'fill', source: 'c', filter: ['!', ['get', 'nodata']], paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.88 } }, 'water-name')
              map.addLayer({ id: 'c-none', type: 'fill', source: 'c', filter: ['get', 'nodata'], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.9 } }, 'water-name')
              map.addLayer({ id: 'c-line', type: 'line', source: 'c', paint: { 'line-color': surface, 'line-width': 1.5 } }, 'water-name')
              map.addLayer({ id: 'c-label', type: 'symbol', source: 'c', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08 }, paint: { 'text-color': ink, 'text-halo-color': surface, 'text-halo-width': 1.4 } })
              for (const id of ['place']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
            }
            if (scene.kind === 'aq') {
              // Pins are a symbol layer (one canvas-drawn image per status), so the basemap labels,
              // also symbols, collide with them. Pins always draw (icon-allow-overlap) and still reserve space.
              const drawn = new Set()
              for (const f of points.features) {
                const { icon, r, fill, stroke, sw, core } = f.properties
                if (drawn.has(icon)) continue
                drawn.add(icon)
                const size = Math.ceil(2 * (r + sw / 2 + 1))
                const cv = document.createElement('canvas')
                cv.width = cv.height = size * 2
                const g2 = cv.getContext('2d')
                g2.scale(2, 2)
                g2.beginPath(); g2.arc(size / 2, size / 2, r, 0, Math.PI * 2)
                g2.fillStyle = fill; g2.fill()
                g2.lineWidth = sw; g2.strokeStyle = stroke; g2.stroke()
                if (core) { g2.beginPath(); g2.arc(size / 2, size / 2, 2.5, 0, Math.PI * 2); g2.fillStyle = '#ffffff'; g2.fill() }
                map.addImage(icon, g2.getImageData(0, 0, size * 2, size * 2), { pixelRatio: 2 })
              }
              map.addSource('p', { type: 'geojson', data: points })
              map.addLayer({ id: 'p', type: 'symbol', source: 'p', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': false, 'icon-padding': 2, 'symbol-sort-key': ['case', ['get', 'highlight'], 2, 1] } })
              // Town labels step around the pins: first free side wins, offset clear of the pin radius.
              if (map.getLayer('place')) {
                map.setLayoutProperty('place', 'text-variable-anchor', ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'])
                map.setLayoutProperty('place', 'text-radial-offset', 1.5)
                map.setLayoutProperty('place', 'text-justify', 'auto')
                map.setLayoutProperty('place', 'text-padding', 2)
              }
            }
            await Promise.race([new Promise((r) => map.once('idle', r)), new Promise((r) => setTimeout(r, 20000))])
            // Drop any label that touches the frame edge (clipped text reads as a bug). A symbol
            // query over a thin edge strip returns the labels whose text box reaches it.
            const W = map.getContainer().clientWidth, H = map.getContainer().clientHeight
            const strips = [[[0, 0], [W, 12]], [[0, H - 28], [W, H]], [[0, 0], [12, H]], [[W - 12, 0], [W, H]]]
            const targets = ['place', 'water-name', 'c-label'].filter((id) => map.getLayer(id))
            for (const id of targets) {
              const field = id === 'c-label' ? 'name' : 'name:latin'
              const base = map.getFilter(id)
              const dropped = new Set()
              for (let pass = 0; pass < 4; pass++) {
                const hit = new Set(strips.flatMap((b) => map.queryRenderedFeatures(b, { layers: [id] })).map((f) => f.properties[field]))
                const fresh = [...hit].filter((n) => n && !dropped.has(n))
                if (!fresh.length) break
                fresh.forEach((n) => dropped.add(n))
                const keep = ['!', ['in', ['get', field], ['literal', [...dropped]]]]
                map.setFilter(id, base ? ['all', base, keep] : keep)
                await new Promise((r) => map.once('idle', r))
              }
            }
            map.triggerRepaint()
            await Promise.race([new Promise((r) => map.once('idle', r)), new Promise((r) => setTimeout(r, 20000))])
          },
          { style: basemapStyle(look, scheme), scene, points, counties, towns: data.towns, scheme, sizeId },
        ).catch(async (e) => {
          console.error(sceneId, e.message)
        })
        await page.waitForTimeout(400)
        const file = join(out, `${sceneId}.${sizeId}.${look}-${scheme}.png`)
        await page.screenshot({ path: file })
        console.log(file)
        await page.close()
      }
    }
  }
}
await browser.close()
