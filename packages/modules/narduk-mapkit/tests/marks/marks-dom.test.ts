import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinMark, createSelectedMark } from '../../src/marks/marks.js'

import type { PinPaint } from '../../src/marks/marks.js'

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

const PAINT: PinPaint = {
  fill: '#5c80bf',
  fontSize: 11,
  glyph: null,
  ink: '#fff',
  radius: 11,
  ring: '0',
  text: '14',
}

describe('selected mark DOM', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: (tag: string) => new Node(tag) })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('names the selected station once, in the callout pill, never also under the disc', () => {
    const root = createSelectedMark({
      ariaLabel: 'Galveston',
      data: { stationId: '42035' },
      flip: false,
      hitSize: 44,
      name: 'Galveston',
      onSelect: () => {},
      paint: PAINT,
    }) as unknown as Node
    const classes = classNames(root)
    expect(classes.filter((name) => name.startsWith('mk-name'))).toHaveLength(1)
    expect(classes).not.toContain('mk-pin-name')
  })

  it('still hangs a close-tier name under an ordinary pin', () => {
    const root = createPinMark({
      ariaLabel: 'Galveston',
      data: { stationId: '42035' },
      hitSize: 44,
      name: 'Galveston',
      onSelect: () => {},
      paint: PAINT,
      selected: false,
      stack: null,
    }) as unknown as Node
    expect(classNames(root)).toContain('mk-pin-name')
  })
})
