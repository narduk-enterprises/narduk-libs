import {
  MapKitLayerRegistry,
  createTemporalLayerController,
} from '@narduk-geo/narduk-mapkit/client'

import type {
  MapKitLayerDescriptor,
  MapKitTileOverlayUrlTemplate,
  TemporalFrame,
} from '@narduk-geo/narduk-mapkit/client'

interface TileOverlay {
  opacity: number
}

interface MapHandle {
  addTileOverlay(overlay: TileOverlay): void
  removeTileOverlay(overlay: TileOverlay): void
}

interface MapKitNamespace {
  TileOverlay: new (
    urlTemplate: MapKitTileOverlayUrlTemplate,
    options?: Record<string, unknown>,
  ) => TileOverlay
}

/** Per-date metadata the app owns; the controller only carries it around. */
interface FrameMeta {
  observedFraction: number
}

const BOUNDS = [-97.706, 30.198, -97.692, 30.209] as const

function descriptorFor(frame: TemporalFrame<FrameMeta>): MapKitLayerDescriptor {
  return {
    bounds: BOUNDS,
    id: 'data',
    maximumZ: 12,
    minimumZ: 5,
    urlTemplate: `/tiles/clarity/${frame.id}/{z}/{x}/{y}@{scale}x.png`,
  }
}

/**
 * Wire a date strip to a single dated tile layer.
 *
 * The app owns the strip markup, the play button, and the reduced-motion media
 * query; the controller owns index state, readiness, prefetch, and the loop.
 */
export function mountDateStrip(
  mapkit: MapKitNamespace,
  map: MapHandle,
  dates: ReadonlyArray<TemporalFrame<FrameMeta>>,
) {
  const registry = new MapKitLayerRegistry<TileOverlay>({ crossfadeDurationMs: 400, map, mapkit })
  const latest = dates.at(-1)
  if (latest) registry.register(descriptorFor(latest))

  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  const controller = createTemporalLayerController<FrameMeta>({
    activateWhen: 'first-image',
    crossfadeDurationMs: 400,
    descriptorForFrame: descriptorFor,
    frames: dates,
    index: dates.length - 1,
    layerId: 'data',
    onEvent: (event) => {
      if (event.type === 'change') renderStrip(event.index, event.frame)
      if (event.type === 'readiness') renderLoadProgress(event.progress)
      if (event.type === 'error') reportTileFailure(event.index, event.reason)
    },
    // Warm the next dates so the loop never advances onto an undecoded frame.
    prefetchFrame: (frame, _index, signal) =>
      fetch(`/tiles/clarity/${frame.id}/5/8/12@1x.png`, { signal }),
    reducedMotion: reducedMotion?.matches ?? false,
    registry,
  })

  reducedMotion?.addEventListener('change', (event) => {
    controller.setReducedMotion(event.matches)
  })

  return {
    controller,
    // A scrub is an interaction, so it stops the loop first (DESIGN: "loop
    // stops on any interaction").
    async scrubTo(dateId: string): Promise<void> {
      controller.pause()
      await controller.scrubToId(dateId)
    },
    // Disabled under reduced motion: `play()` refuses and emits a `pause`
    // event with reason `reduced-motion`.
    toggleLoop(): void {
      controller.toggle({ intervalMs: 900, windowSize: 7 })
    },
  }
}

declare function renderStrip(index: number, frame: TemporalFrame<FrameMeta> | undefined): void
declare function renderLoadProgress(progress: number): void
declare function reportTileFailure(index: number, reason: unknown): void
