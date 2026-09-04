export function resolveLoginSubtitle(canUseApple: boolean, override?: string): string {
  if (override !== undefined) {
    return override
  }

  return canUseApple
    ? 'Sign in with Apple first, or use email if you prefer.'
    : 'Sign in with your email and password.'
}
