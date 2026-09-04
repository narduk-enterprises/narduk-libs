import type {
  AppleGesture,
  AppleJourney,
  AppleLanding,
  Audience,
  Catalog,
  DrivenAppleJourney,
  Journey,
  Profile,
  Scenario,
  Sequence,
  Story,
  XcTestAppleJourney,
} from './types.js'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Load-time validation, the second gate after the types (§2.2). Collects
 * every problem before throwing so a malformed catalog reports completely,
 * and a catalog that loads is one the runner can trust structurally.
 */
export function defineCatalog(catalog: Catalog): Catalog {
  const problems: string[] = []
  const note = (problem: string): void => {
    problems.push(problem)
  }

  const scenarioIds = new Set<string>()
  for (const scenario of catalog.scenarios) {
    if (!KEBAB.test(scenario.id)) note(`scenario "${scenario.id}": id must be kebab-case`)
    if (scenarioIds.has(scenario.id)) note(`scenario "${scenario.id}": duplicate id`)
    scenarioIds.add(scenario.id)
    if (!scenario.name.trim()) note(`scenario "${scenario.id}": name is empty`)
    if (!scenario.blurb.trim()) note(`scenario "${scenario.id}": blurb is empty`)
  }
  if (catalog.scenarios.length === 0) note('catalog declares no scenarios')

  if (Object.keys(catalog.profiles).length === 0) note('catalog declares no profiles')
  for (const [name, profile] of Object.entries(catalog.profiles)) {
    if (!KEBAB.test(name)) note(`profile "${name}": name must be kebab-case`)
    if (profile.kind === 'web') {
      if (profile.viewport.width <= 0 || profile.viewport.height <= 0) {
        note(`profile "${name}": viewport must be positive`)
      }
    } else if (!profile.device.trim()) {
      note(`profile "${name}": device is empty`)
    }
  }

  const journeyIds = new Set<string>()
  for (const journey of catalog.journeys) {
    const where = `journey "${journey.id}"`
    if (!KEBAB.test(journey.id)) note(`${where}: id must be kebab-case`)
    if (journeyIds.has(journey.id)) note(`${where}: duplicate id`)
    journeyIds.add(journey.id)
    if (!journey.title.trim()) note(`${where}: title is empty`)
    if (!journey.outcome.trim()) note(`${where}: outcome is empty`)

    if (journey.scenarios.length === 0) note(`${where}: declares no scenarios`)
    for (const scenarioId of journey.scenarios) {
      if (!scenarioIds.has(scenarioId)) note(`${where}: unknown scenario "${scenarioId}"`)
    }

    const audienceEntry = catalog.audience[journey.role]
    if (!audienceEntry) {
      note(`${where}: unknown role "${journey.role}"`)
    } else if (journey.surface !== 'web' && audienceEntry.credentialClass === 'secret') {
      // §13.8: no approved secret channel exists on Apple surfaces yet, so
      // this fails at load. An error, not a warning.
      note(`${where}: secret-class role "${journey.role}" on an Apple surface is not supported`)
    }

    if (journey.steps.length === 0) note(`${where}: declares no steps`)
    const stepIds = new Set<string>()
    for (const step of journey.steps) {
      const stepWhere = `${where} step "${step.id}"`
      if (!KEBAB.test(step.id)) note(`${stepWhere}: id must be kebab-case`)
      if (stepIds.has(step.id)) note(`${stepWhere}: duplicate id`)
      stepIds.add(step.id)
      if (!step.say.trim()) note(`${stepWhere}: say is empty`)
      if (step.skipWhen) {
        if (journey.scenarios.length < 2) {
          // §2.2: with one fixed scenario the field could never vary.
          note(`${stepWhere}: skipWhen on a single-scenario journey is dead weight`)
        }
        if (step.skipWhen.scenarios.length === 0) {
          note(`${stepWhere}: skipWhen names no scenarios`)
        }
        for (const scenarioId of step.skipWhen.scenarios) {
          if (!journey.scenarios.includes(scenarioId)) {
            note(
              `${stepWhere}: skipWhen names "${scenarioId}", not a scenario this journey declares`,
            )
          }
        }
        if (journey.scenarios.every((id) => step.skipWhen?.scenarios.includes(id))) {
          note(`${stepWhere}: skipWhen skips every declared scenario, so the step never runs`)
        }
      }
    }

    for (const compromise of journey.compromises ?? []) {
      if (!compromise.what.trim() || !compromise.why.trim() || !compromise.cost.trim()) {
        // A compromise with no stated cost is the ad-hoc flag under a new name.
        note(`${where}: a declared compromise must state what, why AND what it costs`)
      }
    }

    if (journey.surface !== 'web') {
      const apple = journey as AppleJourney
      if (apple.drive === 'driven') {
        validateDrivenJourney(apple, catalog, note)
      } else {
        const binding = (apple as XcTestAppleJourney).binding
        for (const field of ['xcTarget', 'xcClass', 'xcMethod'] as const) {
          if (!binding?.[field]?.trim()) note(`${where}: binding.${field} is empty`)
        }
      }
    }
  }

  for (const story of catalog.stories ?? []) {
    for (const journeyId of story.journeys) {
      if (!journeyIds.has(journeyId)) note(`story "${story.id}": unknown journey "${journeyId}"`)
    }
  }

  for (const sequence of catalog.sequences ?? []) {
    const where = `sequence "${sequence.id}"`
    if (!scenarioIds.has(sequence.scenario)) {
      note(`${where}: unknown scenario "${sequence.scenario}"`)
    }
    for (const journeyId of sequence.journeys) {
      const journey = catalog.journeys.find((candidate) => candidate.id === journeyId)
      if (!journey) {
        note(`${where}: unknown journey "${journeyId}"`)
        continue
      }
      if (journey.surface !== sequence.surface) {
        note(
          `${where}: journey "${journeyId}" is ${journey.surface}, sequence is ${sequence.surface}`,
        )
      }
      if (!journey.scenarios.includes(sequence.scenario)) {
        note(`${where}: journey "${journeyId}" does not declare scenario "${sequence.scenario}"`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`invalid journey catalog:\n- ${problems.join('\n- ')}`)
  }
  return catalog
}

function validateLanding(
  landing: AppleLanding | undefined,
  where: string,
  note: (problem: string) => void,
): void {
  if (!landing) {
    note(`${where}: declares no landing, so nothing could tell a wrong screen from a right one`)
    return
  }
  if (!landing.screen.trim()) note(`${where}: landing names no screen`)
  if (landing.requires.length === 0 || landing.requires.some((value) => !value.trim())) {
    note(`${where}: landing must require at least one non-empty thing to read on screen`)
  }
  for (const forbidden of landing.forbids ?? []) {
    if (landing.requires.includes(forbidden)) {
      note(`${where}: landing both requires and forbids "${forbidden}"`)
    }
  }
}

/**
 * A driven Apple journey's own gate: every beat has a gesture and a landing,
 * and a coordinate that cannot be on the declared handset is rejected here
 * rather than at 2 a.m. on a capture night.
 */
function validateDrivenJourney(
  journey: DrivenAppleJourney,
  catalog: Catalog,
  note: (problem: string) => void,
): void {
  const where = `journey "${journey.id}"`
  validateLanding(journey.start, `${where} start`, note)

  // The point box comes from any apple profile the catalog declares for this
  // surface; a catalog with none simply skips the bounds check.
  const boxes = Object.values(catalog.profiles)
    .filter((profile) => profile.kind === 'apple')
    .map((profile) => profile.points)
    .filter((points): points is { width: number; height: number } => points !== undefined)
  const inside = (x: number, y: number): boolean =>
    boxes.length === 0 || boxes.some((box) => x >= 0 && y >= 0 && x <= box.width && y <= box.height)

  for (const step of journey.steps) {
    const stepWhere = `${where} step "${step.id}"`
    validateLanding(step.lands, `${stepWhere}`, note)
    const gesture: AppleGesture | undefined = step.press
    if (!gesture) {
      note(`${stepWhere}: declares no gesture`)
      continue
    }
    if (gesture.kind === 'tap' && !inside(gesture.x, gesture.y)) {
      note(
        `${stepWhere}: tap ${String(gesture.x)},${String(gesture.y)} is off every declared handset`,
      )
    }
    if (gesture.kind === 'swipe') {
      for (const point of [gesture.from, gesture.to]) {
        if (!inside(point.x, point.y)) {
          note(
            `${stepWhere}: swipe point ${String(point.x)},${String(point.y)} is off every declared handset`,
          )
        }
      }
    }
    if (gesture.kind === 'type' && !gesture.text) {
      note(`${stepWhere}: types nothing`)
    }
  }
}

/** Identity helpers, for declaration-site type inference. */
export const defineScenario = (scenario: Scenario): Scenario => scenario
export const defineJourney = <J extends Journey>(journey: J): J => journey
export const defineAudience = (audience: Audience): Audience => audience
export const defineStory = (story: Story): Story => story
export const defineSequence = (sequence: Sequence): Sequence => sequence
export const defineProfiles = <P extends Record<string, Profile>>(profiles: P): P => profiles
