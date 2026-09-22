import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Refuse a `--checkout` that cannot be an app checkout.
 *
 * Every foundation check reads the checkout from its root: the root and
 * `apps/web` manifests, `Config/cloudflare-app.json`, the wrangler config. A
 * directory with no `package.json` is not that root. From `apps/web`,
 * `--checkout ..` resolves to `apps/`, and the checks read it without
 * complaint: item 12 reports "no deployment block, not applicable" and exits 0,
 * which is the same output as an app that really has not adopted the standard
 * (narduk-libs#679). So the mistake has to fail here, before any item runs.
 */
export function assertAppCheckout(checkoutDir: string, commandName: string): void {
  if (existsSync(join(checkoutDir, 'package.json'))) return
  throw new Error(
    `${commandName}: --checkout ${checkoutDir} has no package.json, so it is not an app ` +
      'checkout. Point --checkout at the repository root; from apps/web that is ../.. ' +
      '(narduk-libs#679).',
  )
}

/** `flags`, after {@link assertAppCheckout} accepts its `checkoutDir`. */
export function withAppCheckout<Flags extends { checkoutDir: string }>(
  flags: Flags,
  commandName: string,
): Flags {
  assertAppCheckout(flags.checkoutDir, commandName)
  return flags
}
