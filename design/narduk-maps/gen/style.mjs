// Candidate basemap looks for the narduk-maps design round. Pure style JSON over
// OpenFreeMap's keyless OpenMapTiles source (no sprite, no POIs). The chosen look is
// handed to the package's createBasemapStyle as its token values.
export const LOOKS = {
  harbor: {
    light: {
      land: '#f6f5f1', water: '#d3e2eb', shore: '#8fb0c4', halo: '#b9d0de',
      green: '#e9eee2', road: '#e4e1d8', roadMajor: '#dcd7cb', boundary: '#b7bec5',
      label: '#2b3742', labelHalo: '#f6f5f1', waterLabel: '#5d7f95',
    },
    dark: {
      land: '#1a2128', water: '#0f1a22', shore: '#3f5f73', halo: '#1d3240',
      green: '#1c2620', road: '#262e36', roadMajor: '#2e3740', boundary: '#4b5864',
      label: '#d2dae1', labelHalo: '#1a2128', waterLabel: '#7d9bb0',
    },
  },
  ink: {
    light: {
      land: '#ffffff', water: '#eef1f3', shore: '#5b6670', halo: '#eef1f3',
      green: '#ffffff', road: '#eceef0', roadMajor: '#e2e5e8', boundary: '#c5cbd0',
      label: '#1f2a33', labelHalo: '#ffffff', waterLabel: '#7a8792',
    },
    dark: {
      land: '#11161b', water: '#1a2026', shore: '#8b98a3', halo: '#1a2026',
      green: '#11161b', road: '#1d242a', roadMajor: '#252d34', boundary: '#3a444d',
      label: '#e3e8ec', labelHalo: '#11161b', waterLabel: '#8b98a3',
    },
  },
}

export function basemapStyle(look = 'harbor', scheme = 'light', { labels = 'places' } = {}) {
  const c = LOOKS[look][scheme]
  const layers = [
    { id: 'land', type: 'background', paint: { 'background-color': c.land } },
    {
      id: 'green', type: 'fill', source: 'omt', 'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]],
      paint: { 'fill-color': c.green, 'fill-opacity': 0.7 },
    },
    {
      id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park',
      paint: { 'fill-color': c.green, 'fill-opacity': 0.8 },
    },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water } },
    // Shoreline halo: a soft band on the water side (positive offset is the polygon interior).
    {
      id: 'shore-halo', type: 'line', source: 'omt', 'source-layer': 'water',
      paint: { 'line-color': c.halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 14, 10], 'line-offset': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 5], 'line-blur': 2, 'line-opacity': 0.9 },
    },
    {
      id: 'shore', type: 'line', source: 'omt', 'source-layer': 'water',
      paint: { 'line-color': c.shore, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 1.4] },
    },
    {
      id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 11,
      paint: { 'line-color': c.water, 'line-width': 1 },
    },
    {
      id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 3] },
    },
    {
      id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadMajor, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.6, 16, 5] },
    },
    {
      id: 'state-line', type: 'line', source: 'omt', 'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': c.boundary, 'line-width': 1, 'line-dasharray': [3, 2] },
    },
  ]
  if (labels === 'places') {
    layers.push(
      {
        id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
        filter: ['in', ['get', 'class'], ['literal', ['bay', 'sea', 'lake', 'ocean', 'strait']]],
        layout: { 'text-field': ['get', 'name:latin'], 'text-font': ['Noto Sans Italic'], 'text-size': 11, 'text-letter-spacing': 0.05, 'text-max-width': 6 },
        paint: { 'text-color': c.waterLabel, 'text-halo-color': c.water, 'text-halo-width': 1.2 },
      },
      {
        id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-field': ['get', 'name:latin'], 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase',
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 9, 13, 11], 'text-letter-spacing': 0.08, 'text-max-width': 8,
        },
        paint: { 'text-color': c.label, 'text-opacity': 0.72, 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6 },
      },
    )
  }
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap' } },
    layers,
  }
}
