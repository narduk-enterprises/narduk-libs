type Formatter = (value: unknown) => string

function stringify(value: unknown): string {
  return String(value ?? '')
}

export const colors: Record<string, Formatter> = new Proxy<Record<string, Formatter>>(
  {},
  {
    get: () => stringify,
  },
)

export function getColor(): Formatter {
  return stringify
}

export function colorize(_color: string, value: unknown): string {
  return stringify(value)
}

export function stripAnsi(value: unknown): string {
  return stringify(value)
}

export function centerAlign(value: unknown): string {
  return stringify(value)
}

export function leftAlign(value: unknown): string {
  return stringify(value)
}

export function rightAlign(value: unknown): string {
  return stringify(value)
}

export function align(_alignment: string, value: unknown): string {
  return stringify(value)
}

export function box(value: unknown): string {
  return stringify(value)
}
