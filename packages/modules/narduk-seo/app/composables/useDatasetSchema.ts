// useDatasetSchema — typed wrapper around nuxt-schema-org for Dataset JSON-LD.

import { toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

export interface DatasetCreator {
  /** `Organization` unless the dataset is credited to a named individual. */
  '@type'?: 'Organization' | 'Person'
  name: string
  url?: string
}

/**
 * One measured property. A bare string is the property's name, which is what
 * most pages need; the object form carries units and range so Dataset Search
 * can describe the series rather than only list it.
 */
export interface DatasetVariable {
  description?: string
  maxValue?: number
  minValue?: number
  name: string
  /** UN/CEFACT Common Code, e.g. `CEL` for degrees Celsius. */
  unitCode?: string
  /** Human-readable unit, e.g. `m` or `°C`. */
  unitText?: string
}

/** A downloadable form of the dataset. `contentUrl` is what makes it useful. */
export interface DatasetDistribution {
  contentUrl: string
  /** IANA media type, e.g. `text/plain` or `application/json`. */
  encodingFormat?: string
  name?: string
}

export interface DatasetSchemaInput {
  creator?: DatasetCreator
  dateModified?: string | null
  description?: string | null
  distribution?: DatasetDistribution[]
  identifier?: string | null
  includedInDataCatalogUrl?: string | null
  isAccessibleForFree?: boolean
  keywords?: string[]
  /** URL of the licence the data is published under. */
  license?: string | null
  name: string
  sameAs?: string[]
  /** Free-text or a place name, e.g. `Gulf of Mexico`. */
  spatialCoverage?: string | null
  /**
   * ISO 8601 interval. An open-ended series ends with `/..`, e.g.
   * `2020-01-01/..` for a feed that is still being written to.
   */
  temporalCoverage?: string | null
  url?: string | null
  variableMeasured?: Array<DatasetVariable | string>
}

function toPropertyValue(variable: DatasetVariable | string) {
  if (typeof variable === 'string') {
    return { '@type': 'PropertyValue' as const, name: variable }
  }

  const { name, unitText, unitCode, description, minValue, maxValue } = variable

  return {
    '@type': 'PropertyValue' as const,
    name,
    ...(description && { description }),
    ...(unitText && { unitText }),
    ...(unitCode && { unitCode }),
    ...(minValue !== undefined && { minValue }),
    ...(maxValue !== undefined && { maxValue }),
  }
}

function toDataDownload(distribution: DatasetDistribution) {
  const { contentUrl, encodingFormat, name } = distribution

  return {
    '@type': 'DataDownload' as const,
    contentUrl,
    ...(name && { name }),
    ...(encodingFormat && { encodingFormat }),
  }
}

export function useDatasetSchema(input: MaybeRefOrGetter<DatasetSchemaInput>): void {
  const value = toValue(input)
  if (!value.name) return

  const {
    name,
    description,
    url,
    identifier,
    keywords,
    license,
    creator,
    variableMeasured,
    temporalCoverage,
    spatialCoverage,
    distribution,
    includedInDataCatalogUrl,
    isAccessibleForFree,
    dateModified,
    sameAs,
  } = value

  const variableNodes = (variableMeasured ?? [])
    .filter((variable) => (typeof variable === 'string' ? variable : variable.name))
    .map(toPropertyValue)
  const distributionNodes = (distribution ?? [])
    .filter((entry) => entry.contentUrl)
    .map(toDataDownload)

  useSchemaOrg([
    {
      '@type': 'Dataset' as const,
      name,
      ...(description && { description }),
      ...(url && { url }),
      ...(identifier && { identifier }),
      ...(keywords && keywords.length > 0 && { keywords }),
      ...(license && { license }),
      ...(temporalCoverage && { temporalCoverage }),
      ...(spatialCoverage && { spatialCoverage }),
      ...(isAccessibleForFree !== undefined && { isAccessibleForFree }),
      ...(dateModified && { dateModified }),
      ...(sameAs && sameAs.length > 0 && { sameAs }),
      ...(variableNodes.length > 0 && { variableMeasured: variableNodes }),
      ...(distributionNodes.length > 0 && { distribution: distributionNodes }),
      ...(creator && {
        creator: {
          '@type': creator['@type'] ?? ('Organization' as const),
          name: creator.name,
          ...(creator.url && { url: creator.url }),
        },
      }),
      ...(includedInDataCatalogUrl && {
        includedInDataCatalog: {
          '@type': 'DataCatalog' as const,
          url: includedInDataCatalogUrl,
        },
      }),
    },
  ])
}
