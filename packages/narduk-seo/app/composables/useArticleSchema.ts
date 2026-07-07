/**
 * useArticleSchema — typed wrapper around nuxt-schema-org for Article JSON-LD.
 *
 * @example
 * ```ts
 * useArticleSchema({
 *   headline: 'How to Deploy Nuxt 4',
 *   description: 'A complete guide...',
 *   datePublished: '2026-02-20',
 *   author: { name: 'Jane Doe', url: 'https://jane.dev' },
 *   image: '/images/deploy-guide.png',
 * })
 * ```
 */

import { defineArticle, useSchemaOrg } from '#imports'

interface ArticleAuthor {
  name: string
  url?: string
}

interface ArticleOptions {
  author: ArticleAuthor | ArticleAuthor[]
  dateModified?: string
  datePublished: string
  description?: string
  headline: string
  image?: string | string[]
  section?: string
  tags?: string[]
}

export function useArticleSchema(options: ArticleOptions) {
  const { headline, description, datePublished, dateModified, author, section, image, tags } =
    options

  const authors = Array.isArray(author) ? author : [author]

  const imageVal = Array.isArray(image) ? image[0] : image
  const articleInput = {
    headline,
    description,
    datePublished,
    dateModified: dateModified ?? datePublished,
    author: authors.map((a) => ({
      name: a.name,
      url: a.url,
    })),
    ...(imageVal !== undefined && imageVal !== '' && { image: imageVal }),
    ...(section !== undefined && section !== '' && { articleSection: section }),
    ...(tags !== undefined && tags.length > 0 && { keywords: tags }),
  }
  useSchemaOrg([defineArticle(articleInput as Parameters<typeof defineArticle>[0])])
}
