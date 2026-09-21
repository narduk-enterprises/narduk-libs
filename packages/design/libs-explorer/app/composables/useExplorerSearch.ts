/**
 * One search index over everything the Explorer shows: package names,
 * component names, summaries and capability words ("CSV", "callout",
 * "upload"). Matching is every whitespace-separated term, case-insensitive.
 */
export interface SearchEntry {
  label: string
  to: string
  group: 'Overview' | 'Components' | 'Packages'
  text: string
}

export function useSearchIndex(): SearchEntry[] {
  const { examples, packages } = useInventory()
  return [
    { label: 'Home', to: '/', group: 'Overview', text: 'home overview' },
    {
      label: 'Foundations',
      to: '/foundations',
      group: 'Overview',
      text: 'foundations tokens color colour type typography radius elevation shadow',
    },
    ...examples.map((example) => ({
      label: example.title,
      to: exampleRoute(example.id, example.category),
      group: 'Components' as const,
      text: [example.id, example.title, example.component, example.package, example.summary]
        .filter(Boolean)
        .join(' '),
    })),
    ...packages.map((entry) => ({
      label: entry.slug,
      to: `/packages/${entry.slug}`,
      group: 'Packages' as const,
      text: [entry.name, entry.description, entry.kind, ...entry.capabilities].join(' '),
    })),
  ]
}

export function matchesQuery(entry: SearchEntry, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = `${entry.label} ${entry.text}`.toLowerCase()
  return terms.every((term) => haystack.includes(term))
}
