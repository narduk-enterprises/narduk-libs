import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { githubPackagesDependabot } from '../src/dependabot-registry.js'
import {
  applySchedule,
  hasScheduleSlot,
  overrideComment,
  readScheduleOverride,
  scheduleFor,
} from '../src/dependabot-schedule.js'
import { createNardukApp, upgradeNardukApp } from '../src/index.js'

const names = Array.from({ length: 170 }, (_, index) => 'sample-app-' + index)
const NIGHT_DAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'])
const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return (hours ?? 0) * 60 + (minutes ?? 0)
}

describe('scheduleFor', () => {
  it('is deterministic', () => {
    for (const name of names) expect(scheduleFor(name)).toEqual(scheduleFor(name))
    expect(scheduleFor('riverstatus')).toEqual(scheduleFor('riverstatus'))
  })

  it('stays inside 22:00-05:45 on 15-minute steps, on Mon-Fri nights', () => {
    for (const name of names) {
      const { day, time } = scheduleFor(name)
      const minutes = minutesOf(time)
      expect(minutes % 15).toBe(0)
      const evening = minutes >= 22 * 60
      expect(evening || minutes <= 5 * 60 + 45).toBe(true)
      expect(NIGHT_DAYS.has(day)).toBe(true)
      // A night after Friday evening spills onto Saturday, never Sunday.
      if (!evening) expect(day).not.toBe('monday')
      if (evening) expect(day).not.toBe('saturday')
    }
  })

  it('spreads 170 names so no slot holds more than 3%', () => {
    const counts = new Map<string, number>()
    for (const name of names) {
      const { day, time } = scheduleFor(name)
      counts.set(day + ' ' + time, (counts.get(day + ' ' + time) ?? 0) + 1)
    }
    expect(Math.max(...counts.values()) / names.length).toBeLessThanOrEqual(0.03)
    expect(counts.size).toBeGreaterThan(80)
  })
})

describe('schedule override', () => {
  it('reads an explicit slot and ignores a malformed one', () => {
    const slot = { day: 'friday', time: '23:30' }
    expect(readScheduleOverride(overrideComment(slot) + '\nversion: 2\n')).toEqual(slot)
    expect(readScheduleOverride('# narduk:dependabot-schedule day=funday time=23:30')).toBeNull()
    expect(readScheduleOverride('# narduk:dependabot-schedule day=friday time=25:00')).toBeNull()
    expect(readScheduleOverride('version: 2\n')).toBeNull()
  })

  it('applies a slot to every schedule block and keeps the comment', () => {
    const slot = { day: 'friday', time: '23:30' }
    const text = applySchedule(githubPackagesDependabot('demo-app'), slot, slot)
    expect(text.startsWith(overrideComment(slot))).toBe(true)
    expect(text.match(/day: 'friday'/gu)).toHaveLength(2)
    expect(text.match(/time: '23:30'/gu)).toHaveLength(2)
    expect(hasScheduleSlot(text, slot)).toBe(true)
    expect(hasScheduleSlot(text, scheduleFor('demo-app'))).toBe(false)
  })
})

describe('generated and upgraded Dependabot files', () => {
  async function scaffold(name: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'create-narduk-schedule-'))
    directories.push(root)
    const targetDir = join(root, name)
    await mkdir(targetDir)
    await createNardukApp({ name, targetDir } as Parameters<typeof createNardukApp>[0])
    return targetDir
  }

  it('writes the app slot, never 06:00 Monday', async () => {
    const targetDir = await scaffold('quiet-app')
    const text = await readFile(join(targetDir, '.github/dependabot.yml'), 'utf8')
    const { day, time } = scheduleFor('quiet-app')
    expect(text.match(new RegExp("day: '" + day + "'", 'gu'))).toHaveLength(2)
    expect(text.match(new RegExp("time: '" + time + "'", 'gu'))).toHaveLength(2)
    expect(text).not.toContain("time: '06:00'")
  })

  it('upgrade moves an old 06:00 file to the slot and keeps an explicit override', async () => {
    const targetDir = await scaffold('quiet-app')
    const path = join(targetDir, '.github/dependabot.yml')
    const generated = await readFile(path, 'utf8')
    const slot = scheduleFor('quiet-app')

    await writeFile(
      path,
      generated
        .replaceAll("day: '" + slot.day + "'", "day: 'monday'")
        .replaceAll("time: '" + slot.time + "'", "time: '06:00'"),
      'utf8',
    )
    await upgradeNardukApp({ targetDir, only: ['.github/dependabot.yml'], write: true })
    expect(await readFile(path, 'utf8')).toBe(generated)

    const override = { day: 'thursday', time: '01:15' }
    await writeFile(path, applySchedule(generated, override, override), 'utf8')
    const report = await upgradeNardukApp({
      targetDir,
      only: ['.github/dependabot.yml'],
      write: true,
    })
    expect(report.changes.find((c) => c.path === '.github/dependabot.yml')?.status).toBe('clean')
    expect(await readFile(path, 'utf8')).toContain("time: '01:15'")

    // A rewrite for another drift (cooldown removed) still keeps the override.
    await writeFile(
      path,
      applySchedule(generated, override, override).replace(
        / {4}cooldown:[\s\S]*?(?= {4}groups:)/u,
        '',
      ),
      'utf8',
    )
    await upgradeNardukApp({ targetDir, only: ['.github/dependabot.yml'], write: true })
    const after = await readFile(path, 'utf8')
    expect(after).toContain(overrideComment(override))
    expect(after).toContain("day: 'thursday'")
    expect(after).toContain('cooldown:')
  })
})
