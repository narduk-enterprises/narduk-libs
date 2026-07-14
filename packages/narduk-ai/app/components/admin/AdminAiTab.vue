<script setup lang="ts">
/* eslint-disable narduk/file-size-budget -- AI admin tab is a cohesive configuration panel for model and prompt administration. */
import { formatBuildTimeLocal } from '@narduk-enterprises/narduk-core/app/utils/formatBuildTimeLocal'

const props = withDefaults(
  defineProps<{
    availableModels?: string[]
  }>(),
  {
    availableModels: () => [
      'grok-4-1-fast-non-reasoning',
      'grok-3-mini',
      'grok-4',
      'grok-4.20-beta-latest-non-reasoning',
      'grok-2-1212',
    ],
  },
)

const adminAi = useAdminAi()
const editingPrompts = ref<Record<string, string>>({})

watch(
  () => adminAi.systemPrompts.value,
  (prompts) => {
    if (!prompts) return
    for (const prompt of prompts) {
      if (!(prompt.name in editingPrompts.value)) {
        editingPrompts.value[prompt.name] = prompt.content
      }
    }
  },
  { immediate: true },
)

function isPromptChanged(name: string) {
  const original = adminAi.systemPrompts.value?.find((prompt) => prompt.name === name)
  return original ? original.content !== editingPrompts.value[name] : false
}

function resetPrompt(name: string) {
  const original = adminAi.systemPrompts.value?.find((prompt) => prompt.name === name)
  if (original) {
    editingPrompts.value[name] = original.content
  }
}

function handleModelChange(event: unknown) {
  void adminAi.updateActiveModel(String(event))
}

function handleSavePrompt(name: string) {
  void adminAi.updateSystemPrompt(name, editingPrompts.value[name] ?? '')
}
</script>

<template>
  <div class="space-y-6">
    <UCard class="card-base border-default">
      <div
        class="sticky top-0 z-10 flex flex-col gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-default/80"
      >
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">AI Settings</p>
          <h2 class="text-lg font-semibold text-default">Model Configuration</h2>
        </div>
        <p class="text-sm text-muted">
          Select the active model used by shared AI-backed routes and tools.
        </p>
      </div>

      <div class="space-y-4 p-4">
        <slot name="feature-flags" />

        <UFormField label="Active Chat Model" class="max-w-md">
          <div class="flex gap-2">
            <USelectMenu
              :model-value="adminAi.currentModel.value"
              :items="props.availableModels"
              class="w-full flex-1"
              @update:model-value="handleModelChange"
            />
            <UButton
              v-if="adminAi.isUpdatingModel.value"
              color="neutral"
              variant="outline"
              loading
              disabled
            />
          </div>
        </UFormField>
      </div>
    </UCard>

    <UCard class="card-base border-default">
      <div
        class="sticky top-0 z-10 flex flex-col gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-default/80"
      >
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">Instructions</p>
          <h2 class="text-lg font-semibold text-default">System Prompts</h2>
        </div>
        <p class="text-sm text-muted">
          Edit the baseline instructions used by AI-backed workflows and internal tools.
        </p>
      </div>

      <div class="space-y-8 p-4">
        <div v-if="adminAi.promptsStatus.value === 'pending'" class="flex justify-center py-12">
          <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative loading indicator; Lucide sprite has no separate alt -->
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <div
          v-else-if="!adminAi.systemPrompts.value || adminAi.systemPrompts.value.length === 0"
          class="py-12 text-center text-muted"
        >
          No system prompts configured in the database.
        </div>

        <div
          v-for="prompt in adminAi.systemPrompts.value"
          :key="prompt.name"
          class="space-y-3 border-t border-default pt-6 first:border-t-0 first:pt-0"
        >
          <div class="flex items-start justify-between">
            <div class="space-y-1">
              <h3 class="font-mono text-sm font-medium text-default">{{ prompt.name }}</h3>
              <p class="text-sm text-muted">{{ prompt.description }}</p>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                v-if="isPromptChanged(prompt.name)"
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-rotate-ccw"
                @click="resetPrompt(prompt.name)"
              />
              <UButton
                size="sm"
                color="primary"
                :disabled="!isPromptChanged(prompt.name)"
                :loading="adminAi.isUpdatingPrompt.value === prompt.name"
                @click="handleSavePrompt(prompt.name)"
              >
                Save Changes
              </UButton>
            </div>
          </div>

          <UTextarea
            v-model="editingPrompts[prompt.name]"
            autoresize
            :rows="5"
            class="w-full font-mono text-sm"
          />
          <p class="text-right text-xs text-muted">
            Last updated: {{ formatBuildTimeLocal(prompt.updatedAt, prompt.updatedAt) }}
          </p>
        </div>
      </div>
    </UCard>
  </div>
</template>
