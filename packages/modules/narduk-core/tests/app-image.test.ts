// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

import AppImage from '../runtime/app/components/shared/AppImage.vue'

import { nuxtUiStubs } from './fixtures/nuxt-ui-stubs'

const IMAGE_TEST_ID = '[data-testid="app-image-img"]'

function render(props: Record<string, unknown> = {}) {
  return mount(AppImage, {
    props: { alt: 'Buoy cam', src: '/cam.jpg', ...props },
    global: { components: nuxtUiStubs },
  })
}

describe('AppImage', () => {
  it('goes from loading to loaded on the image load event', async () => {
    const wrapper = render()

    expect(wrapper.find('[data-testid="app-image-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="app-image-failed"]').exists()).toBe(false)
    expect(wrapper.get(IMAGE_TEST_ID).classes()).toContain('sr-only')

    await wrapper.get(IMAGE_TEST_ID).trigger('load')

    expect(wrapper.find('[data-testid="app-image-skeleton"]').exists()).toBe(false)
    expect(wrapper.get(IMAGE_TEST_ID).classes()).not.toContain('sr-only')
    expect(wrapper.emitted('load')).toHaveLength(1)
    wrapper.unmount()
  })

  it('goes from loading to failed on the image error event', async () => {
    const wrapper = render({ failedText: 'Cam offline' })

    expect(wrapper.find('[data-testid="app-image-skeleton"]').exists()).toBe(true)

    await wrapper.get(IMAGE_TEST_ID).trigger('error')

    const failed = wrapper.get('[data-testid="app-image-failed"]')
    expect(wrapper.find('[data-testid="app-image-skeleton"]').exists()).toBe(false)
    expect(failed.text()).toBe('Cam offline')
    expect(failed.attributes('style')).toContain('repeating-linear-gradient')
    expect(wrapper.emitted('error')).toHaveLength(1)
    wrapper.unmount()
  })

  it('defaults the failed copy to "Image unavailable"', async () => {
    const wrapper = render()
    await wrapper.get(IMAGE_TEST_ID).trigger('error')
    expect(wrapper.get('[data-testid="app-image-failed"]').text()).toBe('Image unavailable')
    wrapper.unmount()
  })

  it('renders on the server without reading window', async () => {
    const app = createSSRApp(AppImage, { alt: 'Buoy cam', src: '/cam.jpg' })
    app.component('USkeleton', nuxtUiStubs.USkeleton)
    const html = await renderToString(app)
    expect(html).toContain('app-image')
    expect(html).toContain('/cam.jpg')
  })
})
