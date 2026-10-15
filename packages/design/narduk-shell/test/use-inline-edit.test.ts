// @vitest-environment happy-dom
/*
 * useInlineEdit(): open, type, Enter or blur keeps it on screen at once, Escape
 * drops it, a refused save restores the old text and reopens the field with
 * what was typed.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { useInlineEdit } from '../src/runtime/composables/use-inline-edit'

import type { NeInlineEdit, NeInlineEditOptions } from '../src/runtime/composables/use-inline-edit'
import type { Ref } from 'vue'

function harness(
  initial: string,
  save: (next: string) => unknown,
  options: NeInlineEditOptions<string> = { toast: false },
) {
  let value!: Ref<string>
  let edit!: NeInlineEdit<string>
  mount(
    defineComponent({
      setup() {
        value = ref(initial)
        edit = useInlineEdit(value, save, options)
        return () => h('div')
      },
    }),
  )
  return { edit, value }
}

function key(init: Partial<KeyboardEvent> & { key: string }) {
  return {
    ctrlKey: false,
    isComposing: false,
    metaKey: false,
    preventDefault: vi.fn(),
    ...init,
  }
}

function pendingSave() {
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise
  })
  return { promise, reject }
}

describe('useInlineEdit', () => {
  it('opens on the current value', () => {
    const { edit } = harness('Alpha', async () => {})
    edit.start()
    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value).toBe('Alpha')
  })

  it('commits on Enter: the field closes and the value is already the draft', async () => {
    const save = vi.fn(async () => {})
    const { edit, value } = harness('Alpha', save)
    edit.start()
    edit.draft.value = 'Beta'

    const event = key({ key: 'Enter' })
    edit.onKeydown(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(edit.editing.value).toBe(false)
    expect(value.value).toBe('Beta')
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('Beta'))
  })

  it('cancels on Escape without saving, and a following blur does not commit', async () => {
    const save = vi.fn(async () => {})
    const { edit, value } = harness('Alpha', save)
    edit.start()
    edit.draft.value = 'Beta'

    edit.onKeydown(key({ key: 'Escape' }))
    await edit.commit()

    expect(edit.editing.value).toBe(false)
    expect(value.value).toBe('Alpha')
    expect(edit.draft.value).toBe('Alpha')
    expect(save).not.toHaveBeenCalled()
  })

  it('commits on blur', async () => {
    const save = vi.fn(async () => {})
    const { edit, value } = harness('Alpha', save)
    edit.start()
    edit.draft.value = 'Gamma'

    await expect(edit.commit()).resolves.toBe(true)

    expect(value.value).toBe('Gamma')
    expect(save).toHaveBeenCalledWith('Gamma')
  })

  it('does not call save when nothing changed', async () => {
    const save = vi.fn(async () => {})
    const { edit } = harness('Alpha', save)
    edit.start()

    await expect(edit.commit()).resolves.toBe(true)

    expect(edit.editing.value).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps the field open and does not save a draft validate refuses', async () => {
    const save = vi.fn(async () => {})
    const { edit, value } = harness('Alpha', save, {
      toast: false,
      validate: (draft) => draft.trim().length > 0,
    })
    edit.start()
    edit.draft.value = '   '

    await expect(edit.commit()).resolves.toBe(false)

    expect(edit.editing.value).toBe(true)
    expect(value.value).toBe('Alpha')
    expect(save).not.toHaveBeenCalled()
  })

  it('restores the old value and reopens the field with the typed draft when the save fails', async () => {
    const onError = vi.fn()
    const { edit, value } = harness(
      'Alpha',
      async () => {
        throw new Error('nope')
      },
      { toast: false, onError },
    )
    edit.start()
    edit.draft.value = 'Beta'

    await expect(edit.commit()).resolves.toBe(false)

    expect(value.value).toBe('Alpha')
    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value).toBe('Beta')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('preserves a newer draft when an older save fails', async () => {
    const pending = pendingSave()
    const { edit } = harness('Alpha', () => pending.promise)
    edit.start()
    edit.draft.value = 'Beta'
    const commit = edit.commit()
    edit.start()
    edit.draft.value = 'Gamma'

    pending.reject(new Error('old save failed'))
    await expect(commit).resolves.toBe(false)

    expect(edit.editing.value).toBe(true)
    expect(edit.draft.value).toBe('Gamma')
  })

  it('does not reopen an older draft after a newer save succeeds', async () => {
    const pending = pendingSave()
    const save = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined)
    const { edit, value } = harness('Alpha', save)
    edit.start()
    edit.draft.value = 'Beta'
    const commit = edit.commit()
    edit.start()
    edit.draft.value = 'Gamma'
    await expect(edit.commit()).resolves.toBe(true)

    pending.reject(new Error('old save failed'))
    await expect(commit).resolves.toBe(false)

    expect(value.value).toBe('Gamma')
    expect(edit.editing.value).toBe(false)
    expect(edit.draft.value).toBe('Gamma')
  })

  it('does not reopen after a newer editing session is cancelled', async () => {
    const pending = pendingSave()
    const { edit } = harness('Alpha', () => pending.promise)
    edit.start()
    edit.draft.value = 'Beta'
    const commit = edit.commit()
    edit.start()
    edit.cancel()

    pending.reject(new Error('old save failed'))
    await expect(commit).resolves.toBe(false)

    expect(edit.editing.value).toBe(false)
  })

  it('leaves Enter as a newline in multiline mode, and commits on Cmd or Ctrl+Enter', async () => {
    const save = vi.fn(async () => {})
    const { edit } = harness('Alpha', save, { multiline: true, toast: false })
    edit.start()
    edit.draft.value = 'Alpha\nBeta'

    const plain = key({ key: 'Enter' })
    edit.onKeydown(plain)
    expect(plain.preventDefault).not.toHaveBeenCalled()
    expect(edit.editing.value).toBe(true)

    edit.onKeydown(key({ key: 'Enter', metaKey: true }))
    expect(edit.editing.value).toBe(false)
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('Alpha\nBeta'))
  })

  it('ignores Enter and Escape during IME composition', () => {
    const { edit } = harness('Alpha', async () => {})
    edit.start()

    edit.onKeydown(key({ key: 'Enter', isComposing: true }))
    edit.onKeydown(key({ key: 'Escape', isComposing: true }))

    expect(edit.editing.value).toBe(true)
  })
})
