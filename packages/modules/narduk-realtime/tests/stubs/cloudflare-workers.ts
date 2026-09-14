/**
 * Minimal Node stand-in for the workerd-provided `cloudflare:workers` module.
 *
 * Only the shape `HibernatingDurableObject` actually relies on is reproduced:
 * a constructor that stores `ctx` and `env`. Types still come from
 * `@cloudflare/workers-types`; this file exists purely so the import resolves
 * under Node during unit tests (aliased in vitest.config.ts).
 */
export class DurableObject<Env = unknown> {
  protected ctx: DurableObjectState
  protected env: Env

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx
    this.env = env
  }
}
