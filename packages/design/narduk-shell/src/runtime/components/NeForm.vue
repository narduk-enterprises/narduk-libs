<script setup lang="ts">
/**
 * NeForm — wraps Nuxt UI's `UForm` with a save bar that does not lie: exactly
 * one submit per click, a loading button that needs no caller-wired ref, and
 * dirty state that only clears once the save actually succeeds.
 *
 * Components-library backlog item 19 (narduk-libs#266); plan
 * docs/plans/components-library-plan.md §2 item 19. Removes the bug class
 * named there — stonx#37, #36, #350 — by construction rather than by
 * caller discipline:
 *
 * - **Double-submit (#37).** `UForm.vue`'s own `onSubmitWrapper` has no
 *   reentrancy guard: `loading.value = true` runs synchronously, but nothing
 *   stops a SECOND native `submit` event, dispatched before the browser has
 *   re-rendered the button `disabled`, from running `onSubmitWrapper` a
 *   second time — proven by hand against `@nuxt/ui` 4.6.0 on 2026-09-11,
 *   two synchronous `form.trigger('submit')` calls with no guard produced two
 *   calls to the submit handler. Guarding inside the `onSubmit` prop itself is
 *   not enough either: by the time a second call reaches that guard, UForm has
 *   already re-validated and, worse, its `finally` block clears `dirtyFields`
 *   for the guarded no-op call — which can land WHILE the real (first) submit
 *   is still in flight, flipping the save bar to "saved" before the network
 *   call it is reporting on has even resolved. So the guard sits one layer
 *   further out: a `submit` listener registered in the CAPTURE phase on an
 *   element that is a real DOM ANCESTOR of UForm's `<form>` root. Per the DOM
 *   event spec, a capture-phase listener on an ancestor always runs before any
 *   listener on the target itself, regardless of registration order — unlike
 *   two listeners on the same node, where capture-vs-bubble does not decide
 *   ordering. While `formRef`'s own exposed `loading` is true, that listener
 *   calls `preventDefault()` **and** `stopPropagation()`, so the second event
 *   never reaches UForm's internal handler at all: no second validate, no
 *   second `dirtyFields.clear()`, no premature "saved".
 * - **A save bar that lies about dirtiness (#36).** `dirty` here is UForm's
 *   own exposed `dirty` (`!!dirtyFields.size`), read through a template ref.
 *   UForm clears `dirtyFields` only after the `onSubmit` prop's promise
 *   *resolves*; if it throws, the clear is skipped and dirty stays exactly
 *   where it was. Nothing here sets it optimistically, so there is no
 *   "saved" flash to walk back on failure.
 * - **Errors that do not scroll into view (#350).** `@error` carries the
 *   validated `FormErrorWithId[]`; the first entry with an `id` (UFormField's
 *   generated field id, the same one that lands on the real input) is focused
 *   and scrolled into view.
 *
 * `UButton`'s own `loadingAuto` prop is what makes the save button spin and
 * disable "for free": Nuxt UI's `Form.vue` provides a `formLoadingInjectionKey`
 * while `loadingAuto` is on (the default) and `type="submit"`, and
 * `Button.vue` reads exactly that injection when its own `loadingAuto` is
 * set. No ref is wired between this component and its button — that
 * plumbing is Nuxt UI's, not ours.
 *
 * `schema` and `validate` are forwarded to `UForm` untouched (`unknown`
 * here on purpose): this package does not depend on a schema library, so a
 * consumer's zod/valibot schema, or a plain validate function, both pass
 * straight through the way `UForm` itself accepts them.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import UForm from '@nuxt/ui/components/Form.vue'
import { computed, useTemplateRef } from 'vue'

/** The slice of `UForm`'s exposed API this component reads. Loosely typed on
 * purpose: `UForm`'s real type is generic over the schema, and this file
 * never needs more than these two booleans off it. */
interface NeFormExposed {
  dirty?: boolean
  loading?: boolean
}

/** The shape `UForm` hands `@error` listeners (`FormErrorEvent` in `@nuxt/ui`). */
interface NeFormErrorEvent {
  errors?: Array<{ id?: string; message: string; name?: string }>
}

export interface NeFormProps {
  /** Disables every field and the save button, in addition to `loading`. */
  disabled?: boolean
  /**
   * Called with the validated data once the schema (or `validate`) passes.
   * A real prop — not a `defineEmits` listener — so its return value can be
   * awaited directly, the same way `UForm` itself awaits its own `onSubmit`
   * and `UButton` awaits its own `onClick`. While it is pending the save
   * button shows its loading state and is disabled, and a second submit
   * (click, Enter, or another `requestSubmit()`) is dropped before it reaches
   * `UForm` at all.
   */
  onSubmit?: (data: Record<string, unknown>) => unknown | Promise<unknown>
  /** Label for the save button. */
  saveLabel?: string
  /**
   * A Standard Schema object (zod, valibot, …) or `UForm`'s own accepted
   * schema shapes. Forwarded untouched; this package never validates itself.
   */
  schema?: unknown
  /** The form's reactive state. Required — there is no uncontrolled mode. */
  state: Record<string, unknown>
  /**
   * Renders the save bar as `position: sticky` at the bottom of its nearest
   * scrolling ancestor, so the save action stays reachable on a long form.
   * `NeSettingsPage` turns this on; a standalone `NeForm` defaults it off.
   */
  stickySave?: boolean
  /**
   * Custom validation, forwarded to `UForm`'s own `validate` prop. An
   * alternative to `schema` for a form with no schema library in play.
   */
  validate?: (state: Record<string, unknown>) => unknown
}

const props = withDefaults(defineProps<NeFormProps>(), {
  disabled: false,
  saveLabel: 'Save',
  schema: undefined,
  stickySave: false,
  validate: undefined,
})

defineSlots<{
  /** Extra buttons in the save bar, rendered before the save button. */
  actions?(): unknown
  /** The form's fields — typically one or more `NeFormSection`s. */
  default?(): unknown
}>()

const formRef = useTemplateRef<NeFormExposed | null>('formRef')

/**
 * UForm's own `dirty` (`!!dirtyFields.size`), read through the template ref.
 * `defineExpose` on the child unwraps refs for the parent (Vue's
 * `getExposeProxy` runs the exposed object through `proxyRefs`), so this
 * stays reactive with no extra plumbing.
 */
const dirty = computed(() => Boolean(formRef.value?.dirty))

/**
 * The capture-phase guard described above. Bound on the wrapping `<div>`,
 * a real DOM ancestor of UForm's `<form>` root, so it always runs before
 * UForm's own submit handling — see the file header for why a guard inside
 * `onFormSubmit` is not enough on its own.
 */
function onFormSubmitCapture(event: Event) {
  if (formRef.value?.loading) {
    event.preventDefault()
    event.stopPropagation()
  }
}

/**
 * `UForm`'s real submit contract: its template is `@submit.prevent="onSubmitWrapper"`,
 * and `onSubmitWrapper` calls THIS as `props.onSubmit(event)` directly — a
 * real function PROP, not a Vue emit (`defineEmits(['submit', 'error'])` is
 * declared but `emits('submit', …)` is never called anywhere in `Form.vue`;
 * only `'error'` is). So this is wired below as `:on-submit`, not `@submit`.
 * `event` is the real native `submit` `Event` (from `.prevent`'s
 * `withModifiers` wrapper), mutated in place with `.data` once validation
 * resolves — never a fresh emitted object. A test double for `UForm` must
 * mutate a real `Event` the same way: a stub that emits a fresh `{ data }`
 * object has no `.preventDefault` and throws the moment anything wraps the
 * listener with `.prevent`.
 */
async function onFormSubmit(event: Event & { data?: unknown }) {
  await props.onSubmit?.((event.data ?? {}) as Record<string, unknown>)
}

/**
 * Focuses and scrolls to the first invalid field. `error.id` is the same id
 * `UFormField` put on the real input (`FormField.vue`'s `formInputs.value[name]
 * = { id, pattern }`, read back through `resolveErrorIds`), so this reaches
 * the actual control, not a wrapper.
 *
 * Deferred a macrotask (`setTimeout`, not `nextTick`): `@error` fires from
 * inside `onSubmitWrapper`'s `catch` block, which runs BEFORE its own
 * `finally { loading.value = false }` — at that exact instant the field is
 * still disabled (`disabled = props.disabled || loading.value`), and
 * `UForm`'s several internal `await`s (even over a synchronous `validate`)
 * already gave Vue's microtask-queued reactivity scheduler enough turns to
 * have patched that disabled state into the real DOM. A disabled element
 * silently refuses `.focus()` — proven empirically: an un-deferred call here
 * left `document.activeElement` on `<body>`. A microtask-based `nextTick()`
 * makes the same bet on ordering; a macrotask runs strictly after every
 * microtask still in flight, including the `finally` and the re-render it
 * queues, so the field is guaranteed re-enabled by the time this runs.
 */
function onFormError(event: NeFormErrorEvent) {
  const target = event.errors?.find((error) => Boolean(error.id))
  if (!target?.id || typeof document === 'undefined') return
  setTimeout(() => {
    const element = document.getElementById(target.id as string)
    if (!element) return
    element.focus()
    element.scrollIntoView({ block: 'center' })
  }, 0)
}
</script>

<template>
  <div class="ne-form" @submit.capture="onFormSubmitCapture">
    <UForm
      ref="formRef"
      class="ne-form__form space-y-6"
      :disabled="disabled"
      :schema="schema"
      :state="state"
      :validate="validate as never"
      :on-submit="onFormSubmit"
      @error="onFormError"
    >
      <slot />

      <div
        class="ne-form__save-bar flex flex-wrap items-center justify-end gap-3 border-t border-default pt-4"
        :class="stickySave ? 'sticky bottom-0 z-10 bg-default/95 py-4 backdrop-blur' : ''"
      >
        <p v-if="dirty" role="status" class="ne-form__dirty-note mr-auto text-sm text-muted">
          Unsaved changes
        </p>
        <slot name="actions" />
        <UButton type="submit" loading-auto :disabled="disabled" :label="saveLabel" />
      </div>
    </UForm>
  </div>
</template>
