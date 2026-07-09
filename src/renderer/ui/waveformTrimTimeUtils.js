/** Shared trim/in-out time helpers for waveform editors and playback displays. */

const TRIM_EPSILON = 0.01;

export function resolveTrimBounds(trimStartTime, trimEndTime, fileDuration) {
    const duration = Math.max(0, fileDuration || 0);
    const trimStart = Math.max(0, trimStartTime || 0);
    const trimEnd = (trimEndTime != null && trimEndTime > trimStart)
        ? Math.min(trimEndTime, duration || trimEndTime)
        : duration;
    return { trimStart, trimEnd, fileDuration: duration };
}

export function hasActiveTrim(trimStartTime, trimEndTime, fileDuration) {
    const { trimStart, trimEnd, fileDuration: duration } = resolveTrimBounds(trimStartTime, trimEndTime, fileDuration);
    if (!duration) return trimStart > TRIM_EPSILON;
    return trimStart > TRIM_EPSILON || trimEnd < duration - TRIM_EPSILON;
}

export function getTrimmedDuration(trimStartTime, trimEndTime, fileDuration) {
    const { trimStart, trimEnd } = resolveTrimBounds(trimStartTime, trimEndTime, fileDuration);
    return Math.max(0, trimEnd - trimStart);
}

export function rawTimeToTrimRelative(rawTime, trimStartTime) {
    return Math.max(0, (rawTime || 0) - (trimStartTime || 0));
}

/** Convert region edge times to persisted cue trim fields. */
export function trimTimesForPersist(regionStart, regionEnd, fileDuration) {
    const duration = Math.max(0, fileDuration || 0);
    let trimStart = Math.max(0, regionStart || 0);
    let trimEnd = regionEnd;

    if (duration > 0) {
        if (trimEnd >= duration - TRIM_EPSILON) trimEnd = undefined;
        if (trimStart <= TRIM_EPSILON) trimStart = 0;
    }

    if (!hasActiveTrim(trimStart, trimEnd, duration)) {
        return { trimStartTime: 0, trimEndTime: undefined };
    }

    if (trimEnd != null && trimEnd <= trimStart + TRIM_EPSILON) {
        return { trimStartTime: 0, trimEndTime: undefined };
    }

    return { trimStartTime: trimStart, trimEndTime: trimEnd };
}

export function getTrimDisplayTimes(rawCurrentTime, trimStartTime, trimEndTime, fileDuration) {
    const { trimStart } = resolveTrimBounds(trimStartTime, trimEndTime, fileDuration);
    const total = getTrimmedDuration(trimStartTime, trimEndTime, fileDuration);
    const current = Math.min(total, rawTimeToTrimRelative(rawCurrentTime, trimStart));
    const remaining = Math.max(0, total - current);
    return { current, total, remaining };
}

export function isWaveformRegionTarget(target) {
    if (!target?.closest) return false;
    return !!target.closest('[part*="region"]');
}
