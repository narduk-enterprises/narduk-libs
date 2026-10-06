import { captureValidated } from '../lib/analyticsValidation'

import type { AnalyticsEventProperties } from '../lib/analyticsCatalog'
import type { StandardAnalyticsEvent, standardAnalyticsEvents } from './analyticsEvents'
import type { AnalyticsTransport } from './analyticsTransport'
import type { App, ObjectDirective } from 'vue'

/** Only click semantics: an annotation cannot claim that a form or download succeeded. */
type ClickEvent = Extract<StandardAnalyticsEvent, 'share_clicked' | 'outbound_link_clicked'>
export type AnalyticsTrackBinding = {
  [K in ClickEvent]: {
    event: K
    properties: AnalyticsEventProperties<typeof standardAnalyticsEvents, K>
  }
}[ClickEvent]

export function installAnalyticsDirective(app: App, transport: AnalyticsTransport) {
  const listeners = new WeakMap<HTMLElement, EventListener>()
  const directive: ObjectDirective<HTMLElement, AnalyticsTrackBinding> = {
    mounted(element, binding) {
      const handler = () => {
        const value = binding.value
        if (!value || !['share_clicked', 'outbound_link_clicked'].includes(value.event)) return
        captureValidated(transport, value.event, value.properties)
      }
      listeners.set(element, handler)
      element.addEventListener('click', handler)
    },
    updated(element, binding) {
      const old = listeners.get(element)
      if (old) element.removeEventListener('click', old)
      directive.mounted?.(element, binding, null as never, null as never)
    },
    unmounted(element) {
      const listener = listeners.get(element)
      if (listener) element.removeEventListener('click', listener)
      listeners.delete(element)
    },
  }
  app.directive('track', directive)
}
