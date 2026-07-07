/**
 * Shared API response types.
 *
 * Use these to ensure consistent typing across all API routes and client-side fetches.
 *
 * @example
 * ```ts
 * // Server — return type
 * export default defineEventHandler(async (): Promise<ApiResponse<{ user: User }>> => {
 *   return { success: true, data: { user } }
 * })
 *
 * // Client — fetch type
 * const { data } = await $fetch<ApiResponse<{ user: User }>>('/api/users/me')
 * ```
 */

/** Standard successful API response */
export interface ApiResponse<T = unknown> {
  data: T
  success: true
}

/** Standard error API response */
export interface ApiError {
  error: {
    code: string
    details?: Record<string, string[]>
    message: string
  }
  success: false
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  data: {
    items: T[]
    page: number
    perPage: number
    total: number
    totalPages: number
  }
  success: true
}

/** Union type for any API response */
export type ApiResult<T = unknown> = ApiResponse<T> | ApiError

/** Common pagination query parameters */
export interface PaginationQuery {
  order?: 'asc' | 'desc'
  page?: number
  perPage?: number
  sort?: string
}

/** Common filter + search query parameters */
export interface SearchQuery extends PaginationQuery {
  filter?: Record<string, string>
  q?: string
}
