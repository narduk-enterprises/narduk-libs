/**
 * useFAQSchema — typed wrapper around nuxt-schema-org for FAQPage JSON-LD.
 *
 * @example
 * ```ts
 * useFAQSchema([
 *   { question: 'What is Nuxt 4?', answer: 'The latest version...' },
 *   { question: 'Is it fast?', answer: 'Extremely fast...' },
 * ])
 * ```
 */

import { useSchemaOrg } from '#imports'

interface FAQItem {
  answer: string
  question: string
}

export function useFAQSchema(items: FAQItem[]) {
  useSchemaOrg([
    {
      '@type': 'FAQPage',
      mainEntity: items.map((item) => ({
        '@type': 'Question' as const,
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer' as const,
          text: item.answer,
        },
      })),
    },
  ])
}
