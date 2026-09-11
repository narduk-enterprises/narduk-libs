import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, mkdtemp, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5'
import postcss, { type Container } from 'postcss'
import { parse as parseTemplate, NodeTypes, type TemplateChildNode } from '@vue/compiler-dom'
import { parse as parseVue } from 'vue/compiler-sfc'

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

/** Retain selectors, media queries and cascade layers around the token declarations. */
export function splitStyles(css: string) {
  const styles = postcss.parse(css)
  const tokens = styles.clone()
  styles.walkDecls(/^--ns-/, (declaration) => {
    declaration.remove()
  })
  tokens.walkDecls((declaration) => {
    if (!declaration.prop.startsWith('--ns-')) declaration.remove()
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
      if (/^(?:Ns|U)[A-Z]/.test(node.tag)) components?.add(node.tag)
      visit(node.children, components)
    }
  }
  visit(parseTemplate(descriptor.template.content).children)
  return result
}

/** Only the controlled, prerendered Vue gallery supplies markup. No canvas input. */
export function renderBundle(html: string, css: string) {
  if (!css.trim() || /@import\s|url\(\s*['"]?(?!data:)/i.test(css)) {
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
    '<header><h1>NE Base preview</h1><p>Fixed demonstration fixtures rendered from Vue, themed by the narduk-shell token layer. No narduk-shell component is registered yet.</p></header>' +
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
  const { files, cards } = renderBundle(html, `${css}\n${inline}\n`)
  const componentsByCard = galleryCoverage(await readFile(join(packageRoot, 'app/app.vue'), 'utf8'))
  const renderedIds = cards.map((card) => card.path.slice('cards/'.length, -'.html'.length)).sort()
  if (json(Object.keys(componentsByCard).sort()) !== json(renderedIds))
    throw new Error('Authored gallery and rendered cards differ')
  const components = [...new Set(Object.values(componentsByCard).flat())].sort()
  const require = createRequire(import.meta.url)
  const uiRoot = dirname(require.resolve('@narduk-enterprises/narduk-ui/tokens.css'))
  const [uiPackage, nuxtUiPackage] = await Promise.all([
    readFile(join(uiRoot, 'package.json'), 'utf8'),
    readFile(
      resolve(dirname(fileURLToPath(import.meta.resolve('@nuxt/ui'))), '../package.json'),
      'utf8',
    ),
  ])
  const sources: Record<string, string> = {}
  const groups = [
    { root: uiRoot, label: 'narduk-ui' },
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
      '@nuxt/ui': JSON.parse(nuxtUiPackage).version,
    },
    coverage: {
      cards: cards.length,
      componentsByCard,
      instruments: components.filter((name) => name.startsWith('Ns')),
      nuxtUi: components.filter((name) => name.startsWith('U')),
      appScope: null,
      missing: ['narduk-shell (not yet present in narduk-libs)'],
      scope:
        'shared instruments and explicitly configured Nuxt UI baseline fixtures; app-specific variants and legacy NE Base templates are not included',
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
    'Coverage gap: narduk-shell is not yet present; existing NE Base templates are preserved separately.',
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await build()
