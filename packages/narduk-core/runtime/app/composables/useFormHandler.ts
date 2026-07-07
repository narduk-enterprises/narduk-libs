/* eslint-disable narduk/file-size-budget -- Form handler composable is a single reusable submission primitive (state + submit + validation + error normalization) co-located for a stable imperative API. */
/**
 * useFormHandler — Imperative API submission composable for cases where
 * `<UForm :schema :state>` is not suitable (e.g., multi-step flows, modal
 * forms, or programmatic submissions without a visible form element).
 *
 * When building a standard `<UForm>` page, prefer letting UForm handle
 * validation and error display natively — this composable is not needed there.
 *
 * Integrates Zod validation, CSRF-safe API submission, toast notifications,
 * and loading/error state tracking into a single composable.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { z } from 'zod'
 *
 * const schema = z.object({
 *   name: z.string().min(1, 'Name is required'),
 *   email: z.string().email('Invalid email'),
 *   message: z.string().min(10, 'Message must be at least 10 characters'),
 * })
 *
 * const { state, errors, loading, submit, reset } = useFormHandler({
 *   schema,
 *   defaults: { name: '', email: '', message: '' },
 *   endpoint: '/api/contact',
 *   successMessage: 'Message sent successfully!',
 *   onSuccess: () => navigateTo('/thank-you'),
 * })
 * </script>
 *
 * <template>
 *   <form @submit.prevent="submit">
 *     <UFormField label="Name" :error="errors.name">
 *       <UInput v-model="state.name" />
 *     </UFormField>
 *     <UButton type="submit" :loading="loading">Send</UButton>
 *   </form>
 * </template>
 * ```
 */

import type { ZodObject, ZodRawShape } from 'zod'

function readFetchErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback
  const e = err as { data?: { message?: string }; message?: string }
  return e.data?.message ?? e.message ?? fallback
}

interface FormHandlerOptions<T extends Record<string, unknown>> {
  /** Default form values */
  defaults: T
  /** API endpoint to submit to */
  endpoint?: string
  /** Toast message on error */
  errorMessage?: string
  /** HTTP method (defaults to POST) */
  method?: 'POST' | 'PUT' | 'PATCH'
  /** Callback after failed submission */
  onError?: (error: unknown) => void
  /** Custom submit function (overrides endpoint-based submission) */
  onSubmit?: (data: T) => Promise<unknown>
  /** Callback after successful submission */
  onSuccess?: (data: unknown) => void | Promise<void>
  /** Zod schema for validation */
  schema: ZodObject<ZodRawShape>
  /** Toast message on success */
  successMessage?: string
}

export function useFormHandler<T extends Record<string, unknown>>(options: FormHandlerOptions<T>) {
  const {
    schema,
    defaults,
    endpoint,
    method = 'POST',
    successMessage = 'Submitted successfully!',
    errorMessage = 'Something went wrong. Please try again.',
    onSuccess,
    onError,
    onSubmit,
  } = options

  const toast = useToast()
  const nuxtApp = useNuxtApp()
  // Use the CSRF-aware fetch injected by fetch.client.ts when available.
  // Falls back to bare $fetch in test environments or before plugin initialisation.
  let csrfFetch: typeof $fetch = $fetch
  if (
    '$csrfFetch' in nuxtApp &&
    typeof (nuxtApp as unknown as { $csrfFetch?: typeof $fetch }).$csrfFetch === 'function'
  ) {
    csrfFetch = (nuxtApp as unknown as { $csrfFetch: typeof $fetch }).$csrfFetch
  }
  const state = reactive<T>({ ...defaults }) as T
  const _errors = reactive<Record<string, string>>({})
  const loading = ref(false)

  /** Clear all field errors */
  function clearErrors() {
    for (const key of Object.keys(_errors)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keys are from Object.keys(_errors), safe to delete dynamically
      delete _errors[key]
    }
  }

  /** Validate the form against the Zod schema */
  function validate(): boolean {
    clearErrors()
    const result = schema.safeParse(state)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path[0]
        if (field && typeof field === 'string') {
          _errors[field] = issue.message
        }
      }
      return false
    }
    return true
  }

  /** Submit the form (validates first) */
  async function submit() {
    if (!validate()) return

    loading.value = true
    try {
      let result: unknown

      if (onSubmit) {
        result = await onSubmit({ ...state })
      } else if (endpoint) {
        // Use the CSRF-aware fetch so the shared CSRF middleware (which requires
        // X-Requested-With on all mutations) never rejects these submissions.
        result = await csrfFetch(endpoint, {
          method,
          body: { ...state },
        })
      } else {
        throw new Error('useFormHandler: provide either `endpoint` or `onSubmit`')
      }

      toast.add({
        title: 'Success',
        description: successMessage,
        color: 'success',
        icon: 'i-lucide-check-circle',
      })

      if (onSuccess) await onSuccess(result)
    } catch (err: unknown) {
      const message = readFetchErrorMessage(err, errorMessage)
      toast.add({
        title: 'Error',
        description: message,
        color: 'error',
        icon: 'i-lucide-x-circle',
      })
      if (onError) onError(err)
    } finally {
      loading.value = false
    }
  }

  /** Reset form to defaults */
  function reset() {
    Object.assign(state, { ...defaults })
    clearErrors()
  }

  return {
    state,
    // Expose errors as readonly to prevent callers from directly mutating
    // validation state — use validate() / clearErrors() instead.
    errors: readonly(_errors) as Readonly<Record<string, string>>,
    loading: readonly(loading),
    submit,
    validate,
    reset,
    clearErrors,
  }
}
