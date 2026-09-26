#!/usr/bin/env node
/**
 * Pending Changesets, and setting them aside for one publish (narduk-libs#1102).
 *
 * A release-PR merge commit can also carry Changesets from PRs that merged
 * after the release PR last refreshed. The Changesets action publishes only
 * when no Changeset is pending, so that commit used to publish nothing while
 * its Release run stayed green. release.yml now sets the pending Changesets
 * aside, lets the action publish the versions main already bumped, and then
 * restores them so the same job can prepare the next release PR.
 *
 *   node scripts/pending-changesets.mjs set-aside <hold-dir>
 *   node scripts/pending-changesets.mjs restore <hold-dir>
 */

import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The pending Changeset files in `directory`: every `.md` but the README. */
export function pendingChangesetNames(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
}

function move(names, from, to) {
  mkdirSync(to, { recursive: true })
  for (const name of names) renameSync(join(from, name), join(to, name))
  return names
}

/** Move every pending Changeset from `changesetDir` into `holdDir`. */
export function setAsidePendingChangesets(changesetDir, holdDir) {
  return move(pendingChangesetNames(changesetDir), changesetDir, holdDir)
}

/** Move every held Changeset back. A name already present is an error, not an overwrite. */
export function restorePendingChangesets(changesetDir, holdDir) {
  const names = pendingChangesetNames(holdDir)
  const present = new Set(readdirSync(changesetDir))
  const clashes = names.filter((name) => present.has(name))
  if (clashes.length > 0) throw new Error(`Changesets already present: ${clashes.join(', ')}`)
  return move(names, holdDir, changesetDir)
}

function main([command, holdDir]) {
  const changesetDir = join(root, '.changeset')
  if (!holdDir || !['set-aside', 'restore'].includes(command))
    throw new Error('Usage: pending-changesets.mjs set-aside|restore <hold-dir>')
  const names =
    command === 'set-aside'
      ? setAsidePendingChangesets(changesetDir, holdDir)
      : restorePendingChangesets(changesetDir, holdDir)
  console.log(
    `${command}: ${names.length} Changeset(s)${names.length ? `: ${names.join(', ')}` : ''}`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2))
