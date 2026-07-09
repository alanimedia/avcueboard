(function attachRemoteBadgeUtils(global) {
    const LOOP_BADGE_GLYPH = '∞';
    const ICON_BASE = '/assets/icons/';

    const RETRIGGER_PRESENTATION = {
        fade_out_and_stop: { label: 'Fade out and stop', glyph: '◧', image: `${ICON_BASE}fade-out-stop.svg`, imageClass: 'icon-image-native' },
        restart: { label: 'Restart', glyph: '↺', image: `${ICON_BASE}skip-start.png` },
        stop: { label: 'Stop', glyph: '■', image: `${ICON_BASE}stop.png` },
        toggle_pause_play: { label: 'Toggle pause / play', glyph: '⏯', image: `${ICON_BASE}pause.png` },
        do_nothing: { label: 'Do nothing', glyph: '—', image: null },
        play_new_instance: { label: 'Play new instance', glyph: '＋', image: `${ICON_BASE}play.png` },
        replay_current_item: { label: 'Replay current item', glyph: '⟲', image: null },
        play_next_item: { label: 'Play next item', glyph: '⏭', image: `${ICON_BASE}skip-end.png` }
    };

    function getRetriggerBadgePresentation(value) {
        const key = String(value || '').toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
        const meta = RETRIGGER_PRESENTATION[key] || { label: String(value || ''), glyph: 'R', image: null };
        return { label: meta.label, glyph: meta.glyph, image: meta.image, imageClass: meta.imageClass || null };
    }

    function resolveEffectiveRetriggerBehavior(cue, appConfig = {}) {
        if (cue?.effectiveRetriggerBehavior) return cue.effectiveRetriggerBehavior;
        if (cue?.retriggerBehavior != null && cue.retriggerBehavior !== '') return cue.retriggerBehavior;
        return appConfig.defaultRetriggerBehavior || 'restart';
    }

    function getTrimBadgeSides(trimStartTime, trimEndTime, fileDuration = 0) {
        const duration = Math.max(0, fileDuration || 0);
        const start = Math.max(0, trimStartTime || 0);
        const end = trimEndTime;
        const hasIn = start > 0.01;
        let hasOut = false;
        if (end != null && end > start + 0.01) {
            hasOut = duration > 0.01 ? end < duration - 0.01 : true;
        }
        return { visible: hasIn || hasOut, hasIn, hasOut };
    }

    function getTrimBadgeSidesFromCue(cue) {
        const duration = cue?.knownDuration || cue?.totalDuration || 0;
        return getTrimBadgeSides(cue?.trimStartTime, cue?.trimEndTime, duration);
    }

    function renderTrimBadgeMarkup(hasIn, hasOut) {
        const openClass = hasIn ? 'trim-brace trim-brace-in trim-brace-active' : 'trim-brace trim-brace-in';
        const closeClass = hasOut ? 'trim-brace trim-brace-out trim-brace-active' : 'trim-brace trim-brace-out';
        return `<span class="${openClass}">{</span><span class="trim-brace-gap">&nbsp;&nbsp;</span><span class="${closeClass}">}</span>`;
    }

    function updateTrimBadgeEl(el, cue) {
        if (!el || !cue) return;
        const { visible, hasIn, hasOut } = getTrimBadgeSidesFromCue(cue);
        el.classList.toggle('visible', visible);
        if (!visible) {
            el.innerHTML = '';
            el.removeAttribute('title');
            return;
        }
        el.innerHTML = renderTrimBadgeMarkup(hasIn, hasOut);
        if (hasIn && hasOut) el.title = 'Trimmed in and out';
        else if (hasIn) el.title = 'Trimmed in';
        else el.title = 'Trimmed out';
    }

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

    function ensureCueIndicatorStrip(hostEl) {
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

    function updateRetriggerBadgeElement(retriggerIcon, behavior, options = {}) {
        if (!retriggerIcon) return;
        const { label, glyph, image, imageClass } = getRetriggerBadgePresentation(behavior);
        retriggerIcon.title = options.isOverride ? `${label} (cue override)` : `${label} (app default)`;
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

    function updateCueIndicatorStrip(hostEl, cue, appConfig = {}) {
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

    global.RemoteBadgeUtils = {
        LOOP_BADGE_GLYPH,
        ensureCueIndicatorStrip,
        updateCueIndicatorStrip,
        updateTrimBadgeEl,
        getRetriggerBadgePresentation,
        resolveEffectiveRetriggerBehavior
    };
})(window);
