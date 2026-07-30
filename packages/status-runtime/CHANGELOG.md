# @narduk-enterprises/status-runtime

## 1.0.0

### Major Changes

- 21551ed: Publish the status shared packages extracted from status-apps into narduk-libs.

  `@narduk-enterprises/narduk-ui` ships the Narduk Status Design System token
  layer, framework-free measurement core, and instruments components.
  `@narduk-enterprises/status-runtime` ships the shared build-time helpers
  (`resolveSourceRevision`, design-system font links and theme color).

  Behavior-preserving extraction: source files match
  `status-apps@cfa14c181b815a84fd6cfb277233d1ade63b5959` byte-for-byte. No runtime
  dependencies. Consumers pin exact published versions from GitHub Packages.
