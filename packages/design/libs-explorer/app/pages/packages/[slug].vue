<script setup lang="ts">
import { exampleRoute } from '~/composables/useInventory'

const route = useRoute()
const { examples, packages, source } = useInventory()

const entry = packages.find((candidate) => candidate.slug === route.params.slug)
if (!entry) {
  throw createError({
    statusCode: 404,
    statusMessage: `No package "${route.params.slug}"`,
    fatal: true,
  })
}
const demos = examples.filter((example) => entry.demos?.includes(example.id))
const dependencies = packages.filter((candidate) =>
  entry.workspaceDependencies.includes(candidate.name),
)
const dependents = packages.filter((candidate) =>
  candidate.workspaceDependencies.includes(entry.name),
)

/*
 * Setup is shown as separate, labelled steps, and only what the package README
 * documents (the curated `setup` in inventory/catalog.mts, checked against the
 * package's real exports). Entry points are listed as specifiers: what to
 * import from each is the README's to say, not something to invent here.
 */
const setup = entry.setup ?? {}
const registry = '@narduk-enterprises:registry=https://npm.pkg.github.com'
const install = `pnpm add -E ${entry.name}`
const nuxtConfig = setup.nuxtModule
  ? `// nuxt.config.ts\nexport default defineNuxtConfig({\n  modules: ['${setup.nuxtModule}'],\n})`
  : null
const stylesheet = setup.stylesheet
  ? `/* your app stylesheet */\n@import '${setup.stylesheet}';`
  : null
const binCommands = entry.bin.map((bin) => `pnpm exec ${bin}`)
const workspaceCommands = entry.scripts.map((script) => `pnpm --filter ${entry.name} run ${script}`)
const entryPoints = entry.exports.map((subpath) =>
  subpath === '.' ? entry.name : `${entry.name}/${subpath.slice(2)}`,
)
const sourceUrl = `${source.repository}/tree/${source.commit ?? 'main'}/${entry.directory}`

useSeoMeta({ title: `${entry.slug} — Narduk Libs Explorer`, description: entry.description })
</script>

<template>
  <div v-if="entry" class="space-y-8">
    <NePageHeader
      :eyebrow="`${entry.family} · ${entry.kind}`"
      :title="entry.slug"
      :description="entry.description"
    >
      <template #actions>
        <UButton
          :to="sourceUrl"
          target="_blank"
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-github"
        >
          Source
        </UButton>
      </template>
    </NePageHeader>

    <dl class="grid gap-4 sm:grid-cols-3">
      <div>
        <dt class="text-xs text-muted uppercase">Package</dt>
        <dd class="font-mono text-sm">{{ entry.name }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted uppercase">Workspace version</dt>
        <dd class="text-sm">
          <span class="font-mono" data-testid="workspace-version">{{ entry.version }}</span>
          <span class="block text-xs text-muted">
            The version in this build's source. The registry is not queried, so the latest published
            version is not verified here.
          </span>
        </dd>
      </div>
      <div>
        <dt class="text-xs text-muted uppercase">Distribution</dt>
        <dd class="text-sm" data-testid="distribution">
          {{
            entry.private
              ? 'Not published: a private workspace tool'
              : 'Publishes to GitHub Packages'
          }}
        </dd>
      </div>
    </dl>

    <section class="space-y-3">
      <NeSectionHeader title="Capabilities" />
      <div class="flex flex-wrap gap-2">
        <UBadge
          v-for="capability in entry.capabilities"
          :key="capability"
          color="neutral"
          variant="subtle"
        >
          {{ capability }}
        </UBadge>
      </div>
    </section>

    <section v-if="entry.prerequisites?.length || entry.peerDependencies.length" class="space-y-3">
      <NeSectionHeader title="Prerequisites" />
      <ul class="list-disc space-y-1 pl-5 text-sm">
        <li v-for="line in entry.prerequisites ?? []" :key="line">{{ line }}</li>
        <li v-if="entry.peerDependencies.length">
          Peer dependencies:
          <code class="font-mono">{{ entry.peerDependencies.join(', ') }}</code>
        </li>
      </ul>
    </section>

    <section v-if="!entry.private" class="space-y-4" data-testid="setup">
      <NeSectionHeader
        title="Setup"
        description="Once per app. Packages publish to GitHub Packages; reading them needs a token with read:packages, supplied through your .npmrc or CI environment (never committed)."
      />
      <template v-if="setup.commands?.length">
        <h3 class="text-sm font-medium">Run</h3>
        <CodeSnippet :code="setup.commands.join('\n')" label="command" />
      </template>
      <template v-else>
        <h3 class="text-sm font-medium">1. Registry (.npmrc)</h3>
        <CodeSnippet :code="registry" label=".npmrc registry line" />
        <h3 class="text-sm font-medium">2. Install</h3>
        <CodeSnippet :code="install" label="install command" />
        <p class="text-xs text-muted">
          <code>-E</code> pins the exact version the registry resolves, as the estate requires.
        </p>
        <template v-if="nuxtConfig">
          <h3 class="text-sm font-medium">3. Register the Nuxt module</h3>
          <CodeSnippet :code="nuxtConfig" label="nuxt.config.ts" />
        </template>
        <template v-if="stylesheet">
          <h3 class="text-sm font-medium">{{ nuxtConfig ? '4' : '3' }}. Stylesheet</h3>
          <CodeSnippet :code="stylesheet" label="stylesheet import" />
        </template>
      </template>
      <p v-if="setup.note" class="text-sm text-muted">{{ setup.note }}</p>
      <template v-if="binCommands.length && !setup.commands?.length">
        <h3 class="text-sm font-medium">Commands</h3>
        <CodeSnippet :code="binCommands.join('\n')" label="commands" />
      </template>
    </section>

    <section v-else class="space-y-3" data-testid="workspace-usage">
      <NeSectionHeader
        title="Workspace usage"
        description="Private to narduk-libs: run it from a checkout of the repository, not from an app."
      />
      <CodeSnippet
        v-if="workspaceCommands.length"
        :code="workspaceCommands.join('\n')"
        label="workspace scripts"
      />
      <CodeSnippet v-if="binCommands.length" :code="binCommands.join('\n')" label="commands" />
    </section>

    <section v-if="entryPoints.length" class="space-y-3">
      <NeSectionHeader
        title="Entry points"
        :count="entryPoints.length"
        description="The package's exports map. The README says what each one provides."
      />
      <ul class="space-y-1 font-mono text-sm" data-testid="entry-points">
        <li v-for="specifier in entryPoints" :key="specifier">{{ specifier }}</li>
      </ul>
    </section>

    <section v-if="demos.length" class="space-y-3">
      <NeSectionHeader title="Demos" :count="demos.length" />
      <ul class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="example in demos" :key="example.id">
          <NuxtLink :to="exampleRoute(example.id, example.category)" class="text-sm underline">
            {{ example.title }}
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section v-if="entry.readmeSections.length" class="space-y-3">
      <NeSectionHeader
        title="README sections"
        description="The package README's own table of contents."
      />
      <ul class="columns-1 text-sm sm:columns-2">
        <li v-for="heading in entry.readmeSections" :key="heading">{{ heading }}</li>
      </ul>
    </section>

    <section v-if="dependencies.length || dependents.length" class="grid gap-6 sm:grid-cols-2">
      <div v-if="dependencies.length" class="space-y-2">
        <NeSectionHeader title="Uses" as="h3" />
        <ul class="text-sm">
          <li v-for="dependency in dependencies" :key="dependency.name">
            <NuxtLink :to="`/packages/${dependency.slug}`" class="font-mono underline">{{
              dependency.slug
            }}</NuxtLink>
          </li>
        </ul>
      </div>
      <div v-if="dependents.length" class="space-y-2">
        <NeSectionHeader title="Used by" as="h3" />
        <ul class="text-sm">
          <li v-for="dependent in dependents" :key="dependent.name">
            <NuxtLink :to="`/packages/${dependent.slug}`" class="font-mono underline">{{
              dependent.slug
            }}</NuxtLink>
          </li>
        </ul>
      </div>
    </section>
  </div>
</template>
