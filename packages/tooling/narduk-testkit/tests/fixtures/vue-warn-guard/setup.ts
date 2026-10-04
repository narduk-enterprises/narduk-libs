import { installVueWarnGuard } from '../../../src/vue-warn-guard'

installVueWarnGuard({
  allow: process.env.FIXTURE_SUITE_ALLOW
    ? [
        {
          match: /Failed to resolve component: Nope/,
          reason: 'fixture proving a suite-wide allowance',
        },
      ]
    : [],
})
