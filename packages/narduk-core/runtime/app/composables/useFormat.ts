import {
  formatDeterministicDate,
  formatDeterministicDateTime,
} from '../../shared/utils/formatDeterministicDate'

/**
 * Shared formatting utilities for displaying currency, dates, numbers, and percentages.
 * Exported as plain functions for tree-shaking, and aliased in `useFormat()` for composable usage.
 */

const DEFAULT_LOCALE = 'en-US'

export function formatCents(
  cents: number,
  options?: { currency?: string; locale?: string },
): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  const currency = options?.currency ?? 'USD'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

export function formatCurrency(
  amount: number,
  options?: { currency?: string; locale?: string },
): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  const currency = options?.currency ?? 'USD'
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount)
}

export function formatDate(
  date: Date | number | string,
  options?: { dateStyle?: 'short' | 'medium' | 'long' | 'full'; locale?: string },
): string {
  return formatDeterministicDate(date, options)
}

export function formatDateTime(
  date: Date | number | string,
  options?: { locale?: string },
): string {
  return formatDeterministicDateTime(date, options)
}

export function formatRelative(date: Date | number | string, base?: Date): string {
  const locale = DEFAULT_LOCALE
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const timeMs = new Date(date).getTime()
  const baseMs = (base ?? new Date()).getTime()
  const diffMs = timeMs - baseMs

  const diffSec = Math.round(diffMs / 1000)
  const diffMin = Math.round(diffSec / 60)
  const diffHour = Math.round(diffMin / 60)
  const diffDay = Math.round(diffHour / 24)
  const diffMonth = Math.round(diffDay / 30)
  const diffYear = Math.round(diffDay / 365)

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second')
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour')
  if (Math.abs(diffDay) < 30) return rtf.format(diffDay, 'day')
  if (Math.abs(diffMonth) < 12) return rtf.format(diffMonth, 'month')
  return rtf.format(diffYear, 'year')
}

export function formatNumber(
  value: number,
  options?: { locale?: string; maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: options?.minimumFractionDigits,
    maximumFractionDigits: options?.maximumFractionDigits,
  }).format(value)
}

export function formatInteger(value: number, options?: { locale?: string }): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPercent(
  value: number,
  options?: { decimals?: number; locale?: string },
): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  const decimals = options?.decimals ?? 1
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatCompact(value: number, options?: { locale?: string }): string {
  const locale = options?.locale ?? DEFAULT_LOCALE
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
  }).format(value)
}

export default function useFormat() {
  return {
    formatCents,
    formatCurrency,
    formatDate,
    formatDateTime,
    formatRelative,
    formatNumber,
    formatInteger,
    formatPercent,
    formatCompact,
  }
}
