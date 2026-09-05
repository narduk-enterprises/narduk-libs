export function resolveLoginSubtitle(
  canUseApple: boolean,
  override?: string,
  canUsePasskey = false,
): string {
  if (override !== undefined) {
    return override
  }

  if (canUseApple) {
    return 'Sign in with Apple first, or use email if you prefer.'
  }

  return canUsePasskey
    ? 'Sign in with a passkey, or use your email and password.'
    : 'Sign in with your email and password.'
}
