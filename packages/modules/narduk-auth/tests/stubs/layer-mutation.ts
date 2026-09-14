interface MutationOptions {
  parseBody?: (input: unknown) => unknown
  rateLimit?: unknown
}

type MutationHandler = (context: never) => unknown

function capture(options: MutationOptions, handler: MutationHandler) {
  return { __handler: handler, __options: options }
}

export const defineAdminMutation = capture
export const definePublicMutation = capture
export const defineUserMutation = capture

export function requireMutationBody<T>(body: T | null | undefined): T {
  if (body === null || body === undefined) {
    throw new Error('missing mutation body')
  }
  return body
}

export function withValidatedBody<T>(parse: (input: unknown) => T) {
  return parse
}
