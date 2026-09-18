import type {
  FakeCoordinate,
  FakeCoordinateRegion,
  FakeCoordinateSpan,
  FakeMapKitAnnotation,
  FakeMapKitAnnotationOptions,
  FakeMapKitCalloutDelegate,
  FakeMapKitConfigurationChangeStatus,
  FakeMapKitConfigurationErrorStatus,
  FakeMapKitDegenerateCameraInput,
  FakeMapKitImageAnnotation,
  FakeMapKitImageAnnotationOptions,
  FakeMapKitInitializationOptions,
  FakeMapKitInspector,
  FakeMapKitLoadOptions,
  FakeMapKitMap,
  FakeMapKitMapConstructor,
  FakeMapKitMapOptions,
  FakeMapKitMarkerAnnotation,
  FakeMapKitMarkerAnnotationOptions,
  FakeMapKitNamespace,
  FakeMapKitOperation,
  FakeMapKitOperationName,
  FakeMapKitOptions,
  FakeMapKitRuntime,
  FakeMapKitShowItemsOptions,
  FakeMapPoint,
  FakeMapRect,
  FakeMapRectData,
  FakeMapSize,
  FakePadding,
  FakePaddingData,
  FakeSize,
} from './types.js'

/**
 * The entire fake, as ONE self-contained function.
 *
 * Every import above is `import type`, so `verbatimModuleSyntax` erases all of
 * them and the compiled function references nothing outside its own body. That
 * is what lets `createFakeMapKitRuntime.toString()` be injected verbatim into a
 * browser through `page.addInitScript()` with no bundler -- see
 * `fakeMapKitInitScript()` in `./index.ts`, and the round-trip test in
 * `tests/testing/init-script.test.ts` that evaluates the generated source in an
 * isolated realm and drives the resulting namespace.
 *
 * Do not add a value import to this file, do not reference a module-scope
 * constant from inside the function, and do not hoist a helper out of it.
 */
export function createFakeMapKitRuntime(rawOptions: FakeMapKitOptions = {}): FakeMapKitRuntime {
  // ---------------------------------------------------------------- errors --

  class FakeMapKitNotImplemented extends Error {
    readonly member: string
    constructor(member: string) {
      super(`FakeMapKitNotImplemented: ${member}`)
      this.name = 'FakeMapKitNotImplemented'
      this.member = member
    }
  }

  function notImplemented(member: string): never {
    throw new FakeMapKitNotImplemented(member)
  }

  /**
   * The namespace a value was built from (K-10).
   *
   * MapKit JS 6 resolves `mapkit.load(libraries)` to a SCOPED namespace that is
   * not `window.mapkit`, and a value built from the global one fails the scoped
   * map's own checks -- measured on a live preview as
   * `Map.addAnnotations expected an annotation at index 0, but got [object
   * EventTarget]`, with `globalThis.mapkit.maps.length === 0` while a map was on
   * screen. Through 2.1.0 the fake's `load()` resolved to the very object it had
   * published as `window.mapkit`, so both namespaces were identical under test
   * and 62 green end-to-end tests shipped a map with no marks on it.
   *
   * A symbol is used so `guard()` hands the read straight through: the fidelity
   * rule fires on string members only, and a brand is not a member Apple has.
   * The fake brands rather than giving each namespace its own classes, so
   * `instanceof` still passes across namespaces where real MapKit's would not --
   * nothing in this library or its consumers branches on `instanceof`, and the
   * rejection, not its mechanism, is what a test needs to see.
   */
  const NAMESPACE_BRAND = Symbol('fakeMapKitNamespace')

  const brandNamespace = <T extends object>(value: T, namespaceId: string): T => {
    Object.defineProperty(value, NAMESPACE_BRAND, {
      configurable: true,
      enumerable: false,
      value: namespaceId,
      writable: false,
    })
    return value
  }

  /** `undefined` for a value the fake built itself, or a plain data object. */
  const namespaceOf = (value: unknown): string | undefined => {
    if (typeof value !== 'object' || value === null) return undefined
    const brand = (value as Record<symbol, unknown>)[NAMESPACE_BRAND]
    return typeof brand === 'string' ? brand : undefined
  }

  /**
   * Keys a test runner, a reactivity system or a promise resolver probes on an
   * arbitrary object. Answering `undefined` keeps the fidelity rule from firing
   * on machinery rather than on product code. Anything beginning `@@__` is a
   * probe too -- that is how Immutable.js, and therefore every pretty-printer
   * that supports it, brands its own types, and a failed `expect` that reaches
   * one would otherwise report the fidelity error instead of the assertion.
   */
  const probeKeys = new Set([
    '$$typeof',
    '__v_isReactive',
    '__v_isRef',
    '__v_raw',
    '__v_skip',
    'asymmetricMatch',
    'nodeName',
    'nodeType',
    'tagName',
    'then',
  ])

  /**
   * The fidelity rule: reading or writing a member the fake does not model
   * throws instead of silently answering `undefined`.
   */
  function guard<T extends object>(target: T, label: string): T {
    return new Proxy(target, {
      get(object, property) {
        if (typeof property === 'symbol') return Reflect.get(object, property, object)
        if (property in object) {
          const value = Reflect.get(object, property, object)
          if (typeof value !== 'function') return value
          // Constructors (own `prototype`) are handed back untouched so
          // `instanceof` and identity survive. Everything else is bound to the
          // real target: EventTarget's methods read internal slots a Proxy
          // receiver does not have.
          return Object.hasOwn(value, 'prototype')
            ? value
            : (value as (...args: never[]) => unknown).bind(object)
        }
        // A probe key answers `undefined`; a bare `return` says exactly that
        // without the literal the lint rule rightly calls redundant.
        if (probeKeys.has(property) || property.startsWith('@@__')) return
        return notImplemented(`${label}.${property}`)
      },
      set(object, property, value) {
        if (typeof property === 'symbol' || property in object) {
          return Reflect.set(object, property, value, object)
        }
        return notImplemented(`${label}.${property} (write)`)
      },
    })
  }

  // ---------------------------------------------------------------- options --

  const auth = rawOptions.auth ?? {}
  const authMode = auth.mode ?? 'accept'
  const bootstrapAttemptLimit = auth.bootstrapAttempts ?? 3
  const accessKeyTtlMs = (auth.accessKeyTtlSeconds ?? 1800) * 1000
  const onAccessKeyExpiry = auth.onAccessKeyExpiry ?? 'refresh'
  const pageOrigin = auth.origin ?? 'http://localhost:3000'
  const tokenOrigin = auth.expectedOrigin ?? 'http://localhost:4501'
  const errorStatus: FakeMapKitConfigurationErrorStatus = auth.status ?? 'Unauthorized'
  const version = rawOptions.version ?? '6.0.128'
  const build = rawOptions.build ?? '6.0.128'
  const viewportWidth = rawOptions.viewport?.width ?? 800
  const viewportHeight = rawOptions.viewport?.height ?? 600
  const availableLibraries = [...(rawOptions.libraries ?? ['map', 'annotations', 'overlays'])]

  // ------------------------------------------------------------------ state --

  const operations: FakeMapKitOperation[] = []
  const tokens: string[] = []
  const bootstrapAttempts: Array<{ attempt: number; tokenIndex: number }> = []
  const configurationChanges: FakeMapKitConfigurationChangeStatus[] = []
  const errors: Array<{ message: string; status: FakeMapKitConfigurationErrorStatus }> = []
  const annotationCounts = new Map<
    string,
    { added: number; deselected: number; removed: number; selected: number }
  >()
  /** Every live map, across every namespace; `namespace.maps` filters by its own. */
  const liveMaps: MapImpl[] = []
  const callouts = new WeakMap<object, HTMLElement>()
  /** Camera inputs the fake refuses to guess Apple's answer for (K-5). */
  const degenerateCamera: FakeMapKitDegenerateCameraInput[] = []

  let clock = 0
  let tokenCalls = 0
  let annotationsAdded = 0
  let annotationsRemoved = 0
  let annotationSequence = 0
  let mapSequence = 0
  let initialized = false
  let initCalled = false
  /**
   * K-7. `initializeMapKit` clears its singleton on every error so `retry()` can
   * run a second token exchange, but 2.1.0's fake threw on the second
   * `mapkit.init()` -- so the kit's own documented recovery path could not be
   * tested against it, and buoys pinned that as a negative assertion. A second
   * init after a FAILED exchange is allowed; one after a successful exchange
   * still throws, because what real MapKit does there was never measured.
   */
  let initFailed = false
  /**
   * MapKit's language is one runtime-wide setting, not a per-namespace one, so
   * it lives here rather than on a namespace instance: `mapkit.init({language})`
   * on the scoped namespace is visible from the global one, as it is in v6.
   */
  let language = rawOptions.language ?? 'en'
  let accessKeyExpiresAt: number | null = null
  let authorizationCallback: FakeMapKitInitializationOptions['authorizationCallback']
  let loadedLibraries: string[] | undefined

  const log = (
    name: FakeMapKitOperationName,
    annotationIds: readonly string[] = [],
    detail = '',
  ): void => {
    operations.push({ annotationIds, at: clock, detail, name })
  }

  const countsFor = (
    id: string,
  ): { added: number; deselected: number; removed: number; selected: number } => {
    let entry = annotationCounts.get(id)
    if (!entry) {
      entry = { added: 0, deselected: 0, removed: 0, selected: 0 }
      annotationCounts.set(id, entry)
    }
    return entry
  }

  /** The fake always assigns an id; Apple's type still allows null. */
  const idOf = (annotation: FakeMapKitAnnotation): string => annotation.id ?? ''

  // ---------------------------------------------------------------- the DOM --

  const documentOf = (): Document => {
    const candidate = (globalThis as { document?: Document }).document
    if (!candidate) {
      throw new Error(
        'fake MapKit needs a DOM to build map and annotation elements. Run this test under happy-dom or jsdom, or use the fake for token/auth assertions only.',
      )
    }
    return candidate
  }

  class FallbackPoint {
    x: number
    y: number
    z = 0
    w = 1
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
    toJSON(): { w: number; x: number; y: number; z: number } {
      return { w: this.w, x: this.x, y: this.y, z: this.z }
    }
    matrixTransform(): never {
      return notImplemented('DOMPoint.matrixTransform')
    }
  }

  const makePoint = (x: number, y: number): DOMPoint => {
    const ctor = (globalThis as { DOMPoint?: new (x?: number, y?: number) => DOMPoint }).DOMPoint
    return ctor ? new ctor(x, y) : (new FallbackPoint(x, y) as unknown as DOMPoint)
  }

  // ------------------------------------------------------------ value types --

  class Coordinate implements FakeCoordinate {
    latitude: number
    longitude: number
    constructor(latitude = 0, longitude = 0) {
      this.latitude = latitude
      this.longitude = longitude
    }
    copy(): FakeCoordinate {
      return new Coordinate(this.latitude, this.longitude)
    }
    equals(other: { latitude: number; longitude: number }): boolean {
      return this.latitude === other.latitude && this.longitude === other.longitude
    }
    toString(): string {
      return `<mapkit.Coordinate latitude=${this.latitude} longitude=${this.longitude}>`
    }
  }

  class CoordinateSpan implements FakeCoordinateSpan {
    latitudeDelta: number
    longitudeDelta: number
    constructor(latitudeDelta = 0, longitudeDelta = 0) {
      this.latitudeDelta = latitudeDelta
      this.longitudeDelta = longitudeDelta
    }
    copy(): FakeCoordinateSpan {
      return new CoordinateSpan(this.latitudeDelta, this.longitudeDelta)
    }
    equals(other: FakeCoordinateSpan): boolean {
      return (
        this.latitudeDelta === other.latitudeDelta && this.longitudeDelta === other.longitudeDelta
      )
    }
    toString(): string {
      return `<mapkit.CoordinateSpan latitudeDelta=${this.latitudeDelta} longitudeDelta=${this.longitudeDelta}>`
    }
  }

  class CoordinateRegion implements FakeCoordinateRegion {
    center: FakeCoordinate
    span: FakeCoordinateSpan
    constructor(
      center: { latitude: number; longitude: number } = new Coordinate(),
      span: { latitudeDelta: number; longitudeDelta: number } = new CoordinateSpan(1, 1),
    ) {
      this.center = new Coordinate(center.latitude, center.longitude)
      this.span = new CoordinateSpan(span.latitudeDelta, span.longitudeDelta)
    }
    copy(): FakeCoordinateRegion {
      return new CoordinateRegion(this.center, this.span)
    }
    equals(other: FakeCoordinateRegion): boolean {
      return this.center.equals(other.center) && this.span.equals(other.span)
    }
    toString(): string {
      return `<mapkit.CoordinateRegion center=${this.center.toString()} span=${this.span.toString()}>`
    }
  }

  class Padding implements FakePadding {
    top: number
    right: number
    bottom: number
    left: number
    constructor(padding?: FakePaddingData) {
      if (padding !== undefined && typeof padding !== 'object') {
        notImplemented('mapkit.Padding (numeric constructor overloads)')
      }
      this.top = padding?.top ?? 0
      this.right = padding?.right ?? 0
      this.bottom = padding?.bottom ?? 0
      this.left = padding?.left ?? 0
    }
    copy(): FakePadding {
      return new Padding(this)
    }
    equals(other: FakePaddingData): boolean {
      return (
        this.top === other.top &&
        this.right === other.right &&
        this.bottom === other.bottom &&
        this.left === other.left
      )
    }
  }

  // ------------------------------------------------- deterministic projection --

  const MAX_MERCATOR_LATITUDE = 85.051_128_78

  /** Web-Mercator, clamped to the projection's own latitude limit. */
  const mercator = (latitude: number): number => {
    const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude))
    return Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))
  }

  /**
   * The projection viewport, in CSS pixels.
   *
   * 2.1.0 always used the configured `viewport` (800x600 by default), which made
   * a headless run and a browser run identical but meant a phone-sized page
   * projected every pin into an 800x600 frame it did not have -- so a spec had
   * to pass its own `viewport` or watch its pins land off screen. 2.1.1 measures
   * the container the map was attached to when that container has a size, and
   * falls back to the configured viewport when it does not: happy-dom and jsdom
   * report `clientWidth === 0`, so a unit test keeps exactly 2.1.0's numbers.
   */
  const viewportOf = (host: HTMLElement | null): { height: number; width: number } => {
    const width = host?.clientWidth ?? 0
    const height = host?.clientHeight ?? 0
    return width > 0 && height > 0
      ? { height, width }
      : { height: viewportHeight, width: viewportWidth }
  }

  const project = (
    coordinate: FakeCoordinate,
    region: FakeCoordinateRegion,
    viewport: { height: number; width: number },
  ): { x: number; y: number } => {
    const west = region.center.longitude - region.span.longitudeDelta / 2
    const east = region.center.longitude + region.span.longitudeDelta / 2
    const north = mercator(region.center.latitude + region.span.latitudeDelta / 2)
    const south = mercator(region.center.latitude - region.span.latitudeDelta / 2)
    const spanX = east - west
    const spanY = north - south
    return {
      x:
        spanX === 0 ? viewport.width / 2 : ((coordinate.longitude - west) / spanX) * viewport.width,
      y:
        spanY === 0
          ? viewport.height / 2
          : ((north - mercator(coordinate.latitude)) / spanY) * viewport.height,
    }
  }

  // ------------------------------------------------------- the MapRect world --
  // MapKit's map points live in a unit square: (0,0) is the north-west corner of
  // the Web-Mercator world and (1,1) the south-east one. The conversions below
  // are that same projection, normalised -- the fake invents no second geometry.

  const worldX = (longitude: number): number => (longitude + 180) / 360

  const worldY = (latitude: number): number => {
    const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude))
    const sin = Math.sin((clamped * Math.PI) / 180)
    return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  }

  const latitudeFromWorldY = (y: number): number =>
    (Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y)) * 180) / Math.PI

  const longitudeFromWorldX = (x: number): number => {
    const longitude = x * 360 - 180
    return ((((longitude + 180) % 360) + 360) % 360) - 180
  }

  class MapSize implements FakeMapSize {
    width: number
    height: number
    constructor(width = 0, height = 0) {
      this.width = width
      this.height = height
    }
    copy(): FakeMapSize {
      return new MapSize(this.width, this.height)
    }
    equals(other: FakeMapSize): boolean {
      return this.width === other.width && this.height === other.height
    }
    toString(): string {
      return `<mapkit.MapSize width=${this.width} height=${this.height}>`
    }
  }

  class MapPoint implements FakeMapPoint {
    x: number
    y: number
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
    copy(): FakeMapPoint {
      return new MapPoint(this.x, this.y)
    }
    equals(other: FakeMapPoint): boolean {
      return this.x === other.x && this.y === other.y
    }
    toCoordinate(): FakeCoordinate {
      return new Coordinate(latitudeFromWorldY(this.y), longitudeFromWorldX(this.x))
    }
    toString(): string {
      return `<mapkit.MapPoint x=${this.x} y=${this.y}>`
    }
  }

  class MapRect implements FakeMapRect {
    origin: FakeMapPoint
    size: FakeMapSize
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.origin = new MapPoint(x, y)
      this.size = new MapSize(width, height)
    }
    copy(): FakeMapRect {
      return new MapRect(this.origin.x, this.origin.y, this.size.width, this.size.height)
    }
    equals(other: FakeMapRect): boolean {
      return (
        this.origin.x === other.origin.x &&
        this.origin.y === other.origin.y &&
        this.size.width === other.size.width &&
        this.size.height === other.size.height
      )
    }
    minX(): number {
      return this.origin.x
    }
    minY(): number {
      return this.origin.y
    }
    midX(): number {
      return this.origin.x + this.size.width / 2
    }
    midY(): number {
      return this.origin.y + this.size.height / 2
    }
    maxX(): number {
      return this.origin.x + this.size.width
    }
    maxY(): number {
      return this.origin.y + this.size.height
    }
    toCoordinateRegion(): FakeCoordinateRegion {
      const north = latitudeFromWorldY(this.origin.y)
      const south = latitudeFromWorldY(this.maxY())
      return new CoordinateRegion(
        new Coordinate((north + south) / 2, longitudeFromWorldX(this.midX())),
        new CoordinateSpan(north - south, this.size.width * 360),
      )
    }
    toString(): string {
      return `<mapkit.MapRect origin=${this.origin.toString()} size=${this.size.toString()}>`
    }
    /** Apple has it; nothing here calls it, so the fidelity rule covers it. */
    scale(): never {
      return notImplemented('mapkit.MapRect.scale')
    }
  }

  const mapRectOfRegion = (region: FakeCoordinateRegion): FakeMapRect => {
    const north = region.center.latitude + region.span.latitudeDelta / 2
    const south = region.center.latitude - region.span.latitudeDelta / 2
    const west = region.center.longitude - region.span.longitudeDelta / 2
    const top = worldY(north)
    return new MapRect(worldX(west), top, region.span.longitudeDelta / 360, worldY(south) - top)
  }

  // ------------------------------------------------------------------ enums --
  // Values verbatim from `@types/apple-mapkit` (`declare const MapType`,
  // `ColorScheme`, `FeatureVisibility`). `Map.MapTypes` and `Map.ColorSchemes`
  // are the aliases Apple still ships and deprecates in favour of the top-level
  // enums; the fake carries both because a consumer's code may read either.

  const MapTypeEnum = Object.freeze({
    Hybrid: 'hybrid',
    MutedStandard: 'mutedStandard',
    Satellite: 'satellite',
    Standard: 'standard',
  })

  const ColorSchemeEnum = Object.freeze({
    Adaptive: 'adaptive',
    Dark: 'dark',
    Light: 'light',
  })

  const FeatureVisibilityEnum = Object.freeze({
    Adaptive: 'adaptive',
    Hidden: 'hidden',
    Visible: 'visible',
  })

  // ----------------------------------------------------------- annotations --

  const unmodelledAnnotationMembers = [
    'animates',
    'appearanceAnimation',
    'clusteringIdentifier',
    'collisionMode',
    'displayPriority',
    'draggable',
    'memberAnnotations',
    'padding',
    'selectionAccessory',
    'selectionAccessoryOffset',
  ]

  class Annotation extends EventTarget implements FakeMapKitAnnotation {
    accessibilityLabel: string | null
    anchorOffset: DOMPoint
    callout: FakeMapKitCalloutDelegate | null
    calloutEnabled: boolean
    calloutOffset: DOMPoint
    coordinate: FakeCoordinate
    data: object
    element: HTMLElement
    enabled: boolean
    readonly id: string
    selected = false
    size: FakeSize | null
    subtitle: string | null
    title: string | null
    visible: boolean
    /** Set by the map. Not part of Apple's writable surface here. */
    ownerMap: FakeMapKitMap | null = null

    constructor(
      location: { latitude: number; longitude: number },
      element: HTMLElement,
      options: FakeMapKitAnnotationOptions = {},
    ) {
      super()
      annotationSequence += 1
      this.id = options.id ?? `fake-annotation-${annotationSequence}`
      this.coordinate = new Coordinate(location.latitude, location.longitude)
      this.element = options.element ?? element
      this.data = options.data ?? {}
      this.title = options.title ?? null
      this.subtitle = options.subtitle ?? null
      this.accessibilityLabel = options.accessibilityLabel ?? null
      this.anchorOffset = options.anchorOffset ?? makePoint(0, 0)
      this.calloutOffset = options.calloutOffset ?? makePoint(0, 0)
      this.callout = options.callout ?? null
      this.calloutEnabled = options.calloutEnabled ?? true
      this.enabled = options.enabled ?? true
      this.visible = options.visible ?? true
      this.size = options.size ?? null
      this.element.dataset['annotationId'] = this.id
      this.element.style.position = 'absolute'
    }

    get map(): FakeMapKitMap | null {
      return this.ownerMap
    }
  }

  for (const member of unmodelledAnnotationMembers) {
    Object.defineProperty(Annotation.prototype, member, {
      configurable: true,
      get: () => notImplemented(`mapkit.Annotation.${member}`),
      set: () => notImplemented(`mapkit.Annotation.${member} (write)`),
    })
  }

  const defaultElement = (className: string, text: string): HTMLElement => {
    const element = documentOf().createElement('div')
    element.className = className
    if (text) element.textContent = text
    return element
  }

  class MarkerAnnotation extends Annotation implements FakeMapKitMarkerAnnotation {
    color: string
    glyphColor: string
    glyphText: string | null
    constructor(
      location: { latitude: number; longitude: number },
      options: FakeMapKitMarkerAnnotationOptions = {},
    ) {
      super(location, defaultElement('fake-mapkit-marker', options.glyphText ?? ''), options)
      this.color = options.color ?? '#ff5b40'
      this.glyphColor = options.glyphColor ?? '#ffffff'
      this.glyphText = options.glyphText ?? null
    }
  }

  class ImageAnnotation extends Annotation implements FakeMapKitImageAnnotation {
    url: Record<string, string>
    constructor(
      location: { latitude: number; longitude: number },
      options: FakeMapKitImageAnnotationOptions,
    ) {
      super(location, defaultElement('fake-mapkit-image-annotation', ''), options)
      this.url = options.url ?? {}
    }
  }

  const asAnnotation = (value: FakeMapKitAnnotation): Annotation => value as Annotation

  // ------------------------------------------------------------------- map --

  const unmodelledMapMembers = [
    'addOverlay',
    'addOverlays',
    'addTileOverlay',
    'annotationForCluster',
    'annotationsInMapRect',
    'cameraBoundary',
    'cameraDistance',
    'cameraZoomRange',
    'convertCoordinateToPointOnPage',
    'convertPointOnPageToCoordinate',
    'overlays',
    'removeOverlay',
    'removeOverlays',
    'removeTileOverlay',
    'tileOverlays',
    'userLocationAnnotation',
  ]

  const fireRegionChange = (map: MapImpl): void => {
    map.dispatchEvent(new Event('region-change-start'))
    map.dispatchEvent(new Event('region-change-end'))
  }

  class AnnotationEvent extends Event {
    readonly annotation: FakeMapKitAnnotation
    constructor(type: string, annotation: FakeMapKitAnnotation) {
      super(type)
      this.annotation = annotation
    }
  }

  class MapImpl extends EventTarget implements FakeMapKitMap {
    readonly element: HTMLElement | null
    /** The container the map was attached to; the projection measures it. */
    readonly host: HTMLElement
    /** The namespace that built this map (K-10). */
    readonly namespaceId: string
    /** The guarded view of `this`; what every public reference hands back. */
    view: FakeMapKitMap
    regionValue: FakeCoordinateRegion
    selectedValue: FakeMapKitAnnotation | null = null
    readonly ownedAnnotations: FakeMapKitAnnotation[] = []
    destroyed = false
    /** Apple's constructor default is `true`; the documented `<AppMapKit>` default is `false`. */
    isRotationEnabled: boolean
    /**
     * Basemap and control state (K-4, K-5).
     *
     * `undefined` means nothing has set it and the fake does not know Apple's
     * default, so READING it throws rather than answering a guess -- the same
     * rule the rest of the fake applies to a member it does not model. Apple's
     * `.d.ts` documents a default for none of these. `<AppMapKit>` passes
     * `mapType` and `colorScheme` in the constructor, so neither is ever unset
     * for a map this library built.
     */
    mapTypeValue: string | undefined
    colorSchemeValue: string | undefined
    showsZoomControlValue: boolean | undefined
    showsScaleValue: string | undefined
    paddingValue: FakePadding | undefined

    constructor(
      namespaceId: string,
      parent?: string | HTMLElement | null,
      options: FakeMapKitMapOptions = {},
    ) {
      super()
      mapSequence += 1
      this.namespaceId = namespaceId
      const doc = documentOf()
      const host =
        typeof parent === 'string'
          ? doc.getElementById(parent)
          : (parent ?? doc.createElement('div'))
      if (!host)
        throw new Error(`fake MapKit: no element with id "${String(parent)}" to attach the map to`)
      const element = doc.createElement('div')
      element.className = 'fake-mapkit-map'
      element.dataset['mapId'] = `fake-map-${mapSequence}`
      element.style.position = 'relative'
      // A measurable container owns the size; only an unmeasured one (happy-dom,
      // jsdom) falls back to the configured viewport, which is what keeps a unit
      // test's pin positions identical to 2.1.0's.
      const measured = host.clientWidth > 0 && host.clientHeight > 0
      element.style.width = measured ? '100%' : `${viewportWidth}px`
      element.style.height = measured ? '100%' : `${viewportHeight}px`
      host.append(element)
      this.element = element
      this.host = host
      this.isRotationEnabled = options.isRotationEnabled ?? true
      if (options.mapType !== undefined) this.mapTypeValue = options.mapType
      if (options.colorScheme !== undefined) this.colorSchemeValue = options.colorScheme
      if (options.showsZoomControl !== undefined) {
        this.showsZoomControlValue = options.showsZoomControl
      }
      if (options.showsScale !== undefined) this.showsScaleValue = options.showsScale
      if (options.padding !== undefined) this.paddingValue = new Padding(options.padding)
      this.regionValue = options.region
        ? new CoordinateRegion(options.region.center, options.region.span)
        : new CoordinateRegion(options.center ?? new Coordinate(), new CoordinateSpan(1, 1))
      if (options.visibleMapRect !== undefined) this.applyVisibleMapRect(options.visibleMapRect)
      brandNamespace(this, namespaceId)
      this.view = guard<FakeMapKitMap>(this, 'mapkit.Map')
    }

    /** CSS pixels the projection uses. Measured, or the configured fallback. */
    viewport(): { height: number; width: number } {
      return viewportOf(this.host)
    }

    /** K-10: refuse a value another namespace built. */
    assertOwnNamespace(value: unknown, member: string, index?: number): void {
      const owner = namespaceOf(value)
      if (owner === undefined || owner === this.namespaceId) return
      const at = index === undefined ? '' : ` at index ${String(index)}`
      throw new TypeError(
        `Map.${member} expected a value from the namespace that created this map${at}, but got ` +
          'one from another mapkit namespace. MapKit JS 6 resolves mapkit.load(libraries) to a ' +
          "scoped namespace: build values from that namespace (<AppMapKit>'s map-ready payload " +
          'or getMapKit()), never from globalThis.mapkit.',
      )
    }

    get annotations(): FakeMapKitAnnotation[] {
      return [...this.ownedAnnotations]
    }

    set annotations(next: FakeMapKitAnnotation[]) {
      // Real MapKit replaces wholesale here. Logged under its own name so a
      // budget test can see a full rebuild that `addAnnotations` would hide.
      log('annotations=', next.map(idOf), `${this.ownedAnnotations.length} -> ${next.length}`)
      for (const [index, annotation] of next.entries()) {
        this.assertAnnotation(annotation, 'annotations', index)
      }
      this.removeAnnotations([...this.ownedAnnotations])
      this.addAnnotations(next)
    }

    get region(): FakeCoordinateRegion {
      return this.regionValue.copy()
    }

    set region(next: FakeCoordinateRegion) {
      this.assertOwnNamespace(next, 'region')
      log('region=')
      this.applyRegion(next)
      fireRegionChange(this)
    }

    /** `undefined` is an unknown Apple default, not a modelled value. See the field. */
    unset(member: string): never {
      return notImplemented(
        `mapkit.Map.${member} (never set, and Apple documents no default the fake could return)`,
      )
    }

    get mapType(): string {
      return this.mapTypeValue ?? this.unset('mapType')
    }

    set mapType(next: string) {
      log('mapType=', [], next)
      this.mapTypeValue = next
    }

    get colorScheme(): string {
      return this.colorSchemeValue ?? this.unset('colorScheme')
    }

    set colorScheme(next: string) {
      log('colorScheme=', [], next)
      this.colorSchemeValue = next
    }

    get showsZoomControl(): boolean {
      return this.showsZoomControlValue ?? this.unset('showsZoomControl')
    }

    set showsZoomControl(next: boolean) {
      this.showsZoomControlValue = next
    }

    get showsScale(): string {
      return this.showsScaleValue ?? this.unset('showsScale')
    }

    set showsScale(next: string) {
      this.showsScaleValue = next
    }

    get padding(): FakePadding {
      return (this.paddingValue ?? this.unset('padding')).copy()
    }

    set padding(next: FakePaddingData) {
      this.assertOwnNamespace(next, 'padding')
      const padding = new Padding(next)
      const { height, width } = this.viewport()
      // Padding wider or taller than the container is what took the live phone
      // map to a whole-continent zoom. Real MapKit accepted it and did SOMETHING
      // -- Apple documents neither clamping nor refusal -- so the fake refuses
      // to pretend it knows, and records it where a test can see it instead.
      if (padding.left + padding.right >= width || padding.top + padding.bottom >= height) {
        degenerateCamera.push({
          detail: `padding ${padding.left}/${padding.top}/${padding.right}/${padding.bottom} leaves no room in a ${width}x${height} container`,
          member: 'padding',
        })
        log('camera-degenerate', [], 'padding')
      }
      this.paddingValue = padding
    }

    /**
     * The rect camera (K-5).
     *
     * The rect is the unit-square Web-Mercator rect of the region the fake
     * already projects with, so a coordinate lands in the same pixel whichever
     * camera a page drives -- no second geometry is invented.
     */
    get visibleMapRect(): FakeMapRect {
      return mapRectOfRegion(this.regionValue)
    }

    set visibleMapRect(next: FakeMapRectData) {
      this.assertOwnNamespace(next, 'visibleMapRect')
      log('visibleMapRect=')
      this.applyVisibleMapRect(next)
      fireRegionChange(this)
    }

    applyVisibleMapRect(rect: FakeMapRectData): void {
      // A zero or negative extent is not a camera Apple documents an answer for.
      // It is applied as written -- the resulting region is absurd and a test can
      // assert on it -- and recorded, rather than silently normalised into
      // something plausible.
      if (rect.size.width <= 0 || rect.size.height <= 0) {
        degenerateCamera.push({
          detail: `MapRect size ${rect.size.width}x${rect.size.height} has no positive extent`,
          member: 'visibleMapRect',
        })
        log('camera-degenerate', [], 'visibleMapRect')
      }
      const north = latitudeFromWorldY(rect.origin.y)
      const south = latitudeFromWorldY(rect.origin.y + rect.size.height)
      this.applyRegion({
        center: {
          latitude: (north + south) / 2,
          longitude: longitudeFromWorldX(rect.origin.x + rect.size.width / 2),
        },
        span: { latitudeDelta: north - south, longitudeDelta: rect.size.width * 360 },
      })
    }

    setVisibleMapRectAnimated(rect: FakeMapRectData, _animated?: boolean): FakeMapKitMap {
      this.assertOwnNamespace(rect, 'setVisibleMapRectAnimated')
      log('setVisibleMapRectAnimated')
      this.applyVisibleMapRect(rect)
      fireRegionChange(this)
      return this.view
    }

    get selectedAnnotation(): FakeMapKitAnnotation | null {
      return this.selectedValue
    }

    set selectedAnnotation(next: FakeMapKitAnnotation | null) {
      log('selectedAnnotation=', next ? [idOf(next)] : [])
      this.applySelection(next)
    }

    applyRegion(next: {
      center: { latitude: number; longitude: number }
      span: { latitudeDelta: number; longitudeDelta: number }
    }): void {
      this.regionValue = new CoordinateRegion(next.center, next.span)
      for (const annotation of this.ownedAnnotations) this.place(annotation)
    }

    place(annotation: FakeMapKitAnnotation): void {
      const point = project(annotation.coordinate, this.regionValue, this.viewport())
      const element = annotation.element
      element.style.left = `${point.x + annotation.anchorOffset.x}px`
      element.style.top = `${point.y + annotation.anchorOffset.y}px`
    }

    applySelection(next: FakeMapKitAnnotation | null): void {
      const previous = this.selectedValue
      if (previous === next) return
      if (previous) {
        previous.selected = false
        this.removeCallout(previous)
        countsFor(idOf(previous)).deselected += 1
        log('deselect', [idOf(previous)])
        this.dispatchEvent(new AnnotationEvent('deselect', previous))
      }
      this.selectedValue = next
      if (next) {
        next.selected = true
        countsFor(idOf(next)).selected += 1
        log('select', [idOf(next)])
        this.dispatchEvent(new AnnotationEvent('select', next))
        this.renderCallout(next)
      }
    }

    renderCallout(annotation: FakeMapKitAnnotation): void {
      if (!annotation.calloutEnabled) return
      const delegate = annotation.callout
      if (delegate?.calloutShouldAppearForAnnotation?.(annotation) === false) return
      let element: HTMLElement
      if (delegate?.calloutElementForAnnotation) {
        element = delegate.calloutElementForAnnotation(annotation)
      } else {
        element = documentOf().createElement('div')
        element.className = 'fake-mapkit-callout'
        const content = delegate?.calloutContentForAnnotation?.(annotation)
        if (content) element.append(content)
        else element.textContent = annotation.title ?? idOf(annotation)
      }
      element.dataset['calloutFor'] = idOf(annotation)
      const size: FakeSize = annotation.size ?? { height: 0, width: 0 }
      const offset =
        delegate?.calloutAnchorOffsetForAnnotation?.(annotation, size) ?? annotation.calloutOffset
      const point = project(annotation.coordinate, this.regionValue, this.viewport())
      element.style.position = 'absolute'
      element.style.left = `${point.x + offset.x}px`
      element.style.top = `${point.y + offset.y}px`
      this.element?.append(element)
      callouts.set(annotation, element)
      log('callout-render', [idOf(annotation)])
    }

    removeCallout(annotation: FakeMapKitAnnotation): void {
      const element = callouts.get(annotation)
      if (!element) return
      element.remove()
      callouts.delete(annotation)
      log('callout-remove', [idOf(annotation)])
    }

    attach(annotation: FakeMapKitAnnotation): void {
      asAnnotation(annotation).ownerMap = this.view
      this.ownedAnnotations.push(annotation)
      this.place(annotation)
      this.element?.append(annotation.element)
      annotationsAdded += 1
      countsFor(idOf(annotation)).added += 1
    }

    detach(annotation: FakeMapKitAnnotation): void {
      const index = this.ownedAnnotations.indexOf(annotation)
      if (index >= 0) this.ownedAnnotations.splice(index, 1)
      if (this.selectedValue === annotation) this.applySelection(null)
      this.removeCallout(annotation)
      asAnnotation(annotation).ownerMap = null
      annotation.element.remove()
      annotationsRemoved += 1
      countsFor(idOf(annotation)).removed += 1
    }

    /**
     * K-10, in Apple's own words.
     *
     * The live measurement was
     * `Map.addAnnotations expected an annotation at index 0, but got [object
     * EventTarget]` -- MapKit checks the value against its OWN Annotation, and
     * an annotation from `globalThis.mapkit` is not it. The suffix carries the
     * remedy because the message is the only thing a developer sees.
     */
    assertAnnotation(value: unknown, member: string, index: number): void {
      const owner = namespaceOf(value)
      if (owner === this.namespaceId) return
      const shape = Object.prototype.toString.call(value)
      throw new TypeError(
        `Map.${member} expected an annotation at index ${String(index)}, but got ${shape}. ` +
          'MapKit JS 6 resolves mapkit.load(libraries) to a scoped namespace, and an annotation ' +
          "built from another namespace is not this map's Annotation: build it from the " +
          "namespace <AppMapKit> hands you (map-ready's second argument, or getMapKit()), " +
          'never from globalThis.mapkit.',
      )
    }

    addAnnotation(annotation: FakeMapKitAnnotation): FakeMapKitAnnotation | null {
      log('addAnnotation', [idOf(annotation)])
      this.assertAnnotation(annotation, 'addAnnotation', 0)
      if (this.ownedAnnotations.includes(annotation)) return null
      this.attach(annotation)
      return annotation
    }

    addAnnotations(annotations: FakeMapKitAnnotation[]): FakeMapKitAnnotation[] {
      log('addAnnotations', annotations.map(idOf), String(annotations.length))
      for (const [index, annotation] of annotations.entries()) {
        this.assertAnnotation(annotation, 'addAnnotations', index)
      }
      for (const annotation of annotations) {
        if (!this.ownedAnnotations.includes(annotation)) this.attach(annotation)
      }
      return annotations
    }

    removeAnnotation(annotation: FakeMapKitAnnotation): FakeMapKitAnnotation {
      log('removeAnnotation', [idOf(annotation)])
      this.detach(annotation)
      return annotation
    }

    removeAnnotations(annotations: FakeMapKitAnnotation[]): FakeMapKitAnnotation[] {
      log('removeAnnotations', annotations.map(idOf), String(annotations.length))
      for (const annotation of annotations) this.detach(annotation)
      return annotations
    }

    setRegionAnimated(region: FakeCoordinateRegion, _animated?: boolean): FakeMapKitMap {
      this.assertOwnNamespace(region, 'setRegionAnimated')
      log('setRegionAnimated')
      this.applyRegion(region)
      fireRegionChange(this)
      return this.view
    }

    setCenterAnimated(
      coordinate: { latitude: number; longitude: number },
      _animated?: boolean,
    ): FakeMapKitMap {
      log('setCenterAnimated')
      this.applyRegion({ center: coordinate, span: this.regionValue.span })
      fireRegionChange(this)
      return this.view
    }

    showItems(
      items: FakeMapKitAnnotation[],
      options: FakeMapKitShowItemsOptions = {},
    ): FakeMapKitAnnotation[] {
      log('showItems', items.map(idOf), String(items.length))
      if (items.length === 0) return items
      let minLatitude = Number.POSITIVE_INFINITY
      let maxLatitude = Number.NEGATIVE_INFINITY
      let minLongitude = Number.POSITIVE_INFINITY
      let maxLongitude = Number.NEGATIVE_INFINITY
      for (const item of items) {
        minLatitude = Math.min(minLatitude, item.coordinate.latitude)
        maxLatitude = Math.max(maxLatitude, item.coordinate.latitude)
        minLongitude = Math.min(minLongitude, item.coordinate.longitude)
        maxLongitude = Math.max(maxLongitude, item.coordinate.longitude)
      }
      const span = new CoordinateSpan(
        Math.max(maxLatitude - minLatitude, options.minimumSpan?.latitudeDelta ?? 0.01),
        Math.max(maxLongitude - minLongitude, options.minimumSpan?.longitudeDelta ?? 0.01),
      )
      const center = new Coordinate(
        (minLatitude + maxLatitude) / 2,
        (minLongitude + maxLongitude) / 2,
      )
      this.applyRegion({ center, span })
      fireRegionChange(this)
      return items
    }

    destroy(): void {
      if (this.destroyed) return
      log('Map.destroy')
      this.destroyed = true
      this.applySelection(null)
      for (const annotation of [...this.ownedAnnotations]) this.detach(annotation)
      this.element?.remove()
      const index = liveMaps.indexOf(this)
      if (index >= 0) liveMaps.splice(index, 1)
    }
  }

  for (const member of unmodelledMapMembers) {
    Object.defineProperty(MapImpl.prototype, member, {
      configurable: true,
      get: () => notImplemented(`mapkit.Map.${member}`),
      set: () => notImplemented(`mapkit.Map.${member} (write)`),
    })
  }

  // ------------------------------------------------------- auth state machine --

  class ConfigurationChangeEvent extends Event {
    readonly status: FakeMapKitConfigurationChangeStatus
    constructor(status: FakeMapKitConfigurationChangeStatus) {
      super('configuration-change')
      this.status = status
    }
  }

  class ConfigurationErrorEvent extends Event {
    readonly message: string
    readonly status: FakeMapKitConfigurationErrorStatus
    constructor(status: FakeMapKitConfigurationErrorStatus, message: string) {
      super('error')
      this.status = status
      this.message = message
    }
  }

  const failureMessage = (): string =>
    auth.message ??
    (authMode === 'wrong-origin'
      ? // The suffix is verbatim from the 2026-09-17 measurement against Apple.
        // Whatever real MapKit prefixes it with was not captured, so the fake
        // does not invent one.
        `Origin does not match - expected: ${tokenOrigin}, actual: ${pageOrigin}`
      : 'Initialization failed.')

  const failureStatus = (): FakeMapKitConfigurationErrorStatus =>
    authMode === 'wrong-origin' ? 'Unauthorized' : errorStatus

  const succeed = (): void => {
    accessKeyExpiresAt = clock + accessKeyTtlMs
    const status: FakeMapKitConfigurationChangeStatus = initialized ? 'Refreshed' : 'Initialized'
    initialized = true
    // A successful exchange closes the K-7 window again: what real MapKit does
    // on a second `init()` after a GOOD one was never measured, so the fake
    // keeps throwing there rather than guessing.
    initFailed = false
    configurationChanges.push(status)
    log('configuration-change', [], status)
    // Every namespace view, not just one: the app listens on whichever object
    // `load()` handed it, and a test may listen on `globalThis.mapkit`. Real
    // MapKit's own dispatch across its scoped namespaces was not measured, so
    // the fake keeps the behaviour that cannot make a listener silently miss.
    for (const target of namespaceTargets) {
      target.dispatchEvent(new ConfigurationChangeEvent(status))
    }
  }

  const fail = (status: FakeMapKitConfigurationErrorStatus, message: string): void => {
    accessKeyExpiresAt = null
    initFailed = true
    errors.push({ message, status })
    log('error', [], status)
    for (const target of namespaceTargets) {
      target.dispatchEvent(new ConfigurationErrorEvent(status, message))
    }
  }

  /**
   * One token exchange. `accept` bootstraps once; every failing mode re-sends
   * the SAME token `bootstrapAttemptLimit` times before giving up -- the shape
   * measured against Apple on 2026-09-17, and the reason MapKit never
   * self-heals from a bad token.
   */
  const exchange = (token: string): void => {
    const tokenIndex = tokens.push(token) - 1
    if (authMode === 'accept') {
      bootstrapAttempts.push({ attempt: 1, tokenIndex })
      log('bootstrap', [], `attempt 1 token#${tokenIndex}`)
      succeed()
      return
    }
    for (let attempt = 1; attempt <= bootstrapAttemptLimit; attempt += 1) {
      bootstrapAttempts.push({ attempt, tokenIndex })
      log('bootstrap', [], `attempt ${attempt} token#${tokenIndex}`)
    }
    fail(failureStatus(), failureMessage())
  }

  const requestToken = (): void => {
    const callback = authorizationCallback
    if (!callback) {
      fail('Unauthorized', 'No authorizationCallback was supplied to mapkit.init().')
      return
    }
    tokenCalls += 1
    log('authorizationCallback', [], String(tokenCalls))
    let settled = false
    callback.call(null, (token: string) => {
      if (settled) return
      settled = true
      exchange(token)
    })
  }

  // -------------------------------------------------------------- namespace --

  const unmodelledNamespaceMembers = [
    'BoundingRegion',
    'CameraZoomRange',
    'CircleOverlay',
    'Directions',
    'Geocoder',
    'Libraries',
    'LineGradient',
    'MapFeatureType',
    'PlaceAnnotation',
    'PlaceLookup',
    'PointsOfInterestSearch',
    'PolygonOverlay',
    'PolylineOverlay',
    'Search',
    'Style',
    'TileOverlay',
    'importGeoJSON',
  ]

  /**
   * A constructor that stamps what it builds with its own namespace (K-10).
   *
   * Built once per namespace, so identity within one namespace is stable
   * (`ns.Coordinate === ns.Coordinate`) while two namespaces hand out two
   * different constructors -- which is the part of MapKit JS 6's scoping that
   * this library's consumers can actually observe.
   */
  const scopedConstructor = <A extends unknown[], R extends object>(
    namespaceId: string,
    make: (...args: A) => R,
  ): new (...args: A) => R =>
    function ScopedConstructor(...args: A): R {
      return brandNamespace(make(...args), namespaceId)
    } as unknown as new (...args: A) => R

  type AnnotationConstructor = new (
    location: { latitude: number; longitude: number },
    factory: (location?: FakeCoordinate, options?: FakeMapKitAnnotationOptions) => HTMLElement,
    options?: FakeMapKitAnnotationOptions,
  ) => FakeMapKitAnnotation

  type MarkerAnnotationConstructor = new (
    location: { latitude: number; longitude: number },
    options?: FakeMapKitMarkerAnnotationOptions,
  ) => FakeMapKitMarkerAnnotation

  type ImageAnnotationConstructor = new (
    location: { latitude: number; longitude: number },
    options: FakeMapKitImageAnnotationOptions,
  ) => FakeMapKitImageAnnotation

  class NamespaceImpl extends EventTarget {
    /** Which namespace this is. Not an Apple member; the fake's own bookkeeping. */
    readonly namespaceId: string
    readonly version = version
    readonly build = build
    readonly MapType = MapTypeEnum
    readonly ColorScheme = ColorSchemeEnum
    readonly FeatureVisibility = FeatureVisibilityEnum
    readonly Coordinate: new (latitude?: number, longitude?: number) => FakeCoordinate
    readonly CoordinateSpan: new (
      latitudeDelta?: number,
      longitudeDelta?: number,
    ) => FakeCoordinateSpan
    readonly CoordinateRegion: new (
      center?: { latitude: number; longitude: number },
      span?: { latitudeDelta: number; longitudeDelta: number },
    ) => FakeCoordinateRegion
    readonly Padding: new (padding?: FakePaddingData) => FakePadding
    readonly MapPoint: new (x?: number, y?: number) => FakeMapPoint
    readonly MapSize: new (width?: number, height?: number) => FakeMapSize
    readonly MapRect: new (x?: number, y?: number, width?: number, height?: number) => FakeMapRect

    readonly #map: FakeMapKitMapConstructor
    readonly #annotation: AnnotationConstructor
    readonly #markerAnnotation: MarkerAnnotationConstructor
    readonly #imageAnnotation: ImageAnnotationConstructor

    constructor(namespaceId: string) {
      super()
      this.namespaceId = namespaceId
      this.Coordinate = scopedConstructor(
        namespaceId,
        (latitude?: number, longitude?: number) => new Coordinate(latitude, longitude),
      )
      this.CoordinateSpan = scopedConstructor(
        namespaceId,
        (latitudeDelta?: number, longitudeDelta?: number) =>
          new CoordinateSpan(latitudeDelta, longitudeDelta),
      )
      this.CoordinateRegion = scopedConstructor(
        namespaceId,
        (
          center?: { latitude: number; longitude: number },
          span?: { latitudeDelta: number; longitudeDelta: number },
        ) => new CoordinateRegion(center, span),
      )
      this.Padding = scopedConstructor(
        namespaceId,
        (padding?: FakePaddingData) => new Padding(padding),
      )
      this.MapPoint = scopedConstructor(namespaceId, (x?: number, y?: number) => new MapPoint(x, y))
      this.MapSize = scopedConstructor(
        namespaceId,
        (width?: number, height?: number) => new MapSize(width, height),
      )
      this.MapRect = scopedConstructor(
        namespaceId,
        (x?: number, y?: number, width?: number, height?: number) =>
          new MapRect(x, y, width, height),
      )
      // `MapImpl` brands itself, and the public value is its guarded view, so
      // the map constructor is written out rather than wrapped.
      const mapConstructor = function FakeMap(
        parent?: string | HTMLElement | null,
        options?: FakeMapKitMapOptions,
      ): FakeMapKitMap {
        log('Map')
        const instance = new MapImpl(namespaceId, parent, options)
        liveMaps.push(instance)
        return instance.view
      } as unknown as FakeMapKitMapConstructor
      // The deprecated aliases Apple still ships on the Map constructor. A
      // consumer reading `Map.MapTypes.MutedStandard` works against the fake
      // exactly as it does against v6 -- which is why buoys' own bridge for
      // them can be deleted.
      Object.defineProperties(mapConstructor, {
        ColorSchemes: { configurable: true, get: () => ColorSchemeEnum },
        MapTypes: { configurable: true, get: () => MapTypeEnum },
      })
      this.#map = mapConstructor
      this.#annotation = scopedConstructor(
        namespaceId,
        (
          location: { latitude: number; longitude: number },
          factory: (
            location?: FakeCoordinate,
            options?: FakeMapKitAnnotationOptions,
          ) => HTMLElement,
          options: FakeMapKitAnnotationOptions = {},
        ) => {
          log('Annotation')
          return new Annotation(
            location,
            factory(new Coordinate(location.latitude, location.longitude), options),
            options,
          )
        },
      )
      this.#markerAnnotation = scopedConstructor(
        namespaceId,
        (
          location: { latitude: number; longitude: number },
          options?: FakeMapKitMarkerAnnotationOptions,
        ) => {
          log('MarkerAnnotation')
          return new MarkerAnnotation(location, options)
        },
      )
      this.#imageAnnotation = scopedConstructor(
        namespaceId,
        (
          location: { latitude: number; longitude: number },
          options: FakeMapKitImageAnnotationOptions,
        ) => {
          log('ImageAnnotation')
          return new ImageAnnotation(location, options)
        },
      )
    }

    get language(): string {
      return language
    }

    set language(next: string) {
      language = next
    }

    get loadedLibraries(): string[] | undefined {
      return loadedLibraries ? [...loadedLibraries] : undefined
    }

    /**
     * The maps THIS namespace built (K-10).
     *
     * The live measurement that found the defect was
     * `globalThis.mapkit.maps.length === 0` while a kit map was on screen; a
     * fake whose `maps` ignored the namespace could not have reproduced it.
     */
    get maps(): FakeMapKitMap[] {
      return liveMaps.filter((map) => map.namespaceId === this.namespaceId).map((map) => map.view)
    }

    requireLibrary<T>(library: string, member: string, value: T): T {
      if (!(loadedLibraries ?? availableLibraries).includes(library)) {
        throw new Error(
          `[MapKit] mapkit.${member} is available after loading the following library: ${library}.`,
        )
      }
      return value
    }

    get Map(): FakeMapKitMapConstructor {
      return this.requireLibrary('map', 'Map', this.#map)
    }

    get Annotation(): AnnotationConstructor {
      return this.requireLibrary('annotations', 'Annotation', this.#annotation)
    }

    get MarkerAnnotation(): MarkerAnnotationConstructor {
      return this.requireLibrary('annotations', 'MarkerAnnotation', this.#markerAnnotation)
    }

    get ImageAnnotation(): ImageAnnotationConstructor {
      return this.requireLibrary('annotations', 'ImageAnnotation', this.#imageAnnotation)
    }

    /**
     * One token exchange, runtime-wide.
     *
     * K-7: a second `init()` is allowed after a FAILED exchange, because that is
     * exactly what `initializeMapKit`'s `retry()` does -- it clears its
     * singleton on every `error` and calls `load()` + `init()` again, and 2.1.0's
     * fake threw there, so the kit's own documented recovery path had no test.
     * A second `init()` after a SUCCESSFUL exchange still throws: what real
     * MapKit does there was never measured, and inventing an answer is how a
     * fake produces a green test for code that would fail against Apple.
     */
    init(options: FakeMapKitInitializationOptions): void {
      log('init')
      if (initCalled && !initFailed) {
        notImplemented('mapkit.init (called twice without a failed token exchange in between)')
      }
      initCalled = true
      initFailed = false
      if (options.language) language = options.language
      if (options.libraries) loadedLibraries = [...options.libraries]
      authorizationCallback = options.authorizationCallback
      requestToken()
    }

    load(libraryNames: string | string[]): Promise<FakeMapKitNamespace> {
      const requested = typeof libraryNames === 'string' ? [libraryNames] : [...libraryNames]
      log('load', [], requested.join(','))
      const missing = requested.filter((library) => !availableLibraries.includes(library))
      if (missing.length > 0) {
        return Promise.reject(new Error(`[MapKit] Unknown library: ${missing.join(', ')}`))
      }
      loadedLibraries = [...new Set([...(loadedLibraries ?? []), ...requested])]
      return Promise.resolve(scopedNamespace())
    }
  }

  for (const member of unmodelledNamespaceMembers) {
    Object.defineProperty(NamespaceImpl.prototype, member, {
      configurable: true,
      get: () => notImplemented(`mapkit.${member}`),
      set: () => notImplemented(`mapkit.${member} (write)`),
    })
  }

  const namespaceTargets: NamespaceImpl[] = []

  const createNamespace = (namespaceId: string): FakeMapKitNamespace => {
    const target = new NamespaceImpl(namespaceId)
    namespaceTargets.push(target)
    return guard<FakeMapKitNamespace>(target as unknown as FakeMapKitNamespace, 'mapkit')
  }

  /** What `install()` publishes as `globalThis.mapkit`. */
  const namespace = createNamespace('global')

  /**
   * The namespace `load()` resolves to (K-10).
   *
   * Built on first use and then reused, so the object a consumer holds from
   * `map-ready` stays the object its next `load()` resolves to. Whether real
   * MapKit hands out one scoped namespace per `load()` call or per page was not
   * measured; what WAS measured is that it is never `window.mapkit`, and that is
   * what this models.
   */
  let scoped: FakeMapKitNamespace | undefined
  const scopedNamespace = (): FakeMapKitNamespace => (scoped ??= createNamespace('scoped'))

  // ------------------------------------------------------ loader-shaped load --

  const load = (options: FakeMapKitLoadOptions = {}): Promise<FakeMapKitNamespace> => {
    log('load', [], (options.libraries ?? []).join(','))
    if (options.version && !options.version.startsWith('6')) {
      return Promise.reject(new Error(`Unsupported MapKit JS version: ${options.version}`))
    }
    const requested = options.libraries ?? availableLibraries
    const missing = requested.filter((library) => !availableLibraries.includes(library))
    if (missing.length > 0) {
      return Promise.reject(new Error(`[MapKit] Unknown library: ${missing.join(', ')}`))
    }
    loadedLibraries = [...requested]
    if (options.language) language = options.language
    if (options.token !== undefined) {
      // `load({ token })` is MapKit's static, non-refreshable path: the token
      // goes on the script tag and there is never an authorizationCallback.
      exchange(options.token)
    }
    // Apple's loader returns `mapkit.load(libraries)` when libraries are asked
    // for, and v6 resolves that to a scoped namespace -- so this is the object
    // `<AppMapKit>` builds its map from, and it is NOT `globalThis.mapkit`.
    return Promise.resolve(scopedNamespace())
  }

  // ------------------------------------------------------------- inspection --

  const inspect: FakeMapKitInspector = {
    get annotationsAdded() {
      return annotationsAdded
    },
    get annotationsRemoved() {
      return annotationsRemoved
    },
    get bootstrapAttempts() {
      return [...bootstrapAttempts]
    },
    get configurationChanges() {
      return [...configurationChanges]
    },
    get errors() {
      return [...errors]
    },
    get maps() {
      return liveMaps.map((map) => map.view)
    },
    get degenerateCameraInputs() {
      return [...degenerateCamera]
    },
    get now() {
      return clock
    },
    get operations() {
      return [...operations]
    },
    get tokenCalls() {
      return tokenCalls
    },
    get tokens() {
      return [...tokens]
    },

    advanceClock(milliseconds: number): void {
      if (milliseconds < 0) throw new Error('fake MapKit clock only moves forward')
      clock += milliseconds
      if (accessKeyExpiresAt === null || clock < accessKeyExpiresAt) return
      accessKeyExpiresAt = null
      if (onAccessKeyExpiry === 'nothing') return
      if (onAccessKeyExpiry === 'error') {
        fail(errorStatus, auth.message ?? 'The access key expired.')
        return
      }
      requestToken()
    },

    annotationCounts(annotation: FakeMapKitAnnotation | string) {
      const id = typeof annotation === 'string' ? annotation : (annotation.id ?? '')
      const entry = annotationCounts.get(id)
      return entry ? { ...entry } : { added: 0, deselected: 0, removed: 0, selected: 0 }
    },

    calloutElement(annotation: FakeMapKitAnnotation): HTMLElement | null {
      return callouts.get(annotation) ?? null
    },

    count(name: FakeMapKitOperationName): number {
      return operations.filter((operation) => operation.name === name).length
    },

    deselectAnnotation(map: FakeMapKitMap): void {
      ;(map as unknown as MapImpl).applySelection(null)
    },

    reset(): void {
      operations.length = 0
      tokens.length = 0
      bootstrapAttempts.length = 0
      configurationChanges.length = 0
      errors.length = 0
      annotationCounts.clear()
      degenerateCamera.length = 0
      tokenCalls = 0
      annotationsAdded = 0
      annotationsRemoved = 0
    },

    selectAnnotation(map: FakeMapKitMap, annotation: FakeMapKitAnnotation): void {
      ;(map as unknown as MapImpl).applySelection(annotation)
    },
  }

  return { inspect, load, mapkit: namespace }
}
