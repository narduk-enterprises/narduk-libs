/** Local shapes for the accessibility tests, mirroring the module's own. */
export interface AxeViolationLike {
  help?: string
  helpUrl?: string
  id: string
  impact?: string | null
  nodes: Array<{ target: string[] }>
}

export interface AxeResults {
  violations: AxeViolationLike[]
}
