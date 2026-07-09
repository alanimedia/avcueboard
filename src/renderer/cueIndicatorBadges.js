import { getRetriggerBadgePresentation } from './retriggerBehaviorCatalog.js';
import { resolveEffectiveRetriggerBehavior } from './retriggerBehaviorUtils.js';
import { updateTrimBadgeEl } from './cueTrimBadgeUtils.js';

export const LOOP_BADGE_GLYPH = '∞';

function ensureTrimBadgeInStrip(strip, loopBadge) {
    let trimBadge = strip.querySelector('.cue-trim-badge');
    if (!trimBadge) {
        trimBadge = document.createElement('span');
        trimBadge.className = 'cue-trim-badge';
        trimBadge.setAttribute('aria-hidden', 'true');
        if (loopBadge?.parentElement === strip) {
            loopBadge.insertAdjacentElement('afterend', trimBadge);
        } else {
            strip.appendChild(trimBadge);
        }
    }
    return trimBadge;
}

export function ensureCueIndicatorStrip(hostEl) {
    if (!hostEl) return null;
    let strip = hostEl.querySelector(':scope > .cue-indicator-strip');
    if (!strip) {
        strip = document.createElement('div');
        strip.className = 'cue-indicator-strip';

        const retriggerIcon = document.createElement('span');
        retriggerIcon.className = 'cue-retrigger-icon';

        const loopBadge = document.createElement('span');
        loopBadge.className = 'cue-loop-badge';
        loopBadge.textContent = LOOP_BADGE_GLYPH;
        loopBadge.title = 'Loop enabled';

        strip.appendChild(retriggerIcon);
        strip.appendChild(loopBadge);
        ensureTrimBadgeInStrip(strip, loopBadge);
        hostEl.insertBefore(strip, hostEl.firstChild);
    }

    const loopBadge = strip.querySelector('.cue-loop-badge');
    const trimBadge = ensureTrimBadgeInStrip(strip, loopBadge);

    return {
        strip,
        retriggerIcon: strip.querySelector('.cue-retrigger-icon'),
        loopBadge,
        trimBadge,
    };
}

export function updateRetriggerBadgeElement(retriggerIcon, behavior, { isOverride = false } = {}) {
    if (!retriggerIcon) return;
    const { label, glyph, image, imageClass } = getRetriggerBadgePresentation(behavior);
    retriggerIcon.title = isOverride ? `${label} (cue override)` : `${label} (app default)`;
    retriggerIcon.classList.remove('icon-image-native');
    if (image) {
        retriggerIcon.classList.add('icon-image');
        if (imageClass) {
            retriggerIcon.classList.add(imageClass);
        }
        retriggerIcon.style.backgroundImage = `url(${image})`;
        retriggerIcon.textContent = '';
    } else {
        retriggerIcon.classList.remove('icon-image');
        retriggerIcon.style.backgroundImage = 'none';
        retriggerIcon.textContent = glyph;
    }
    retriggerIcon.classList.add('visible');
}

export function updateCueIndicatorStrip(hostEl, cue, appConfig = {}) {
    const refs = ensureCueIndicatorStrip(hostEl);
    if (!refs || !cue) return refs;

    const behavior = resolveEffectiveRetriggerBehavior(cue, appConfig);
    const isOverride = cue.retriggerBehavior != null && cue.retriggerBehavior !== '';
    updateRetriggerBadgeElement(refs.retriggerIcon, behavior, { isOverride });
    refs.strip.title = `Retrigger while playing: ${getRetriggerBadgePresentation(behavior).label}`;

    if (refs.loopBadge) {
        refs.loopBadge.classList.toggle('visible', !!cue.loop);
    }

    updateTrimBadgeEl(refs.trimBadge, cue);

    return refs;
}

export { updateTrimBadgeEl } from './cueTrimBadgeUtils.js';
