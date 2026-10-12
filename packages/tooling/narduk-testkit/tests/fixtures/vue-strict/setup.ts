import { installVueStrict } from '../../../src/vue-strict'

// `FIXTURE_ENTRY=default` runs the shipped zero-config entry instead.
if (process.env.FIXTURE_ENTRY === 'default') {
  await import('../../../src/vue-strict-setup')
} else {
  installVueStrict({
    stubNames: process.env.FIXTURE_STUB_KIT ? ['KitTile'] : [],
    ui: process.env.FIXTURE_NO_UI ? false : true,
  })
}
