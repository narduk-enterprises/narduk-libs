import inventory from '#explorer-inventory'

export function useInventory() {
  return inventory
}

export function exampleRoute(id: string, category = 'components') {
  return `/${category}/${id}`
}
