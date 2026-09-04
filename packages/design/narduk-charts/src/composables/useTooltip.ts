import { reactive } from 'vue'
import type { TooltipItem } from '../types'

export interface TooltipState {
  visible: boolean
  x: number
  y: number
  title: string
  items: TooltipItem[]
}

export function useTooltip() {
  const tooltip = reactive<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    items: [],
  })

  function show(x: number, y: number, title: string, items: TooltipItem[]) {
    tooltip.x = x
    tooltip.y = y
    tooltip.title = title
    tooltip.items = items
    tooltip.visible = true
  }

  function hide() {
    tooltip.visible = false
  }

  return { tooltip, show, hide }
}
