import { normalizeMapKitLineCoordinates, normalizeMapKitPoint } from './geometry/geometry.js'

import type {
  MapKitLineDrawable,
  MapKitPlaybackLineOptions,
  MapKitPlaybackPoint,
  MapKitPoint,
} from './types.js'

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampMapKitPlaybackProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.max(0, Math.min(1, progress))
}

export function normalizeMapKitPlaybackPoints<TData = unknown>(
  points: ReadonlyArray<MapKitPlaybackPoint<TData> | MapKitPoint> | null | undefined,
): Array<MapKitPlaybackPoint<TData>> {
  if (!Array.isArray(points)) return []

  return points.flatMap((point) => {
    const normalized = normalizeMapKitPoint(point)
    if (!normalized) return []
    const playbackPoint = point as MapKitPlaybackPoint<TData>
    return [
      {
        ...normalized,
        ...(playbackPoint.label ? { label: playbackPoint.label } : {}),
        ...(playbackPoint.timestamp !== undefined ? { timestamp: playbackPoint.timestamp } : {}),
        ...(playbackPoint.data !== undefined ? { data: playbackPoint.data } : {}),
      },
    ]
  })
}

export function clampMapKitPlaybackIndex(index: number, pointCount: number): number {
  if (!Number.isFinite(index) || pointCount <= 0) return 0
  return Math.max(0, Math.min(pointCount - 1, Math.round(index)))
}

export function mapKitPlaybackIndexToProgress(index: number, pointCount: number): number {
  if (pointCount <= 1) return 0
  return clampMapKitPlaybackIndex(index, pointCount) / (pointCount - 1)
}

export function mapKitPlaybackProgressToIndex(progress: number, pointCount: number): number {
  if (pointCount <= 1) return 0
  return clampMapKitPlaybackIndex(
    clampMapKitPlaybackProgress(progress) * (pointCount - 1),
    pointCount,
  )
}

export function buildMapKitPlaybackLineSlices<TData = unknown>(
  points: ReadonlyArray<MapKitPlaybackPoint<TData> | MapKitPoint>,
  index: number,
  options: MapKitPlaybackLineOptions = {},
): MapKitLineDrawable[] {
  const normalized = normalizeMapKitLineCoordinates(points)
  if (normalized.length < 2) return []

  const clampedIndex = clampMapKitPlaybackIndex(index, normalized.length)
  const trailCoordinates = normalized.slice(0, clampedIndex + 1)
  const remainingCoordinates = normalized.slice(clampedIndex)
  const lines: MapKitLineDrawable[] = []

  if (remainingCoordinates.length >= 2) {
    lines.push({
      id: options.remainingLineId ?? 'playback-route-remaining',
      coordinates: remainingCoordinates,
      ...(options.remainingStyle ? { style: options.remainingStyle } : {}),
    })
  }

  if (trailCoordinates.length >= 2) {
    lines.push({
      id: options.trailLineId ?? 'playback-route-trail',
      coordinates: trailCoordinates,
      ...(options.trailStyle ? { style: options.trailStyle } : {}),
    })
  }

  return lines
}

function timestampToMs(value: Date | number | string | null | undefined): number | null {
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : null
  }
  if (isFiniteNumber(value)) return value
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function getMapKitPlaybackDurationMs<TData = unknown>(
  points: ReadonlyArray<MapKitPlaybackPoint<TData>>,
  fallbackDurationMs?: number | null,
): number {
  if (isFiniteNumber(fallbackDurationMs) && fallbackDurationMs > 0) return fallbackDurationMs
  const start = timestampToMs(points[0]?.timestamp)
  const end = timestampToMs(points.at(-1)?.timestamp)
  if (start === null || end === null || end <= start) return 0
  return end - start
}

export function getMapKitPlaybackElapsedMs<TData = unknown>(
  points: ReadonlyArray<MapKitPlaybackPoint<TData>>,
  progress: number,
  fallbackDurationMs?: number | null,
): number {
  const durationMs = getMapKitPlaybackDurationMs(points, fallbackDurationMs)
  if (durationMs <= 0) return 0
  return Math.round(durationMs * clampMapKitPlaybackProgress(progress))
}

export function formatMapKitPlaybackDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
