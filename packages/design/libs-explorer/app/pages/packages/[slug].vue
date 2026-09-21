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

const install = `pnpm add ${entry.name}@${entry.version}`
const registry = '@narduk-enterprises:registry=https://npm.pkg.github.com'
const imports = entry.exports
  .filter((subpath) => !subpath.includes('*') && !subpath.endsWith('.json'))
  .map((subpath) => {
    const specifier = subpath === '.' ? entry.name : `${entry.name}/${subpath.slice(2)}`
    if (subpath.endsWith('.css')) return `@import '${specifier}';`
    if (subpath === './nuxt' || subpath === './module') return `modules: ['${specifier}']`
    return `import … from '${specifier}'`
  })
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
        <dd class="font-mono text-sm">{{ entry.version }}</dd>
      </div>
      <div>
        <dt class="text-xs text-muted uppercase">Published</dt>
        <dd class="text-sm">
          {{ entry.private ? 'No — private workspace tool' : 'GitHub Packages' }}
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

    <section v-if="!entry.private" class="space-y-3">
      <NeSectionHeader
        title="Install"
        description="Packages publish to GitHub Packages. Reading them needs a token with read:packages in the consumer's .npmrc."
      />
      <CodeSnippet :code="registry" label=".npmrc registry line" />
      <CodeSnippet :code="install" label="install command" />
    </section>

    <section v-if="imports.length" class="space-y-3">
      <NeSectionHeader title="Entry points" :count="imports.length" />
      <CodeSnippet :code="imports.join('\n')" label="imports" />
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
