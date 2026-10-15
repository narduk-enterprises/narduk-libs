/**
 * useInlineEdit() — click (or Enter) to edit a value where it stands, Enter or
 * blur to keep it, Escape to drop it. The value updates on screen at once and
 * the save runs behind it (`useOptimistic`), so there is no save button and no
 * spinner.
 *
 * Headless on purpose: the app draws the text and the field; this holds the
 * state and the keys.
 *
 * ```vue
 * <script setup lang="ts">
 * const name = ref(project.name)
 * const edit = useInlineEdit(name, (next) => $fetch(`/api/projects/${project.id}`, {
 *   method: 'PATCH', body: { name: next },
 * }), { errorTitle: 'Could not rename the project' })
 * </script>
 *
 * <template>
 *   <input v-if="edit.editing.value" v-model="edit.draft.value" autofocus
 *     @keydown="edit.onKeydown" @blur="edit.commit()" />
 *   <button v-else type="button" @click="edit.start()">{{ name }}</button>
 * </template>
 * ```
 *
 * - `commit()` closes the field first, so the new text is already on screen.
 *   A draft equal to the value, or one `validate` rejects by returning `false`,
 *   closes (or stays open) without a request.
 * - A failed save puts the old value back (`useOptimistic`'s rollback and toast)
 *   and reopens the field holding what the user typed, unless a newer editing
 *   session has started or been cancelled.
 * - `onKeydown`: Escape cancels; Enter commits, or Cmd/Ctrl+Enter when
 *   `multiline` is set (Enter is then a newline). Enter during IME composition
 *   is left alone.
 * - Escape followed by the blur that removing the field triggers does not
 *   commit: `commit()` does nothing unless the field is open.
 */
import { ref } from 'vue'

import { useOptimistic } from './use-optimistic'

import type { NeOptimisticOptions } from './use-optimistic'
import type { Ref } from 'vue'

export interface NeInlineEditOptions<T> extends NeOptimisticOptions {
  /** Enter inserts a newline; Cmd/Ctrl+Enter commits. Default `false`. */
  multiline?: boolean
  /** Return `false` to refuse a draft (empty name, bad format): the field stays open. */
  validate?: (draft: T) => boolean
}

export interface NeInlineEdit<T> {
  /** Close the field and drop the draft. */
  cancel: () => void
  /** Keep the draft: show it now, save it behind. Resolves `true` unless the save failed. */
  commit: () => Promise<boolean>
  /** The field's value while editing. Bind it with `v-model`. */
  draft: Ref<T>
  /** `true` while the field is open. */
  editing: Ref<boolean>
  /** Bind to the field's `keydown`. */
  onKeydown: (
    event: Pick<KeyboardEvent, 'ctrlKey' | 'isComposing' | 'key' | 'metaKey' | 'preventDefault'>,
  ) => void
  /** Open the field on the current value. */
  start: () => void
}

export function useInlineEdit<T>(
  value: Ref<T>,
  save: (next: T) => unknown,
  options: NeInlineEditOptions<T> = {},
): NeInlineEdit<T> {
  const optimistic = useOptimistic(value, options)
  const editing = ref(false)
  const draft = ref(value.value) as Ref<T>
  let editGeneration = 0

  function start() {
    editGeneration++
    draft.value = value.value
    editing.value = true
  }

  function cancel() {
    editGeneration++
    editing.value = false
    draft.value = value.value
  }

  async function commit() {
    if (!editing.value) return true
    const next = draft.value
    if (options.validate && !options.validate(next)) return false
    editing.value = false
    if (Object.is(next, value.value)) return true
    const generation = editGeneration
    const result = await optimistic.mutate(
      () => next,
      (confirmed) => save(confirmed),
    )
    if (!result.ok && generation === editGeneration && Object.is(draft.value, next)) {
      draft.value = next
      editing.value = true
    }
    return result.ok
  }

  function onKeydown(event: Parameters<NeInlineEdit<T>['onKeydown']>[0]) {
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    } else if (event.key === 'Enter' && (!options.multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }

  return { cancel, commit, draft, editing, onKeydown, start }
}
