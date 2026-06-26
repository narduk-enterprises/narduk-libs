import { normalizeMapKitLineCoordinates, normalizeMapKitPoint } from './geometry/geometry.js';
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
export function clampMapKitPlaybackProgress(progress) {
    if (!Number.isFinite(progress))
        return 0;
    return Math.max(0, Math.min(1, progress));
}
export function normalizeMapKitPlaybackPoints(points) {
    if (!Array.isArray(points))
        return [];
    return points.flatMap((point) => {
        const normalized = normalizeMapKitPoint(point);
        if (!normalized)
            return [];
        const playbackPoint = point;
        return [
            {
                ...normalized,
                ...(playbackPoint.label ? { label: playbackPoint.label } : {}),
                ...(playbackPoint.timestamp !== undefined ? { timestamp: playbackPoint.timestamp } : {}),
                ...(playbackPoint.data !== undefined ? { data: playbackPoint.data } : {}),
            },
        ];
    });
}
export function clampMapKitPlaybackIndex(index, pointCount) {
    if (!Number.isFinite(index) || pointCount <= 0)
        return 0;
    return Math.max(0, Math.min(pointCount - 1, Math.round(index)));
}
export function mapKitPlaybackIndexToProgress(index, pointCount) {
    if (pointCount <= 1)
        return 0;
    return clampMapKitPlaybackIndex(index, pointCount) / (pointCount - 1);
}
export function mapKitPlaybackProgressToIndex(progress, pointCount) {
    if (pointCount <= 1)
        return 0;
    return clampMapKitPlaybackIndex(clampMapKitPlaybackProgress(progress) * (pointCount - 1), pointCount);
}
export function buildMapKitPlaybackLineSlices(points, index, options = {}) {
    const normalized = normalizeMapKitLineCoordinates(points);
    if (normalized.length < 2)
        return [];
    const clampedIndex = clampMapKitPlaybackIndex(index, normalized.length);
    const trailCoordinates = normalized.slice(0, clampedIndex + 1);
    const remainingCoordinates = normalized.slice(clampedIndex);
    const lines = [];
    if (remainingCoordinates.length >= 2) {
        lines.push({
            id: options.remainingLineId ?? 'playback-route-remaining',
            coordinates: remainingCoordinates,
            ...(options.remainingStyle ? { style: options.remainingStyle } : {}),
        });
    }
    if (trailCoordinates.length >= 2) {
        lines.push({
            id: options.trailLineId ?? 'playback-route-trail',
            coordinates: trailCoordinates,
            ...(options.trailStyle ? { style: options.trailStyle } : {}),
        });
    }
    return lines;
}
function timestampToMs(value) {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
    }
    if (isFiniteNumber(value))
        return value;
    if (typeof value !== 'string' || value.length === 0)
        return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
export function getMapKitPlaybackDurationMs(points, fallbackDurationMs) {
    if (isFiniteNumber(fallbackDurationMs) && fallbackDurationMs > 0)
        return fallbackDurationMs;
    const start = timestampToMs(points[0]?.timestamp);
    const end = timestampToMs(points.at(-1)?.timestamp);
    if (start === null || end === null || end <= start)
        return 0;
    return end - start;
}
export function getMapKitPlaybackElapsedMs(points, progress, fallbackDurationMs) {
    const durationMs = getMapKitPlaybackDurationMs(points, fallbackDurationMs);
    if (durationMs <= 0)
        return 0;
    return Math.round(durationMs * clampMapKitPlaybackProgress(progress));
}
export function formatMapKitPlaybackDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
//# sourceMappingURL=playback.js.map