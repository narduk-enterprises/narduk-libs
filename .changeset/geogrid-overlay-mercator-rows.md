---
'@narduk-enterprises/geogrid-web': patch
---

The overlay now places data rows the way a Web-Mercator basemap draws them
(narduk-libs#930). Both backends (WebGL2 and Canvas2D, including its `drawImage`
blit and stencil clip), the CPU reference renderers and `viewportBBox` used to
map screen rows linearly in latitude and read the viewport's edges as
`center ± latitudeDelta / 2`. A MapKit or Leaflet region's centre is the
Mercator midpoint of the view, so a 25°N–50°N view drew its data up to about 47
px off the basemap on a 900 px map, and the `viewport-*` stretch modes read the
wrong rows. The shaders evaluate the Mercator offset from the centre row in a
cancellation-free form that keeps sub-pixel registration at z20. New `./core`
exports: `viewportDataProjection`, `viewportLatitudeFrame`,
`viewportLatitudeOffset`, `viewportDataU`, `viewportDataV`, `viewportScreenV`,
`viewportScreenVForDataV`, `mercatorY` and `latitudeFromMercatorY`.
`dataUvTransform`, the old linear form, is deprecated and kept only for source
compatibility.
