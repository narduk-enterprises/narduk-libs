// @vitest-environment happy-dom
/*
 * NeSkipLink, mounted (narduk-libs#977): activating the link moves keyboard
 * focus to the target, not just the scroll position.
 *
 * The regression this guards is the router-driven skip link apps hand-rolled:
 * `ULink to="#main-content"` calls preventDefault and `router.push`, so the
 * page scrolled but focus stayed on the link, and the next Tab went to the
 * rail instead of into the page. Enter on an anchor dispatches `click`, so a
 * click here is the same path a keyboard activation takes; the browser half
 * (Tab, Enter, Tab) is in libs-explorer's Playwright suite.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import NeSkipLink from '../src/runtime/components/NeSkipLink.vue'
import { NE_MAIN_ID } from '../src/index'

import type { NeSkipLinkProps } from '../src/runtime/components/ne-skip-link-types'

afterEach(() => {
  document.body.innerHTML = ''
})

function page(targetHtml: string) {
  document.body.innerHTML = `<div id="host"></div>${targetHtml}`
}

function mountLink(props: NeSkipLinkProps = {}) {
  return mount(NeSkipLink, { props, attachTo: '#host' })
}

/** A cancelable click, returned so a test can read `defaultPrevented`. */
function click(wrapper: ReturnType<typeof mountLink>): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  wrapper.element.dispatchEvent(event)
  return event
}

describe('NeSkipLink', () => {
  it('moves focus to the target and makes a non-focusable target focusable with tabindex=-1', () => {
    page(`<main id="${NE_MAIN_ID}"><p>page</p></main>`)
    const wrapper = mountLink()
    const main = document.getElementById(NE_MAIN_ID)!
    expect(main.hasAttribute('tabindex')).toBe(false)

    ;(wrapper.element as HTMLAnchorElement).focus()
    click(wrapper)

    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(main)
  })

  it('keeps a tabindex the target already has', () => {
    page('<section id="results" tabindex="0">results</section>')
    const wrapper = mountLink({ target: 'results' })
    const section = document.getElementById('results')!

    click(wrapper)

    expect(section.getAttribute('tabindex')).toBe('0')
    expect(document.activeElement).toBe(section)
  })

  it('leaves native fragment navigation alone: the click is never prevented', () => {
    page(`<main id="${NE_MAIN_ID}"></main>`)
    const wrapper = mountLink()

    expect(click(wrapper).defaultPrevented).toBe(false)
  })

  it('does nothing, and does not throw, when the target is missing', () => {
    page('<main id="elsewhere"></main>')
    const wrapper = mountLink()
    const link = wrapper.element as HTMLAnchorElement
    link.focus()

    expect(() => click(wrapper)).not.toThrow()
    expect(document.activeElement).toBe(link)
  })

  it('leaves a modified click (open in a new tab) to the browser', () => {
    page(`<main id="${NE_MAIN_ID}"></main>`)
    const wrapper = mountLink()
    const main = document.getElementById(NE_MAIN_ID)!

    wrapper.element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    )

    expect(main.hasAttribute('tabindex')).toBe(false)
    expect(document.activeElement).not.toBe(main)
  })
})
