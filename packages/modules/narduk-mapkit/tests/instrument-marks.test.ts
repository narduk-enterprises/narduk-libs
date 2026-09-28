import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinMark, createSelectedMark, crestRadii } from '../src/instrument-marks/index.js'

import type { PinPaint } from '../src/instrument-marks/index.js'

describe('instrument geometry', () => {
  it('rejects spacing and bounds that could make crest generation unbounded', () => {
    for (const spacing of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => crestRadii(20, spacing, 4)).toThrow(RangeError)
    }
    expect(() => crestRadii(Number.POSITIVE_INFINITY, 4, 4)).toThrow(RangeError)
    expect(() => crestRadii(20, 4, Number.NEGATIVE_INFINITY)).toThrow(RangeError)
    expect(crestRadii(20, 4, 5)).toEqual([20, 16, 12, 8])
  })
})

/** The slice of the DOM the mark builders touch, enough to walk the tree. */
class Node {
  attrs = new Map<string, string>()
  children: Node[] = []
  className = ''
  dataset: Record<string, string> = {}
  style: Record<string, string> & { setProperty: (name: string, value: string) => void }
  textContent = ''
  title = ''

  constructor(readonly tag: string) {
    const style: Record<string, string> = {}
    this.style = Object.assign(style, {
      setProperty: (name: string, value: string) => {
        style[name] = value
      },
    })
  }

  addEventListener(): void {}
  appendChild(node: Node): Node {
    this.children.push(node)
    return node
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
}

function classNames(node: Node): string[] {
  return [node.className, ...node.children.flatMap(classNames)]
}

/** Every node in the tree, including the SVG ones, which carry `class` as an attribute. */
function walk(node: Node): Node[] {
  return [node, ...node.children.flatMap(walk)]
}

function svgClasses(node: Node): string[] {
  return walk(node)
    .map((child) => child.attrs.get('class'))
    .filter((name): name is string => name !== undefined)
}

function find(node: Node, className: string): Node | undefined {
  return walk(node).find(
    (child) => child.className === className || child.attrs.get('class') === className,
  )
}

/** A windsock at the regional tier: an instrument over a fixed ink dot. */
const SOCK: PinPaint = {
  bearing: 270,
  body: 'M3.5 3L20 1.2A1.2 1.2 0 0 0 20 -1.2L3.5 -3Z',
  bodyDash: 'none',
  bodyFill: '#5c80bf',
  bodyStroke: 'none',
  bodyWidth: 0,
  calm: '',
  calmStroke: '#98b2de',
  dotDash: 'none',
  dotFill: '#0e1418',
  dotRadius: 4,
  dotStroke: '#ffffff',
  dotWidth: 1.5,
  extent: 26,
  fill: '#5c80bf',
  fontSize: 11,
  footprint: 6,
  ghost: '',
  halo: 'M3.5 3L20 1.2A1.2 1.2 0 0 0 20 -1.2L3.5 -3Z',
  haloWidth: 3,
  ink: '#0e1418',
  selRadius: 0,
  text: '',
  track: '',
}

/** A water gauge: a tracked arc round a badge that carries the numeral. */
const GAUGE: PinPaint = {
  ...SOCK,
  bearing: null,
  body: 'M0 -13A13 13 0 0 1 13 0',
  bodyFill: 'none',
  bodyStroke: '#3aa655',
  bodyWidth: 3,
  dotFill: '#8dc79f',
  dotRadius: 9.5,
  extent: 16.5,
  fontSize: 11,
  selRadius: 16,
  text: '72',
  track: 'M0 -13A13 13 0 1 1 0 13A13 13 0 1 1 0 -13',
}

const TARGET = {
  ariaLabel: 'Galveston, 14 kt, Live',
  data: { stationId: '42035' },
  hitSize: 44,
  onSelect: () => {},
}

describe('mark DOM', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new Node(tag),
      createElementNS: (_ns: string, tag: string) => new Node(tag),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function pin(overrides: Partial<Parameters<typeof createPinMark>[0]> = {}): Node {
    return createPinMark({
      ...TARGET,
      paint: SOCK,
      selected: false,
      stack: null,
      ...overrides,
    }) as unknown as Node
  }

  it('paints the layers the drawing actually has, and skips the ones it does not', () => {
    const classes = svgClasses(pin())
    expect(classes).toContain('mk-pin-svg')
    expect(classes).toContain('mk-pin-halo')
    expect(classes).toContain('mk-pin-body')
    expect(classes).toContain('mk-pin-dot')
    // Nothing empty is drawn as a no-op node.
    expect(classes).not.toContain('mk-pin-ghost')
    expect(classes).not.toContain('mk-pin-track')
    expect(classes).not.toContain('mk-pin-calm')
    expect(classes).not.toContain('mk-pin-num')
    expect(classes).not.toContain('mk-pin-stack')
    expect(classes).not.toContain('mk-pin-sel')
  })

  it('sizes the canvas to the whole drawing, not to the dot', () => {
    const svg = find(pin(), 'mk-pin-svg')
    expect(svg?.attrs.get('viewBox')).toBe('-27 -27 54 54')
    expect(svg?.attrs.get('width')).toBe('54')
  })

  it('paints a gauge as a tracked arc round a badge carrying its numeral', () => {
    const root = pin({ paint: GAUGE })
    const classes = svgClasses(root)
    expect(classes).toContain('mk-pin-track')
    expect(classes).toContain('mk-pin-num')
    const numeral = find(root, 'mk-pin-num')
    expect(numeral?.textContent).toBe('72')
    expect(numeral?.attrs.get('fill')).toBe('#0e1418')
    expect(find(root, 'mk-pin-dot')?.attrs.get('r')).toBe('9.5')
  })

  it('draws a crowd as one stack dot behind the mark, in the stack colour', () => {
    const root = pin({ stack: { color: '#27416f', offset: 4 } })
    const stack = find(root, 'mk-pin-stack')
    expect(stack).toMatchObject({ tag: 'circle' })
    expect(stack?.attrs.get('cx')).toBe('4')
    expect(stack?.attrs.get('cy')).toBe('-4')
    expect(stack?.attrs.get('fill')).toBe('#27416f')
    expect(stack?.attrs.get('r')).toBe('4')
  })

  it('rings a selected mark in white under ink, at the paint’s own radius', () => {
    const root = pin({ paint: GAUGE, selected: true })
    expect(find(root, 'mk-pin-sel-halo')?.attrs.get('r')).toBe('16')
    expect(find(root, 'mk-pin-sel')?.attrs.get('r')).toBe('16')
    // The canvas grows to hold the ring.
    expect(find(root, 'mk-pin-svg')?.attrs.get('viewBox')).toBe('-21 -21 42 42')
  })

  it('opens the value tab on the side the instrument leaves clear', () => {
    // A sock trailing toward 270deg (west) leaves the east side clear.
    const west = find(pin({ tab: '14' }), 'mk-tab')
    expect(west?.style.left).toBe('9px')
    expect(west?.style.right).toBe('auto')
    const east = find(pin({ paint: { ...SOCK, bearing: 90 }, tab: '14' }), 'mk-tab')
    expect(east?.style.right).toBe('9px')
    expect(east?.style.left).toBe('auto')
  })

  it('hangs a close-tier name off the dot, not off the tip of the instrument', () => {
    const root = pin({ name: 'Galveston' })
    expect(classNames(root)).toContain('mk-pin-name')
    expect(find(root, 'mk-pin-name')?.style.top).toBe('8px')
  })

  it('names the selected station once, in the callout pill, never also under the dot', () => {
    const root = createSelectedMark({
      ...TARGET,
      flip: false,
      name: 'Galveston · 14 kt',
      paint: SOCK,
    }) as unknown as Node
    const classes = classNames(root)
    expect(classes.filter((name) => name.startsWith('mk-name'))).toHaveLength(1)
    expect(classes).not.toContain('mk-pin-name')
    // The pill opens clear of the selection ring: max(ring, footprint) + leader.
    expect(find(root, 'mk-name')?.style.left).toBe('19px')
  })
})
