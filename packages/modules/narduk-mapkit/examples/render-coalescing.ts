import {
  createMapKitFocusPreserver,
  createMapKitHtmlSlotRenderer,
  createMapKitRenderScheduler,
} from '@narduk-enterprises/narduk-mapkit/client'

interface MapPanels {
  legend: HTMLElement
  markers: () => void
  readout: HTMLElement
}

/**
 * Coalesce a map view's renders and elide the writes that change nothing.
 *
 * Every state change — hover, opacity, date, region — marks a region dirty
 * instead of re-rendering. One flush per animation frame redraws only the
 * marked regions, identical HTML is never written back to the DOM, and the
 * caret survives a slot rewrite.
 */
export function createMapRenderLoop(panels: MapPanels) {
  const slots = createMapKitHtmlSlotRenderer<HTMLElement>()

  const focus = createMapKitFocusPreserver({
    activeElement: () => document.activeElement,
    // Element identity cannot survive replacing innerHTML, so restore by a
    // stable key the render emits (here a data attribute).
    identify: (element) =>
      element instanceof HTMLElement ? (element.dataset.focusKey ?? null) : null,
    resolve: (key) => panels.readout.querySelector<HTMLElement>(`[data-focus-key="${key}"]`),
  })

  const scheduler = createMapKitRenderScheduler({
    onFlush: (regions) => {
      if (regions.has('markers')) panels.markers()
      if (regions.has('legend')) slots.write(panels.legend, renderLegendHtml())
      if (regions.has('readout')) {
        focus.preserve(() => slots.write(panels.readout, renderReadoutHtml()))
      }
    },
  })

  return {
    destroy: () => scheduler.destroy(),
    // Many marks per frame cost one flush. Marking from inside onFlush is
    // safe: it schedules a follow-up frame rather than recursing.
    mark: (region: 'legend' | 'markers' | 'readout') => scheduler.mark(region),
    // Render synchronously when a frame is too late — e.g. before a
    // measurement, or on teardown.
    flushNow: () => scheduler.flushNow(),
  }
}

declare function renderLegendHtml(): string
declare function renderReadoutHtml(): string
