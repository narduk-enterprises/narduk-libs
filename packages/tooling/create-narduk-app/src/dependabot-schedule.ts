import { createHash } from 'node:crypto'

/**
 * Where a repo's weekly Dependabot run lands. Batch work runs 22:00-05:59
 * America/Chicago, staggered (agent-infrastructure docs/standards/CI-RULES.md,
 * entry "2026-11-02, third"); a template that pinned every app to one minute put
 * 129 entries on the same slot.
 *
 * The slot is a pure function of the app name: the same name gives the same day
 * and time in the generator and in `upgrade`, with no registry to keep in step.
 */
export interface DependabotSchedule {
  day: string
  time: string
}

/** Marker for an explicit per-repo slot. `upgrade` keeps it and renders it instead of the hash. */
export const SCHEDULE_OVERRIDE_MARKER = 'narduk:dependabot-schedule'

export const DEPENDABOT_TIMEZONE = 'America/Chicago'

const NIGHT_START_HOUR = 22
const SLOTS_PER_NIGHT = 32 // 22:00, 22:15 ... 05:45
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
/** A night is named for the evening it starts on: Mon-Fri nights. */
const NIGHTS = 5

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The derived slot. Times before midnight keep the night's day; later ones fall on the next calendar day. */
export function scheduleFor(appName: string): DependabotSchedule {
  const digest = createHash('sha256').update(appName).digest()
  const index = digest.readUInt32BE(0) % (NIGHTS * SLOTS_PER_NIGHT)
  const night = Math.floor(index / SLOTS_PER_NIGHT)
  const slot = index % SLOTS_PER_NIGHT
  const minutes = NIGHT_START_HOUR * 60 + slot * 15
  const wrapped = minutes >= 24 * 60
  const clock = wrapped ? minutes - 24 * 60 : minutes
  return {
    day: WEEKDAYS[night + (wrapped ? 1 : 0)] ?? 'monday',
    time: pad(Math.floor(clock / 60)) + ':' + pad(clock % 60),
  }
}

const OVERRIDE_PATTERN = new RegExp(
  '^[ \\t]*#[ \\t]*' +
    SCHEDULE_OVERRIDE_MARKER +
    '[ \\t]+day=([a-z]+)[ \\t]+time=(\\d{2}:\\d{2})[ \\t]*$',
  'mu',
)

/** The explicit per-repo slot written in a file's comment, or null. A malformed or out-of-range one is ignored. */
export function readScheduleOverride(contents: string): DependabotSchedule | null {
  const match = OVERRIDE_PATTERN.exec(contents)
  const day = match?.[1]
  const time = match?.[2]
  if (!day || !time || !WEEKDAYS.includes(day)) return null
  const [hours, minutes] = time.split(':').map(Number)
  if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) return null
  return { day, time }
}

export function overrideComment(schedule: DependabotSchedule): string {
  return '# ' + SCHEDULE_OVERRIDE_MARKER + ' day=' + schedule.day + ' time=' + schedule.time
}

/** Day and time lines of a schedule block, in the indentation the templates use. */
export function scheduleLines(schedule: DependabotSchedule): string[] {
  return [
    "      day: '" + schedule.day + "'",
    "      time: '" + schedule.time + "'",
    "      timezone: '" + DEPENDABOT_TIMEZONE + "'",
  ]
}

function unquote(value: string): string {
  return value.trim().replaceAll(/^['"]|['"]$/gu, '')
}

/**
 * Whether every `day:` and `time:` the file sets is the expected slot. A file
 * with no `time:` line is not judged here: Dependabot applies its own default.
 */
export function hasScheduleSlot(contents: string, schedule: DependabotSchedule): boolean {
  for (const line of contents.split('\n')) {
    const match = /^[ \t]*(day|time):(.*)$/u.exec(line)
    if (!match) continue
    const value = unquote((match[2] ?? '').split('#')[0] ?? '')
    if (value !== schedule[match[1] as 'day' | 'time']) return false
  }
  return true
}

/** Put a schedule on a generated Dependabot file, adding the override comment when one is explicit. */
export function applySchedule(
  contents: string,
  schedule: DependabotSchedule,
  override: DependabotSchedule | null,
): string {
  const lines = contents.split('\n').map((line) => {
    if (/^[ \t]+day:/u.test(line)) return scheduleLines(schedule)[0] ?? line
    if (/^[ \t]+time:/u.test(line)) return scheduleLines(schedule)[1] ?? line
    return line
  })
  return (override ? [overrideComment(override), ...lines] : lines).join('\n')
}
