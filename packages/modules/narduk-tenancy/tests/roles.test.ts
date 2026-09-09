import { describe, expect, it } from 'vitest'

import {
  isTenancyRole,
  narrowerRole,
  roleAtLeast,
  roleRank,
  TENANCY_ROLES,
} from '../shared/utils/roles'

describe('tenancy role vocabulary', () => {
  it('orders roles from most to least privileged', () => {
    expect([...TENANCY_ROLES]).toEqual(['owner', 'admin', 'operator', 'crew', 'viewer'])
    const ranks = TENANCY_ROLES.map((role) => roleRank(role))
    expect(ranks).toEqual([...ranks].sort((left, right) => right - left))
  })

  it('never models support as a role (ADR-0010)', () => {
    expect(TENANCY_ROLES).not.toContain('support')
    expect(isTenancyRole('support')).toBe(false)
  })

  it('compares roles by privilege, not by name', () => {
    expect(roleAtLeast('owner', 'viewer')).toBe(true)
    expect(roleAtLeast('admin', 'admin')).toBe(true)
    expect(roleAtLeast('crew', 'operator')).toBe(false)
    expect(roleAtLeast('viewer', 'owner')).toBe(false)
  })

  it('narrows to the less privileged of two roles', () => {
    expect(narrowerRole('owner', 'crew')).toBe('crew')
    expect(narrowerRole('viewer', 'admin')).toBe('viewer')
    expect(narrowerRole('operator', 'operator')).toBe('operator')
  })

  it('recognises only the published vocabulary', () => {
    expect(isTenancyRole('owner')).toBe(true)
    expect(isTenancyRole('OWNER')).toBe(false)
    expect(isTenancyRole(undefined)).toBe(false)
  })
})
