import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, mkdtemp, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import postcss, { type Container } from 'postcss'
import { parse as parseTemplate, NodeTypes, type TemplateChildNode } from '@vue/compiler-dom'
import { parse as parseVue } from 'vue/compiler-sfc'

// The shell registry is the authority on which cards must exist. It is read
// from source rather than from a built artifact: narduk-shell ships TypeScript
// with no build step, and Node strips the types natively.
import { PENDING_CARDS } from '../../narduk-shell/src/pending-cards.ts'
import { NE_SHELL_COMPONENTS } from '../../narduk-shell/src/registry.ts'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
type Card = { path: string; name: string; group: string; viewport: string; subtitle: string }
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const attributes = (node: Element) =>
  Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]))
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')

function elements(node: Node): Element[] {
  return [
    ...('tagName' in node ? [node] : []),
    ...('childNodes' in node ? node.childNodes.flatMap(elements) : []),
  ]
}

function document(title: string, body: string, prefix: string) {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="${prefix}tokens.css"><link rel="stylesheet" href="${prefix}styles.css"></head><body><main class="gallery">${body}</main></body></html>\n`
}

/** Coded custom properties that belong on the extracted token sheet. */
export function isCodedToken(property: string) {
  return property.startsWith('--ns-') || property.startsWith('--ne-')
}

/** Retain selectors, media queries and cascade layers around the token declarations. */
export function splitStyles(css: string) {
  const styles = postcss.parse(css)
  const tokens = styles.clone()
  styles.walkDecls((declaration) => {
    if (isCodedToken(declaration.prop)) declaration.remove()
  })
  tokens.walkDecls((declaration) => {
    if (!isCodedToken(declaration.prop)) declaration.remove()
  })
  tokens.walkComments((comment) => {
    comment.remove()
  })
  function prune(container: Container) {
    container.each((node) => {
      if ('nodes' in node && node.nodes) {
        prune(node as Container)
        if (!node.nodes.length && !(node.type === 'atrule' && node.name === 'layer')) node.remove()
      } else if (container === tokens && node.type === 'atrule' && node.name !== 'layer')
        node.remove()
    })
  }
  prune(tokens)
  prune(styles)
  return { tokens: tokens.toString(), styles: styles.toString() }
}

/** Component coverage comes from Vue tags inside each authored gallery section. */
export function galleryCoverage(source: string): Record<string, string[]> {
  const { descriptor, errors } = parseVue(source)
  if (errors.length || !descriptor.template) throw new Error('Invalid Vue gallery')
  const result: Record<string, string[]> = {}
  function visit(nodes: TemplateChildNode[], owner?: Set<string>) {
    for (const node of nodes) {
      if (node.type !== NodeTypes.ELEMENT) continue
      const marker = node.props.find(
        (prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'data-design-card',
      )
      let components = owner
      if (marker?.type === NodeTypes.ATTRIBUTE) {
        const id = marker.value?.content
        if (!id || result[id] || owner) throw new Error('Invalid or nested gallery card')
        components = new Set<string>()
        result[id] = []
        visit(node.children, components)
        result[id] = [...components].sort()
        continue
      }
      if (/^(?:Ne|Ns|U)[A-Z]/.test(node.tag)) components?.add(node.tag)
      visit(node.children, components)
    }
  }
  visit(parseTemplate(descriptor.template.content).children)
  return result
}

/** `NeStatePanel` -> `ne-state-panel`: the id that component's card declares. */
export function kebabCase(name: string) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

const CARD_TEMPLATE = 'packages/design/narduk-shell/src/design-cards/template/NeExample.card.vue'

/**
 * Pair narduk-shell's component registry with the card files found beside its
 * components. Both directions are errors: a registered component with no card
 * is the done-when this item exists to enforce, and a card with no registration
 * is a card NE Base would show for something no app can use.
 */
export function shellCardPlan(
  components: readonly { name: string }[],
  cardFiles: readonly string[],
  pendingCards: readonly string[] = PENDING_CARDS,
): { name: string; file: string; id: string }[] {
  const found = new Set(cardFiles)
  const pending = new Set(pendingCards)
  const plan = components.map(({ name }) => ({
    name,
    file: `${name}.card.vue`,
    id: kebabCase(name),
  }))
  const missing = plan.filter((card) => !found.has(card.file) && !pending.has(card.name))
  if (missing.length > 0) {
    throw new Error(
      `Registered components with no design card: ${missing.map((card) => card.name).join(', ')}. ` +
        `Copy ${CARD_TEMPLATE} to src/design-cards/<Name>.card.vue.`,
    )
  }
  const expected = new Set(plan.map((card) => card.file))
  const orphans = cardFiles.filter((file) => !expected.has(file))
  if (orphans.length > 0) {
    throw new Error(
      `Design cards with no registered component: ${orphans.join(', ')}. ` +
        'Add the entry to packages/design/narduk-shell/src/registry.ts, or delete the card.',
    )
  }
  // Pending names without a card are omitted so `build()` does not try to read them.
  return plan.filter((card) => found.has(card.file))
}

/**
 * Card coverage across every source that authors a card: this package's
 * gallery, plus one file per narduk-shell component. Card ids are global to the
 * rendered gallery, so a collision between two sources is an error here rather
 * than a silently dropped card downstream.
 */
export function mergeCoverage(sources: Record<string, string>): Record<string, string[]> {
  const merged: Record<string, string[]> = {}
  const owners: Record<string, string> = {}
  for (const [label, source] of Object.entries(sources)) {
    for (const [id, components] of Object.entries(galleryCoverage(source))) {
      if (owners[id])
        throw new Error(`Duplicate design card id "${id}" in ${owners[id]} and ${label}`)
      owners[id] = label
      merged[id] = components
    }
  }
  return merged
}

export const NO_SHELL_NOTE = 'narduk-shell is not yet available in the coded library.'

/** Only the controlled, prerendered Vue gallery supplies markup. No canvas input. */
export function renderBundle(html: string, css: string, note: string = NO_SHELL_NOTE) {
  // The lookahead must run before the optional quote is consumed: with
  // `['"]?` first, a quoted `url("data:...")` still matched, because the
  // engine backtracked to zero quotes and then asserted the lookahead
  // against the quote character itself -- which is never "data:", so it
  // trivially passed and the whole call was (wrongly) flagged as external.
  // Nuxt Icon's mask-image CSS (`--svg:url("data:image/svg+xml,...")`),
  // first exercised once NePageHeader/NeSectionHeader's cards render real
  // breadcrumbs with a separator icon, is exactly this shape:
  // self-contained, but quoted (narduk-libs#282 PR review).
  if (!css.trim() || /@import\s|url\(\s*(?!['"]?data:)/i.test(css)) {
    throw new Error(
      'The compiled stylesheet must be self-contained, with no external assets or imports',
    )
  }
  const nodes = elements(parse(html))
  const sections = nodes.filter((node) => attributes(node)['data-design-card'])
  if (sections.length === 0) throw new Error('No prerendered design cards found')
  const split = splitStyles(css)
  const files: Record<string, string> = { 'tokens.css': split.tokens, 'styles.css': split.styles }
  const cards: Card[] = []
  const bodies: string[] = []
  for (const section of sections) {
    const attrs = attributes(section)
    const id = attrs['data-design-card']!
    if (!/^[a-z0-9-]+$/.test(id) || !attrs['data-name'] || !attrs['data-group'])
      throw new Error('Invalid card metadata')
    const path = `cards/${id}.html`
    if (files[path]) throw new Error(`Duplicate card: ${id}`)
    for (const child of elements(section)) {
      if (
        ['script', 'iframe', 'object', 'embed'].includes(child.tagName) ||
        child.attrs.some(
          ({ name, value }) =>
            name.startsWith('on') ||
            (['src', 'srcset', 'href'].includes(name) && !value.startsWith('#')),
        )
      ) {
        throw new Error(`Card contains executable or external content: ${id}`)
      }
    }
    const card = {
      path,
      name: attrs['data-name'],
      group: attrs['data-group'],
      viewport: '1000x700',
      subtitle: 'Rendered from coded Vue fixtures',
    }
    const body = serializeOuter(section)
    files[path] =
      `<!-- @dsCard group="${escape(card.group)}" name="${escape(card.name)}" subtitle="${escape(card.subtitle)}" viewport="${card.viewport}" -->\n${document(card.name, body, '../')}`
    cards.push(card)
    bodies.push(body)
  }
  files['index.html'] = document(
    'NE Base — coded system preview',
    `<header><h1>NE Base preview</h1><p>Fixed demonstration fixtures rendered from Vue. ${escape(note)}</p></header>` +
      bodies.join('\n'),
    '',
  )
  files['_ds_manifest.json'] = json({
    namespace: 'Narduk_NE_Base',
    components: [],
    startingPoints: [],
    cards,
    templates: [],
    globalCssPaths: ['tokens.css', 'styles.css'],
    hasThumbnailHtml: false,
  })
  return { files, cards }
}

async function sourceFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const groups = await Promise.all(
    entries
      .filter(
        (entry) => !entry.name.startsWith('.') && !['node_modules', 'dist'].includes(entry.name),
      )
      .map(async (entry) => {
        const path = join(prefix, entry.name)
        return entry.isDirectory()
          ? sourceFiles(root, path)
          : /\.(vue|ts|mts|css|json)$/.test(path)
            ? [path]
            : []
      }),
  )
  return groups.flat().sort()
}

export async function build() {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url))
  const publicRoot = join(packageRoot, '.output/public')
  const html = await readFile(join(publicRoot, 'index.html'), 'utf8')
  const nodes = elements(parse(html))
  const styles = nodes
    .filter((node) => node.tagName === 'link' && attributes(node).rel === 'stylesheet')
    .map((node) => attributes(node).href!)
  if (!styles.length) throw new Error('Nuxt produced no stylesheet links')
  const css = (
    await Promise.all(
      styles.map(async (href) => {
        if (!/^\/_nuxt\/[a-zA-Z0-9_.-]+\.css$/.test(href))
          throw new Error(`Unexpected stylesheet path: ${href}`)
        return readFile(join(publicRoot, href.slice(1)), 'utf8')
      }),
    )
  ).join('\n')
  // Inline SSR component styles participate in the same generated stylesheet.
  const inline = nodes
    .filter((node) => node.tagName === 'style')
    .map((node) => node.childNodes.map((child) => ('value' in child ? child.value : '')).join(''))
    .join('\n')
  // Cards come from two places now: this package's hand-authored gallery, and
  // one file per registered narduk-shell component, shipped beside it.
  const shellRoot = fileURLToPath(new URL('../../narduk-shell', import.meta.url))
  const cardDirectory = join(shellRoot, 'src/design-cards')
  const cardFiles = (await readdir(cardDirectory).catch(() => []))
    .filter((entry) => entry.endsWith('.card.vue'))
    .sort()
  const plan = shellCardPlan(NE_SHELL_COMPONENTS, cardFiles)
  const cardSources = Object.fromEntries(
    await Promise.all(
      plan.map(
        async (card) =>
          [
            `narduk-shell/src/design-cards/${card.file}`,
            await readFile(join(cardDirectory, card.file), 'utf8'),
          ] as const,
      ),
    ),
  )
  const componentsByCard = mergeCoverage({
    'design-system-build/app/app.vue': await readFile(join(packageRoot, 'app/app.vue'), 'utf8'),
    ...cardSources,
  })
  // Cards, not registry entries, decide the note: a registered component whose
  // card is still on the PENDING_CARDS allowlist is a reviewed waiver, not a
  // missing component -- the same exemption `shellCardPlan`'s own `missing`
  // check already grants (`!pending.has(card.name)`, above). Without this
  // filter a name that is genuinely pending (no file yet, but allowlisted)
  // would pass `shellCardPlan` while still failing `check-package.mts`'s
  // `coverage.missing` assertion: the waiver satisfying one gate and
  // tripping the other (narduk-libs#282 PR review).
  const pendingCardNames = new Set(PENDING_CARDS)
  const cardless = NE_SHELL_COMPONENTS.map((entry) => entry.name).filter(
    (name) => !plan.some((card) => card.name === name) && !pendingCardNames.has(name),
  )
  const shellNote =
    NE_SHELL_COMPONENTS.length === 0
      ? NO_SHELL_NOTE
      : plan.length === 0
        ? `narduk-shell registers ${NE_SHELL_COMPONENTS.length} component(s); their design cards have not shipped yet.`
        : `narduk-shell contributes ${plan.length} card(s), each shipped beside its component.`
  const { files, cards } = renderBundle(html, `${css}\n${inline}\n`, shellNote)
  const renderedIds = cards.map((card) => card.path.slice('cards/'.length, -'.html'.length)).sort()
  // This is also the proof that the discovery glob in app.vue really rendered
  // every shipped card: an authored card absent from the prerendered output
  // fails here rather than quietly not reaching NE Base.
  if (json(Object.keys(componentsByCard).sort()) !== json(renderedIds))
    throw new Error('Authored gallery and rendered cards differ')
  const components = [...new Set(Object.values(componentsByCard).flat())].sort()
  const require = createRequire(import.meta.url)
  const uiRoot = dirname(require.resolve('@narduk-enterprises/narduk-ui/tokens.css'))
  // `shellRoot` (resolved above for the cards) is the same directory
  // `@narduk-enterprises/narduk-shell/theme.css` resolves to.
  const [uiPackage, shellPackage, nuxtUiPackage] = await Promise.all([
    readFile(join(uiRoot, 'package.json'), 'utf8'),
    readFile(join(shellRoot, 'package.json'), 'utf8'),
    readFile(
      resolve(dirname(fileURLToPath(import.meta.resolve('@nuxt/ui'))), '../package.json'),
      'utf8',
    ),
  ])
  const sources: Record<string, string> = {}
  const groups = [
    { root: uiRoot, label: 'narduk-ui' },
    // narduk-shell is hashed whole (theme.css at its root, the registry and
    // the cards under src) alongside narduk-ui: all of it determines part of
    // the output, so a bundle whose provenance omitted any would be unverifiable.
    { root: shellRoot, label: 'narduk-shell' },
    { root: packageRoot, label: 'design-system-build' },
  ]
  for (const group of groups) {
    const paths = await sourceFiles(group.root)
    const rows = await Promise.all(
      paths.map(
        async (path) =>
          [group.label + '/' + path, hash(await readFile(join(group.root, path)))] as const,
      ),
    )
    for (const [path, sha256] of rows) sources[path] = sha256
  }
  sources['pnpm-lock.yaml'] = hash(await readFile(resolve(packageRoot, '../../../pnpm-lock.yaml')))
  files['build-manifest.json'] = json({
    schemaVersion: 1,
    kind: 'narduk-coded-design-system',
    packages: {
      'narduk-ui': JSON.parse(uiPackage).version,
      'narduk-shell': JSON.parse(shellPackage).version,
      '@nuxt/ui': JSON.parse(nuxtUiPackage).version,
    },
    coverage: {
      cards: cards.length,
      componentsByCard,
      instruments: components.filter((name) => name.startsWith('Ns')),
      nuxtUi: components.filter((name) => name.startsWith('U')),
      shell: components.filter((name) => name.startsWith('Ne')),
      shellCards: plan.map((card) => card.id),
      appScope: null,
      missing:
        NE_SHELL_COMPONENTS.length === 0
          ? ['narduk-shell (registered component registry is empty)']
          : cardless.map((name) => `narduk-shell/${name} (registered, design card pending)`),
      scope:
        'shared instruments, the narduk-shell NE token layer, explicitly configured Nuxt UI baseline fixtures, and one card per registered narduk-shell component shipped beside it; app-specific variants and legacy NE Base templates are not included',
    },
    sources,
    files: Object.entries(files).map(([path, data]) => ({
      path,
      bytes: Buffer.byteLength(data),
      sha256: hash(data),
    })),
  })
  const parent = join(packageRoot, 'dist')
  const target = join(parent, 'design-system')
  await mkdir(parent, { recursive: true })
  const targetStat = await lstat(target).catch(() => null)
  if (targetStat) {
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory())
      throw new Error('Refusing to replace non-directory output')
    const old = JSON.parse(await readFile(join(target, 'build-manifest.json'), 'utf8'))
    if (old.kind !== 'narduk-coded-design-system')
      throw new Error('Refusing to replace output not owned by this renderer')
  }
  const temporary = await mkdtemp(join(parent, '.design-system-'))
  try {
    await Promise.all(
      Object.entries(files).map(async ([path, data]) => {
        await mkdir(dirname(join(temporary, path)), { recursive: true })
        await writeFile(join(temporary, path), data)
      }),
    )
    await rm(target, { recursive: true, force: true })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
  console.log(`Built ${cards.length} coded preview cards: ${target}`)
  console.log(
    NE_SHELL_COMPONENTS.length === 0
      ? 'Coverage gap: narduk-shell registers no components yet; existing NE Base templates are preserved separately.'
      : plan.length === 0
        ? `Coverage gap: narduk-shell registers ${NE_SHELL_COMPONENTS.length} component(s) (${cardless.join(', ')}) with no design card yet; existing NE Base templates are preserved separately.`
        : `narduk-shell contributed ${plan.length} card(s) from src/design-cards${cardless.length ? ` (card pending: ${cardless.join(', ')})` : ''}; existing NE Base templates are preserved separately.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await build()
