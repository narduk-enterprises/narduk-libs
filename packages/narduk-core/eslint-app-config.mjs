// @ts-check
// Thin re-export of the shared helper published by @narduk-enterprises/eslint-config.
// Downstream apps and workspace layers import this via
// `@narduk-enterprises/narduk-core/eslint-app-config`; keeping
// the subpath export stable here means those imports keep working without edits
// when the upstream helper evolves.
export {
  createAppLintConfig,
  createAppEslintConfig,
  default,
} from '@narduk-enterprises/eslint-config/eslint-app-config'
