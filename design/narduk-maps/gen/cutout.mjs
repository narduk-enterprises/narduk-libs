// Prototype of the narduk-maps "cutout" baker: fetch the OpenFreeMap (OpenStreetMap-derived, keyless)
// vector tiles covering a bbox once, clip each tile to its own box (so fills meet seamlessly and
// strokes never draw tile edges), project with Web Mercator into a fixed viewBox, simplify, and
// write one compact JSON the SVG map draws with zero runtime requests.
// node gen/cutout.mjs <name> <w,s,e,n> <zoom> [width]
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const { VectorTile } = await import(process.env.VT_MOD)
const pbfMod = await import(process.env.PBF_MOD)
const Pbf = pbfMod.PbfReader

// The frame (e.g. 960x720) widens the bbox to its aspect, plus padding, the way fitBounds does.
const [name, bboxArg, zArg, frameArg = '1000x1000', padArg = '24'] = process.argv.slice(2)
const [W0, S0, E0, N0] = bboxArg.split(',').map(Number)
const Z = Number(zArg)
const [WIDTH, FH] = frameArg.split('x').map(Number)
const PAD = 0
const FPAD = Number(padArg)

const mx = (lon) => (lon + 180) / 360
const my = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)
}
let fx0 = mx(W0), fx1 = mx(E0), fy0 = my(N0), fy1 = my(S0)
const scale = Math.min((WIDTH - 2 * FPAD) / (fx1 - fx0), (FH - 2 * FPAD) / (fy1 - fy0))
const cxm = (fx0 + fx1) / 2, cym = (fy0 + fy1) / 2
fx0 = cxm - WIDTH / 2 / scale; fx1 = cxm + WIDTH / 2 / scale; fy0 = cym - FH / 2 / scale; fy1 = cym + FH / 2 / scale
const HEIGHT = FH
const unx = (x) => x * 360 - 180
const uny = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
const P = (wx, wy) => [PAD + (wx - fx0) * scale, PAD + (wy - fy0) * scale]

const n = 2 ** Z
const tx0 = Math.floor(fx0 * n), tx1 = Math.floor(fx1 * n), ty0 = Math.floor(fy0 * n), ty1 = Math.floor(fy1 * n)
const tj = await (await fetch('https://tiles.openfreemap.org/planet')).json()
const tmpl = tj.tiles[0]

// Sutherland–Hodgman against the tile box [0,E]².
function clipRing(ring, E) {
  const edges = [
    (p) => p[0] >= 0, (p) => p[0] <= E, (p) => p[1] >= 0, (p) => p[1] <= E,
  ]
  const isect = (a, b, k) => {
    const [axis, v] = [[0, 0], [0, E], [1, 0], [1, E]][k]
    const t = (v - a[axis]) / (b[axis] - a[axis])
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
  }
  let out = ring
  for (let k = 0; k < 4 && out.length; k++) {
    const inp = out
    out = []
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length]
      const ci = edges[k](cur), pi = edges[k](prev)
      if (ci) { if (!pi) out.push(isect(prev, cur, k)); out.push(cur) } else if (pi) out.push(isect(prev, cur, k))
    }
  }
  return out
}
function clipLine(line, E) {
  // Keep the parts of a polyline inside the box (segment-wise Liang–Barsky).
  const parts = []
  let cur = []
  for (let i = 1; i < line.length; i++) {
    let [x0, y0] = line[i - 1], [x1, y1] = line[i]
    let t0 = 0, t1 = 1
    const dx = x1 - x0, dy = y1 - y0
    let ok = true
    for (const [p, q] of [[-dx, x0], [dx, E - x0], [-dy, y0], [dy, E - y0]]) {
      if (p === 0) { if (q < 0) { ok = false; break } } else {
        const r = q / p
        if (p < 0) { if (r > t1) { ok = false; break } if (r > t0) t0 = r } else { if (r < t0) { ok = false; break } if (r < t1) t1 = r }
      }
    }
    if (!ok) { if (cur.length > 1) parts.push(cur); cur = []; continue }
    const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy]
    if (!cur.length || t0 > 0) { if (cur.length > 1) parts.push(cur); cur = [a] }
    cur.push(b)
    if (t1 < 1) { parts.push(cur); cur = [] }
  }
  if (cur.length > 1) parts.push(cur)
  return parts
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let md = 0, mi = -1
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (d > md) { md = d; mi = i } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}
const fmt = (v) => Math.round(v)
const dPoly = (rings) => rings.map(dedupe).filter((r) => r.length > 2).map((r) => 'M' + r.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L') + 'Z').join('')
const dedupe = (l) => l.map((p) => [fmt(p[0]), fmt(p[1])]).filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1])
const dLine = (ls) => ls.map(dedupe).filter((l) => l.length > 1).map((l) => 'M' + l.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join('L')).join('')

const layers = { water: [], green: [], shore: [], roadMajor: [], roadMinor: [], state: [] }
const labels = []
const TOL = Number(process.env.TOL || 0.9)
// A tile edge (or an internal split line in the source tiles) is a long, exactly axis-aligned run;
// real shorelines almost never are, so those runs are not stroked.
const onEdge = (a, b, E) => (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5) && Math.hypot(a[0] - b[0], a[1] - b[1]) > E / 64

for (let tx = tx0; tx <= tx1; tx++) {
  for (let ty = ty0; ty <= ty1; ty++) {
    const url = tmpl.replace('{z}', Z).replace('{x}', tx).replace('{y}', ty)
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const vt = new VectorTile(new Pbf(buf))
    const toPx = (p, E) => P((tx + p.x / E) / n, (ty + p.y / E) / n)
    const each = (layerName, fn) => {
      const L = vt.layers[layerName]
      if (!L) return
      for (let i = 0; i < L.length; i++) fn(L.feature(i), L.extent)
    }
    const polys = (f, E) => f.loadGeometry().map((r) => clipRing(r.map((p) => [p.x, p.y]), E)).filter((r) => r.length > 2)
    each('water', (f, E) => {
      const rings = polys(f, E)
      layers.water.push(rings.map((r) => simplify(r.map((p) => toPx({ x: p[0], y: p[1] }, E)), TOL)).filter((r) => r.length > 2))
      // Shoreline: the clipped rings minus the tile-box edges.
      for (const r of rings) {
        let run = []
        for (let i = 0; i < r.length; i++) {
          const a = r[i], b = r[(i + 1) % r.length]
          if (onEdge(a, b, E)) { if (run.length > 1) layers.shore.push(simplify(run, TOL)); run = []; continue }
          if (!run.length) run.push(toPx({ x: a[0], y: a[1] }, E))
          run.push(toPx({ x: b[0], y: b[1] }, E))
        }
        if (run.length > 1) layers.shore.push(simplify(run, TOL))
      }
    })
    each('park', (f, E) => layers.green.push(polys(f, E).map((r) => simplify(r.map((p) => toPx({ x: p[0], y: p[1] }, E)), TOL))))
    each('landcover', (f, E) => {
      if (Z < 12 || !['wood'].includes(f.properties.class)) return
      layers.green.push(polys(f, E).map((r) => simplify(r.map((p) => toPx({ x: p[0], y: p[1] }, E)), TOL)))
    })
    each('transportation', (f, E) => {
      const c = f.properties.class
      const major = (Z >= 12 ? ['motorway', 'trunk', 'primary', 'secondary'] : ['motorway', 'trunk']).includes(c)
      const minor = ['tertiary'].includes(c) && Z >= 12
      if (!major && !minor) return
      if (f.type !== 2) return
      for (const line of f.loadGeometry()) {
        for (const part of clipLine(line.map((p) => [p.x, p.y]), E)) (major ? layers.roadMajor : layers.roadMinor).push(simplify(part.map((p) => toPx({ x: p[0], y: p[1] }, E)), TOL))
      }
    })
    each('boundary', (f, E) => {
      if (f.properties.admin_level !== 4 || f.properties.maritime) return
      for (const line of f.loadGeometry()) for (const part of clipLine(line.map((p) => [p.x, p.y]), E)) layers.state.push(simplify(part.map((p) => toPx({ x: p[0], y: p[1] }, E)), TOL))
    })
    each('place', (f, E) => {
      const c = f.properties.class
      if (!['city', 'town'].includes(c)) return
      const [p] = f.loadGeometry()[0]
      if (p.x < 0 || p.y < 0 || p.x > E || p.y > E) return
      const [x, y] = toPx(p, E)
      labels.push({ text: f.properties['name:latin'] || f.properties.name, x: fmt(x), y: fmt(y), kind: 'place', rank: { city: 0, town: 1, village: 2 }[c] })
    })
    each('water_name', (f, E) => {
      if (f.type !== 1) return
      const [p] = f.loadGeometry()[0]
      if (p.x < 0 || p.y < 0 || p.x > E || p.y > E) return
      const [x, y] = toPx(p, E)
      labels.push({ text: f.properties['name:latin'] || f.properties.name, x: fmt(x), y: fmt(y), kind: 'water', rank: 3 })
    })
  }
}

const inFrame = (l) => l.x > 0 && l.y > 0 && l.x < WIDTH && l.y < HEIGHT
const cutout = {
  name,
  bbox: [unx(fx0), uny(fy1), unx(fx1), uny(fy0)],
  viewBox: [WIDTH, HEIGHT],
  zoom: Z,
  layers: [
    { id: 'water', d: layers.water.map(dPoly).join('') },
    { id: 'green', d: layers.green.map(dPoly).join('') },
    { id: 'shore', d: dLine(layers.shore) },
    { id: 'roadMinor', d: dLine(layers.roadMinor) },
    { id: 'roadMajor', d: dLine(layers.roadMajor) },
    { id: 'state', d: dLine(layers.state) },
  ],
  labels: [...new Map(labels.filter(inFrame).map((l) => [l.text + l.kind, l])).values()],
  attribution: '© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap',
}
mkdirSync(join(here, 'cutouts'), { recursive: true })
const json = JSON.stringify(cutout)
writeFileSync(join(here, 'cutouts', `${name}.json`), json)
console.log(name, `${WIDTH}x${HEIGHT}`, 'tiles', (tx1 - tx0 + 1) * (ty1 - ty0 + 1), 'raw', json.length, 'gz', gzipSync(json).length, 'labels', cutout.labels.length)
