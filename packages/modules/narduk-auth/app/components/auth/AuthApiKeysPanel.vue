<script setup lang="ts">
/* eslint-disable max-lines -- API keys management panel is a cohesive CRUD surface (list + create modal + rotate + revoke + schema) co-located so users can reason about the full lifecycle in one file; AppCopyButton is a Nuxt auto-import from the core layer. */
import { formatBuildTimeLocal } from '@narduk-enterprises/narduk-core/app/utils/formatBuildTimeLocal'
import { z } from 'zod'

import {
  BOUNDARY_API_KEY_MAX_EXPIRY_DAYS,
  DEFAULT_API_KEY_EXPIRY_DAYS,
  isBoundaryClassApiKey,
  resolveApiKeyMintExpiry,
} from '../../../shared/utils/api-key-lifetime'
import {
  type AuthApiKeyCreateResponse,
  type AuthApiKeyScopeOption,
  type AuthApiKeySummary,
  type AuthApiKeyTokenProfile,
  useAuthApi,
} from '../../composables/useAuthApi'

const props = withDefaults(
  defineProps<{
    availableScopes?: AuthApiKeyScopeOption[]
    defaultTokenProfileId?: string | null
    tokenProfiles?: AuthApiKeyTokenProfile[]
  }>(),
  {
    availableScopes: () => [],
    tokenProfiles: () => [],
    defaultTokenProfileId: null,
  },
)

const toast = useToast()
const { listApiKeys, createApiKey, revokeApiKey } = useAuthApi()
const AUTH_API_KEY_SCOPE_SUGGESTIONS = [
  {
    id: 'auth:api-keys:read',
    label: 'auth:api-keys:read',
    description: 'List issued personal API tokens.',
  },
  {
    id: 'auth:api-keys:write',
    label: 'auth:api-keys:write',
    description: 'Create and revoke personal API tokens.',
  },
] as const
const API_KEY_EXPIRY_PRESETS = ['7 days', '30 days', '90 days', 'Never'] as const
const BOUNDED_API_KEY_EXPIRY_PRESETS = ['7 days', '30 days', '90 days'] as const

const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Token name is required.')
    .max(100, 'Keep the token name under 100 characters.'),
  scopesText: z.string().max(2_000, 'Keep the scopes list under 2,000 characters.').default(''),
  expiryPreset: z.enum(API_KEY_EXPIRY_PRESETS).default('30 days'),
})

const formState = reactive({
  name: '',
  scopesText: '',
  expiryPreset: '30 days' as z.output<typeof formSchema>['expiryPreset'],
})

const keys = shallowRef<AuthApiKeySummary[]>([])
const createdKey = shallowRef<AuthApiKeyCreateResponse | null>(null)
const loading = shallowRef(true)
const creating = shallowRef(false)
const revokingId = shallowRef<string | null>(null)
const errorMessage = shallowRef('')

const sortedKeys = computed(() =>
  [...keys.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
)
const draftScopes = computed(() => parseScopesInput(formState.scopesText))
const scopeSuggestions = computed<AuthApiKeyScopeOption[]>(() =>
  [...AUTH_API_KEY_SCOPE_SUGGESTIONS, ...props.availableScopes].filter(
    (scope, index, scopes) => scopes.findIndex((candidate) => candidate.id === scope.id) === index,
  ),
)
const scopeLabels = computed<Record<string, string>>(() =>
  Object.fromEntries(scopeSuggestions.value.map((scope) => [scope.id, scope.label])),
)
const tokenProfiles = computed(() => [...props.tokenProfiles])
const showUnscopedWarning = computed(
  () => scopeSuggestions.value.length > 0 && draftScopes.value.length === 0,
)
const isBoundaryDraft = computed(() => isBoundaryClassApiKey(draftScopes.value))
const expiryPresets = computed(() =>
  isBoundaryDraft.value ? BOUNDED_API_KEY_EXPIRY_PRESETS : API_KEY_EXPIRY_PRESETS,
)
const showNeverExpiresWarning = computed(
  () => formState.expiryPreset === 'Never' && !isBoundaryDraft.value,
)
const showWildcardBoundWarning = computed(() => isBoundaryDraft.value)

watch(isBoundaryDraft, (isBoundary) => {
  if (isBoundary && formState.expiryPreset === 'Never') {
    formState.expiryPreset = '30 days'
  }
})

async function loadKeys() {
  loading.value = true
  errorMessage.value = ''

  try {
    keys.value = await listApiKeys()
  } catch (error) {
    errorMessage.value =
      error instanceof Error && error.message.trim()
        ? error.message
        : 'API tokens could not be loaded.'
  } finally {
    loading.value = false
  }
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Never'
  return formatBuildTimeLocal(value, value)
}

function formatExpiry(value: number | null) {
  if (!value) return 'No expiry'
  const expiry = new Date(value * 1000)
  if (Number.isNaN(expiry.getTime())) return 'Invalid expiry'
  const expiryDate = expiry.toISOString()
  return formatBuildTimeLocal(expiryDate, expiryDate)
}

function parseScopesInput(value: string) {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ]
}

function formatScopes(scopes: readonly string[]) {
  return scopes.length > 0
    ? scopes.map((scope) => scopeLabels.value[scope] ?? scope).join(', ')
    : 'Unscoped'
}

function resolveExpiryInDays(preset: z.output<typeof formSchema>['expiryPreset']) {
  switch (preset) {
    case '7 days':
      return 7
    case '30 days':
      return 30
    case '90 days':
      return 90
    case 'Never':
      return null
  }
}

function resolveExpiryPreset(expiresInDays: number | null | undefined) {
  switch (expiresInDays) {
    case 7:
      return '7 days'
    case 30:
    case undefined:
      return '30 days'
    case 90:
      return '90 days'
    case null:
      return 'Never'
    default:
      return '30 days'
  }
}

function formatPresetExpiry(
  expiresInDays: number | null | undefined,
  scopes: readonly string[] = [],
) {
  const mintExpiry = resolveApiKeyMintExpiry(scopes, expiresInDays)
  const days = mintExpiry.ok ? mintExpiry.expiresInDays : DEFAULT_API_KEY_EXPIRY_DAYS
  if (days === null) {
    return 'No expiry'
  }

  return `${days} day expiry`
}

function applyTokenProfile(tokenProfile: AuthApiKeyTokenProfile) {
  const trimmedName = tokenProfile.name?.trim()
  const scopes = [
    ...new Set((tokenProfile.scopes ?? []).map((scope) => scope.trim()).filter(Boolean)),
  ]
  const mintExpiry = resolveApiKeyMintExpiry(scopes, tokenProfile.expiresInDays)
  formState.name =
    trimmedName !== undefined && trimmedName !== '' ? trimmedName : tokenProfile.label
  formState.scopesText = scopes.join('\n')
  formState.expiryPreset = resolveExpiryPreset(
    mintExpiry.ok ? mintExpiry.expiresInDays : DEFAULT_API_KEY_EXPIRY_DAYS,
  )
}

function appendScopeSuggestion(scope: string) {
  const currentScopes = parseScopesInput(formState.scopesText)
  if (currentScopes.includes(scope)) {
    return
  }

  formState.scopesText = [...currentScopes, scope].join('\n')
}

async function submitCreate(event: { data: z.output<typeof formSchema> }) {
  creating.value = true
  errorMessage.value = ''

  try {
    const response = await createApiKey({
      name: event.data.name,
      scopes: parseScopesInput(event.data.scopesText),
      expiresInDays: resolveExpiryInDays(event.data.expiryPreset),
    })
    createdKey.value = response
    formState.name = ''
    formState.scopesText = ''
    formState.expiryPreset = '30 days'
    await loadKeys()
    toast.add({
      title: 'API token created',
      description: 'Copy the raw token now. It will not be shown again.',
      color: 'success',
    })
  } catch (error) {
    const description =
      error instanceof Error && error.message.trim()
        ? error.message
        : 'The API token could not be created.'

    errorMessage.value = description
    toast.add({
      title: 'Token creation failed',
      description,
      color: 'error',
    })
  } finally {
    creating.value = false
  }
}

async function handleRevoke(id: string) {
  revokingId.value = id
  errorMessage.value = ''

  try {
    await revokeApiKey(id)
    if (createdKey.value?.id === id) {
      createdKey.value = null
    }
    keys.value = keys.value.filter((key) => key.id !== id)
    toast.add({
      title: 'API token revoked',
      color: 'success',
    })
  } catch (error) {
    const description =
      error instanceof Error && error.message.trim()
        ? error.message
        : 'The API token could not be revoked.'

    errorMessage.value = description
    toast.add({
      title: 'Token revocation failed',
      description,
      color: 'error',
    })
  } finally {
    revokingId.value = null
  }
}

onMounted(() => {
  if (props.defaultTokenProfileId && !formState.name && !formState.scopesText) {
    const defaultTokenProfile = tokenProfiles.value.find(
      (tokenProfile) => tokenProfile.id === props.defaultTokenProfileId,
    )
    if (defaultTokenProfile) {
      applyTokenProfile(defaultTokenProfile)
    }
  }

  void loadKeys()
})
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
    <UCard>
      <div class="space-y-5">
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-dimmed">Create token</p>
          <h2 class="text-lg font-semibold text-default">Personal API access</h2>
          <p class="text-sm text-muted">
            Mint a token for your signed-in account, then use it as
            <code class="font-mono text-xs">Authorization: Bearer nk_...</code>.
          </p>
        </div>

        <UAlert
          color="warning"
          variant="subtle"
          title="Shown once"
          description="The raw token is only returned during creation. Copy it before leaving this page."
        />

        <div v-if="tokenProfiles.length > 0" class="space-y-3">
          <div class="space-y-1">
            <p class="text-xs font-semibold uppercase tracking-[0.16em] text-dimmed">
              Recommended token profiles
            </p>
            <p class="text-sm text-muted">
              Start from a recommended token profile, then adjust the name, scopes, or expiry if you
              need something more specific.
            </p>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div
              v-for="tokenProfile in tokenProfiles"
              :key="tokenProfile.id"
              class="rounded-2xl border border-default bg-default/60 p-4"
            >
              <div class="space-y-3">
                <div class="space-y-1">
                  <div class="flex items-center justify-between gap-3">
                    <p class="font-medium text-default">{{ tokenProfile.label }}</p>
                    <UButton
                      type="button"
                      color="neutral"
                      variant="soft"
                      size="xs"
                      @click="applyTokenProfile(tokenProfile)"
                    >
                      Use profile
                    </UButton>
                  </div>
                  <p class="text-sm text-muted">{{ tokenProfile.description }}</p>
                </div>

                <div class="flex flex-wrap gap-2">
                  <UBadge
                    v-for="scope in tokenProfile.scopes ?? []"
                    :key="scope"
                    color="info"
                    variant="soft"
                  >
                    {{ scopeLabels[scope] ?? scope }}
                  </UBadge>
                  <UBadge
                    v-if="(tokenProfile.scopes ?? []).length === 0"
                    color="neutral"
                    variant="soft"
                  >
                    Unscoped
                  </UBadge>
                  <UBadge color="neutral" variant="soft">
                    {{ formatPresetExpiry(tokenProfile.expiresInDays, tokenProfile.scopes) }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <UForm
          :schema="formSchema"
          :state="formState"
          class="space-y-4"
          @submit.prevent="submitCreate"
        >
          <UFormField name="name" label="Token name">
            <UInput
              v-model="formState.name"
              class="w-full"
              placeholder="Codex operator token"
              autocomplete="off"
            />
          </UFormField>

          <UFormField
            name="scopesText"
            label="Scopes"
            description="Optional. Comma or newline separated. Leave blank for a token that only works on endpoints without scope requirements."
          >
            <div class="space-y-3">
              <UTextarea
                v-model="formState.scopesText"
                autoresize
                class="w-full"
                :rows="5"
                placeholder="registry:read&#10;registry:write"
              />

              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="scope in scopeSuggestions"
                  :key="scope.id"
                  type="button"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  @click="appendScopeSuggestion(scope.id)"
                >
                  Add {{ scope.label }}
                </UButton>
              </div>
            </div>
          </UFormField>

          <UFormField
            name="expiryPreset"
            label="Expiry"
            description="Default tokens expire after 30 days unless you choose a different preset."
          >
            <!-- eslint-disable narduk/no-unknown-component-prop -- False positive on v-model mapping to modelValue -->
            <USelectMenu
              v-model="formState.expiryPreset"
              :items="[...expiryPresets]"
              class="w-full"
            />
            <!-- eslint-enable narduk/no-unknown-component-prop -->
          </UFormField>

          <UAlert
            v-if="showUnscopedWarning"
            color="warning"
            variant="subtle"
            title="Unscoped token"
            description="This token will only work on endpoints that do not require explicit API key scopes."
          />

          <UAlert
            v-if="showNeverExpiresWarning"
            color="warning"
            variant="subtle"
            title="No expiry selected"
            description="Long-lived tokens are harder to contain. Prefer a short-lived token unless you have a concrete automation reason."
          />

          <UAlert
            v-if="showWildcardBoundWarning"
            color="warning"
            variant="subtle"
            title="Wildcard token"
            :description="`A * token admits its bearer to every scoped route. It must expire, and the lifetime is capped at ${BOUNDARY_API_KEY_MAX_EXPIRY_DAYS} days.`"
          />

          <UButton type="submit" color="primary" icon="i-lucide-key-round" :loading="creating">
            Create token
          </UButton>
        </UForm>

        <UAlert
          v-if="createdKey"
          color="success"
          variant="subtle"
          title="Copy this token now"
          description="Anyone with this value can act as your account until you revoke it."
        >
          <template #description>
            <div class="space-y-3">
              <p class="text-sm text-muted">
                Anyone with this value can act as your account until you revoke it.
              </p>
              <div class="rounded-2xl border border-success/30 bg-success/5 p-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <code class="min-w-0 flex-1 break-all font-mono text-xs text-default">
                    {{ createdKey.rawKey }}
                  </code>
                  <AppCopyButton
                    :text="createdKey.rawKey"
                    label="Copy"
                    color="success"
                    variant="soft"
                    size="sm"
                  />
                </div>
              </div>
              <dl class="grid gap-2 text-sm text-muted sm:grid-cols-2">
                <div>
                  <dt class="text-xs uppercase tracking-[0.16em] text-dimmed">Scopes</dt>
                  <dd>{{ formatScopes(createdKey.scopes) }}</dd>
                </div>
                <div>
                  <dt class="text-xs uppercase tracking-[0.16em] text-dimmed">Expires</dt>
                  <dd>{{ formatExpiry(createdKey.expiresAt) }}</dd>
                </div>
              </dl>
            </div>
          </template>
        </UAlert>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          title="Token error"
          :description="errorMessage"
        />
      </div>
    </UCard>

    <UCard>
      <div class="space-y-5">
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-dimmed">
            Existing tokens
          </p>
          <h2 class="text-lg font-semibold text-default">Manage issued access</h2>
          <p class="text-sm text-muted">
            Revoke any token you no longer need. The displayed prefix is safe to keep for
            identification.
          </p>
        </div>

        <UAlert
          v-if="loading"
          color="neutral"
          variant="subtle"
          title="Loading tokens"
          description="Reading your current API token inventory."
        />

        <UAlert
          v-else-if="sortedKeys.length === 0"
          color="neutral"
          variant="subtle"
          title="No API tokens yet"
          description="Create your first token to call protected APIs from automation or external tools."
        />

        <div v-else class="space-y-3">
          <div
            v-for="key in sortedKeys"
            :key="key.id"
            class="rounded-3xl border border-default bg-default/70 p-4"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="font-medium text-default">{{ key.name }}</p>
                  <UBadge color="neutral" variant="soft">{{ key.keyPrefix }}</UBadge>
                </div>
                <dl class="grid gap-1 text-sm text-muted sm:grid-cols-3 sm:gap-3">
                  <div>
                    <dt class="text-xs uppercase tracking-[0.16em] text-dimmed">Created</dt>
                    <dd>{{ formatTimestamp(key.createdAt) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.16em] text-dimmed">Last used</dt>
                    <dd>{{ formatTimestamp(key.lastUsedAt) }}</dd>
                  </div>
                  <div>
                    <dt class="text-xs uppercase tracking-[0.16em] text-dimmed">Expires</dt>
                    <dd>{{ formatExpiry(key.expiresAt) }}</dd>
                  </div>
                </dl>
                <div class="flex flex-wrap gap-2">
                  <UBadge v-for="scope in key.scopes" :key="scope" color="info" variant="soft">
                    {{ scopeLabels[scope] ?? scope }}
                  </UBadge>
                  <UBadge v-if="key.scopes.length === 0" color="neutral" variant="soft">
                    Unscoped
                  </UBadge>
                </div>
              </div>

              <UButton
                color="error"
                variant="soft"
                icon="i-lucide-trash-2"
                :loading="revokingId === key.id"
                @click="handleRevoke(key.id)"
              >
                Revoke
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
