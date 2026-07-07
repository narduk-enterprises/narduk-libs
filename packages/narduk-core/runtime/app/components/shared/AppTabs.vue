<script setup lang="ts">
import { get } from '@nuxt/ui/utils'

import { usePersistentTab } from '../../composables/usePersistentTab'
import {
  normalizePersistentTabValue,
  type PersistentTabStorage,
  type PersistentTabValue,
} from '../../utils/persistentTab'

import type { TabsItem, TabsProps } from '@nuxt/ui/components/Tabs.vue'

type AppTabsProps = Omit<TabsProps<TabsItem>, 'modelValue'> & {
  persistKey?: string
  queryKey?: string | false
  storage?: PersistentTabStorage
}

const props = withDefaults(defineProps<AppTabsProps>(), {
  persistKey: '',
  queryKey: false,
  storage: 'local',
  content: true,
  unmountOnHide: true,
})

const modelValue = defineModel<PersistentTabValue>()

const tabValues = computed<PersistentTabValue[]>(() =>
  (props.items ?? []).map((item, index) => {
    const value = get(item, props.valueKey ?? 'value')
    return typeof value === 'number' || typeof value === 'string' ? value : String(index)
  }),
)

const { currentValue } = usePersistentTab({
  defaultValue: computed(() => props.defaultValue),
  values: tabValues,
  persistKey: computed(() => props.persistKey),
  queryKey: computed(() => props.queryKey),
  storage: computed(() => props.storage),
})

watch(
  modelValue,
  (value) => {
    const nextValue = normalizePersistentTabValue({
      candidate: value,
      values: tabValues.value,
    })

    if (nextValue !== undefined && nextValue !== currentValue.value) {
      currentValue.value = nextValue
    }
  },
  { immediate: true },
)

watch(currentValue, (value) => {
  if (modelValue.value !== value) {
    modelValue.value = value
  }
})

const forwardedProps = computed(() => ({
  as: props.as,
  items: props.items,
  color: props.color,
  variant: props.variant,
  size: props.size,
  orientation: props.orientation,
  content: props.content,
  valueKey: props.valueKey,
  labelKey: props.labelKey,
  class: props.class,
  ui: props.ui,
  activationMode: props.activationMode,
  unmountOnHide: props.unmountOnHide,
}))

const itemSlotNames = computed(() =>
  Array.from(
    new Set(
      (props.items ?? [])
        .map((item) => item.slot)
        .filter(
          (slotName): slotName is string => typeof slotName === 'string' && slotName.length > 0,
        ),
    ),
  ),
)
</script>

<template>
  <!-- eslint-disable-next-line narduk/no-unknown-component-prop -- False positive on v-model mapping to modelValue -->
  <UTabs v-bind="forwardedProps" v-model="currentValue">
    <template #default="slotProps">
      <slot v-bind="slotProps ?? {}" />
    </template>

    <template #leading="slotProps">
      <slot name="leading" v-bind="slotProps ?? {}" />
    </template>

    <template #trailing="slotProps">
      <slot name="trailing" v-bind="slotProps ?? {}" />
    </template>

    <template #list-leading="slotProps">
      <slot name="list-leading" v-bind="slotProps ?? {}" />
    </template>

    <template #list-trailing="slotProps">
      <slot name="list-trailing" v-bind="slotProps ?? {}" />
    </template>

    <template v-for="slotName in itemSlotNames" #[slotName]="slotProps" :key="slotName">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>

    <template #content="slotProps">
      <slot :name="slotProps.item?.slot || 'content'" v-bind="slotProps ?? {}">
        {{ slotProps.item?.content }}
      </slot>
    </template>
  </UTabs>
</template>
