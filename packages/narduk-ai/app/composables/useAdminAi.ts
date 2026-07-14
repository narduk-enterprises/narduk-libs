import type { ComputedRef, Ref } from 'vue'

const ADMIN_AI_MODEL_API = '/api/admin/ai/model'
const ADMIN_SYSTEM_PROMPTS_API = '/api/admin/system-prompts'

export interface AdminSystemPrompt {
  content: string
  description: string
  name: string
  updatedAt: string
}

interface ModelResponse {
  currentModel: string
}

interface UpdateResponse {
  ok?: boolean
  success?: boolean
}

export function useAdminAi() {
  const toast = useToast()

  const { data: modelData, refresh: refreshModel } = useAsyncData('layer-admin-ai-model', () =>
    $fetch<ModelResponse>(ADMIN_AI_MODEL_API),
  )

  const currentModel = computed(() => modelData.value?.currentModel ?? 'grok-3-mini')
  const isUpdatingModel = ref(false)

  async function updateActiveModel(newModel: string) {
    if (!newModel) return
    isUpdatingModel.value = true
    try {
      await $fetch<UpdateResponse>(ADMIN_AI_MODEL_API, {
        method: 'PUT',
        body: { model: newModel },
      })
      toast.add({ title: 'AI model updated', color: 'success' })
      await refreshModel()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.add({
        title: 'Failed to update AI model',
        description: message,
        color: 'error',
      })
    } finally {
      isUpdatingModel.value = false
    }
  }

  const {
    data: systemPrompts,
    refresh: refreshPrompts,
    status: promptsStatus,
  } = useAsyncData<AdminSystemPrompt[]>('layer-admin-system-prompts', () =>
    $fetch<AdminSystemPrompt[]>(ADMIN_SYSTEM_PROMPTS_API),
  )

  const isUpdatingPrompt = ref<string | null>(null)

  async function updateSystemPrompt(name: string, content: string) {
    if (!name || !content) return
    isUpdatingPrompt.value = name
    try {
      await $fetch<UpdateResponse>(ADMIN_SYSTEM_PROMPTS_API, {
        method: 'PUT',
        body: { name, content },
      })
      toast.add({ title: 'Prompt updated', description: name, color: 'success' })
      await refreshPrompts()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      toast.add({
        title: 'Failed to update prompt',
        description: message,
        color: 'error',
      })
    } finally {
      if (isUpdatingPrompt.value === name) {
        isUpdatingPrompt.value = null
      }
    }
  }

  return {
    currentModel: currentModel as ComputedRef<string>,
    isUpdatingModel: isUpdatingModel as Ref<boolean>,
    updateActiveModel,
    systemPrompts: systemPrompts as unknown as Ref<AdminSystemPrompt[] | null>,
    promptsStatus: promptsStatus as unknown as Ref<string>,
    isUpdatingPrompt: isUpdatingPrompt as Ref<string | null>,
    updateSystemPrompt,
  }
}
