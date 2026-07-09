/** Trim `{ }` badge helpers for cue cards (playback, edit, remote). */

const TRIM_EPSILON = 0.01;

export function getTrimBadgeSides(trimStartTime, trimEndTime, fileDuration = 0) {
    const duration = Math.max(0, fileDuration || 0);
    const start = Math.max(0, trimStartTime || 0);
    const end = trimEndTime;
    const hasIn = start > TRIM_EPSILON;
    let hasOut = false;
    if (end != null && end > start + TRIM_EPSILON) {
        hasOut = duration > TRIM_EPSILON ? end < duration - TRIM_EPSILON : true;
    }
    return { visible: hasIn || hasOut, hasIn, hasOut };
}

export function getTrimBadgeSidesFromCue(cue) {
    const duration = cue?.knownDuration || cue?.totalDuration || 0;
    return getTrimBadgeSides(cue?.trimStartTime, cue?.trimEndTime, duration);
}

export function renderTrimBadgeMarkup(hasIn, hasOut) {
    const openClass = hasIn ? 'trim-brace trim-brace-in trim-brace-active' : 'trim-brace trim-brace-in';
    const closeClass = hasOut ? 'trim-brace trim-brace-out trim-brace-active' : 'trim-brace trim-brace-out';
    return `<span class="${openClass}">{</span><span class="trim-brace-gap">&nbsp;&nbsp;</span><span class="${closeClass}">}</span>`;
}

export function updateTrimBadgeEl(el, cue) {
    if (!el || !cue) return;
    const { visible, hasIn, hasOut } = getTrimBadgeSidesFromCue(cue);
    el.classList.toggle('visible', visible);
    if (!visible) {
        el.innerHTML = '';
        el.removeAttribute('title');
        return;
    }
    el.innerHTML = renderTrimBadgeMarkup(hasIn, hasOut);
    if (hasIn && hasOut) {
        el.title = 'Trimmed in and out';
    } else if (hasIn) {
        el.title = 'Trimmed in';
    } else {
        el.title = 'Trimmed out';
    }
}

const TRIM_FLASH_MS = 1200;

export function flashTrimBadgeEl(el) {
    if (!el || !el.classList.contains('visible')) return;
    el.classList.remove('trim-badge-saved-flash');
    void el.offsetWidth;
    el.classList.add('trim-badge-saved-flash');
    setTimeout(() => el.classList.remove('trim-badge-saved-flash'), TRIM_FLASH_MS);
}

export function flashTrimBadgeForCue(cueId) {
    if (!cueId) return;
    document.querySelectorAll(
        `.cue-edit-card[data-cue-id="${cueId}"] .cue-trim-badge.visible, #cue-btn-${cueId} .cue-trim-badge.visible`
    ).forEach(flashTrimBadgeEl);
}
