type DeterministicDateStyle = 'short' | 'medium' | 'long' | 'full'

interface DateFormatOptions {
  dateStyle?: DeterministicDateStyle
  locale?: string
}

function parseDateInput(date: Date | number | string): Date {
  return date instanceof Date ? date : new Date(date)
}

export function formatDeterministicDate(
  date: Date | number | string,
  options: DateFormatOptions = {},
): string {
  const parsed = parseDateInput(date)
  const locale = options.locale ?? 'en-US'
  const dateStyle = options.dateStyle ?? 'medium'

  return new Intl.DateTimeFormat(locale, {
    dateStyle,
    timeZone: 'UTC',
  }).format(parsed)
}

export function formatDeterministicDateTime(
  date: Date | number | string,
  options: Pick<DateFormatOptions, 'locale'> = {},
): string {
  const parsed = parseDateInput(date)
  const locale = options.locale ?? 'en-US'

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(parsed)
}
