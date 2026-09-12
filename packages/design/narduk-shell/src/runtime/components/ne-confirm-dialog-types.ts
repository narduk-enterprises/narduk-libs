import type { Component } from 'vue'

/**
 * `NeConfirmDialog`'s public types.
 *
 * They live beside the single-file component rather than inside it so the SFC
 * keeps ONE `<script setup>` block: a second plain `<script>` block just to
 * export an interface makes eslint-plugin-vue lint both blocks as one module,
 * and every import in the setup block then reads as an "import in body of
 * module" (the narduk-mapkit-nuxt `AppMapKit.vue` problem). `use-confirm.ts`
 * imports its tone type from here too, so a `.ts` consumer never has to reach
 * into a `.vue` file for a type.
 */

/** `danger` is for irreversible actions. It changes colour AND initial focus. */
export type NeConfirmTone = 'default' | 'danger'

export interface NeConfirmDialogProps {
  /** Dialog heading. Also the dialog's accessible name (`aria-labelledby`). */
  title?: string
  /** One-line consequence. Also the accessible description (`aria-describedby`). */
  message?: string
  /** Confirm button label. */
  confirmLabel?: string
  /** Cancel button label. */
  cancelLabel?: string
  /**
   * `danger` colours the confirm button with the `error` semantic colour and
   * moves initial focus to Cancel. See the README's focus rules.
   */
  tone?: NeConfirmTone
  /**
   * While true the confirm button shows its loading state, the cancel button is
   * disabled, and Escape / outside-click dismissal is turned off (Nuxt UI's
   * `dismissible: false`, i.e. `preventClose`).
   */
  pending?: boolean
  /** Failure text rendered in the body as a live `role="alert"` region. */
  error?: string
  /** A component rendered in the dialog body — stonx's trade summary, say. */
  body?: Component
  /** Props handed to `body`. Named `props` to match the plan's `confirm({ body, props })`. */
  props?: Record<string, unknown>
}
