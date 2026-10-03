---
'@narduk-enterprises/narduk-mapkit': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-mapkit: paint vector tiles off the main thread. `serveVectorTileWorker` (in `./vector-tiles`) hosts decode and paint in one worker: it keeps each tile it decodes and paints it on an `OffscreenCanvas`. `createWorkerTileService` (in `./client`) is the main-thread half; pass its `decode` and `painter` to `createVectorTileOverlaySource`, which gains an optional `painter`. A style function crosses to the worker as data through `portableVectorTileStyle(name, params, factory)`. Anything the worker cannot paint (no `OffscreenCanvas`, a plain style function, an unknown factory, a missed reply) is painted on the main thread as before, and hit-testing and the highlight stay on the main thread. MapKit is handed a `bitmaprenderer` canvas by default, because MapKit JS 6 draws a returned `ImageBitmap`'s translucent pixels darker than the same pixels from a canvas. create-narduk-app: pin the new narduk-mapkit.
