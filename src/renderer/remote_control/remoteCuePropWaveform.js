(function attachRemoteCuePropWaveform(global) {
    const HANDLE_PX = 18;
    const TRIM_EPSILON = 0.01;

    let mountEl = null;
    let canvas = null;
    let ctx = null;
    let cue = null;
    let peaksData = null;
    let duration = 0;
    let trimStart = 0;
    let trimEnd = null;
    let dragging = null;
    let onTrimChange = null;
    let saveTimer = null;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function xToTime(x, width) {
        if (!width || !duration) return 0;
        return clamp((x / width) * duration, 0, duration);
    }

    function timeToX(time, width) {
        if (!duration) return 0;
        return clamp((time / duration) * width, 0, width);
    }

    function getTrimEndValue() {
        if (trimEnd != null && trimEnd > trimStart + TRIM_EPSILON) {
            return Math.min(trimEnd, duration || trimEnd);
        }
        return duration;
    }

    function draw() {
        if (!ctx || !canvas || !peaksData) return;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;

        const dpr = window.devicePixelRatio || 1;
        const pixelW = Math.floor(width * dpr);
        const pixelH = Math.floor(height * dpr);
        if (canvas.width !== pixelW || canvas.height !== pixelH) {
            canvas.width = pixelW;
            canvas.height = pixelH;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const fullDuration = peaksData.duration || duration || 0;
        const end = getTrimEndValue();
        const trimStartRatio = fullDuration > 0 ? trimStart / fullDuration : 0;
        const trimEndRatio = fullDuration > 0 ? end / fullDuration : 1;
        const peaks = peaksData.peaks || [];
        const midY = height / 2;
        const barWidth = Math.max(1, width / Math.max(1, peaks.length));

        for (let i = 0; i < peaks.length; i += 1) {
            const x = (i / peaks.length) * width;
            const ratio = i / peaks.length;
            const amplitude = peaks[i] * (height * 0.42);
            ctx.fillStyle = (ratio < trimStartRatio || ratio > trimEndRatio)
                ? 'rgba(120, 120, 120, 0.55)'
                : 'rgba(79, 70, 229, 0.85)';
            ctx.fillRect(x, midY - amplitude, Math.max(1, barWidth), amplitude * 2);
        }

        const inX = timeToX(trimStart, width);
        const outX = timeToX(end, width);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        if (inX > 0) ctx.fillRect(0, 0, inX, height);
        if (outX < width) ctx.fillRect(outX, 0, width - outX, height);

        ctx.fillStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.fillRect(inX - HANDLE_PX / 2, 0, HANDLE_PX, height);
        ctx.fillRect(outX - HANDLE_PX / 2, 0, HANDLE_PX, height);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(inX - HANDLE_PX / 2 + 0.5, 0.5, HANDLE_PX - 1, height - 1);
        ctx.strokeRect(outX - HANDLE_PX / 2 + 0.5, 0.5, HANDLE_PX - 1, height - 1);

        ctx.fillStyle = '#fcd34d';
        ctx.font = 'bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('{', inX, 6);
        ctx.fillText('}', outX, 6);

        ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
        ctx.fillRect(inX, 0, Math.max(0, outX - inX), height);
    }

    function hitHandle(x, width) {
        const end = getTrimEndValue();
        const inX = timeToX(trimStart, width);
        const outX = timeToX(end, width);
        const hitSlop = HANDLE_PX / 2 + 6;
        if (Math.abs(x - inX) <= hitSlop) return 'in';
        if (Math.abs(x - outX) <= hitSlop) return 'out';
        return null;
    }

    function scheduleSave() {
        if (typeof onTrimChange !== 'function') return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const end = getTrimEndValue();
            const payload = {
                trimStartTime: trimStart <= TRIM_EPSILON ? 0 : trimStart,
                trimEndTime: (end >= duration - TRIM_EPSILON) ? undefined : end,
            };
            if (payload.trimEndTime != null && payload.trimEndTime <= payload.trimStartTime + TRIM_EPSILON) {
                payload.trimEndTime = undefined;
            }
            onTrimChange(payload.trimStartTime, payload.trimEndTime);
        }, 120);
    }

    function onPointerDown(event) {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const handle = hitHandle(x, rect.width);
        if (!handle) return;
        dragging = handle;
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }

    function onPointerMove(event) {
        if (!dragging || !canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const time = xToTime(x, rect.width);
        const minGap = 0.05;

        if (dragging === 'in') {
            trimStart = clamp(time, 0, getTrimEndValue() - minGap);
        } else {
            const nextEnd = clamp(time, trimStart + minGap, duration);
            trimEnd = nextEnd >= duration - TRIM_EPSILON ? null : nextEnd;
        }
        draw();
        event.preventDefault();
    }

    function onPointerUp(event) {
        if (!dragging) return;
        dragging = null;
        canvas?.releasePointerCapture?.(event.pointerId);
        scheduleSave();
        event.preventDefault();
    }

    async function loadPeaks(cueId) {
        const response = await fetch(`/api/cues/${encodeURIComponent(cueId)}/waveform-peaks`);
        if (!response.ok) throw new Error('Failed to load waveform peaks');
        const data = await response.json();
        if (!data?.success || !Array.isArray(data.peaks) || data.peaks.length === 0) {
            throw new Error('Invalid waveform peaks payload');
        }
        return data;
    }

    async function mount(container, cueData, options = {}) {
        destroy();
        if (!container || !cueData?.id || cueData.type === 'playlist' || !cueData.filePath) {
            container?.classList.add('hidden');
            return;
        }

        mountEl = container;
        onTrimChange = options.onTrimChange || null;
        cue = cueData;
        trimStart = cueData.trimStartTime || 0;
        trimEnd = (cueData.trimEndTime != null && cueData.trimEndTime > 0) ? cueData.trimEndTime : null;

        container.classList.remove('hidden');
        container.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'remote-prop-waveform-hint';
        hint.textContent = 'Drag the gold handles to set in and out points — saves automatically.';
        canvas = document.createElement('canvas');
        canvas.className = 'remote-prop-waveform-canvas';
        canvas.style.cursor = 'ew-resize';
        canvas.style.touchAction = 'none';
        container.appendChild(hint);
        container.appendChild(canvas);
        ctx = canvas.getContext('2d');

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);

        try {
            peaksData = await loadPeaks(cueData.id);
            duration = peaksData.duration || cueData.knownDurationS || cueData.knownDuration || 0;
            if (!trimEnd || trimEnd > duration) {
                trimEnd = null;
            }
            draw();
        } catch (error) {
            console.warn('RemoteCuePropWaveform: failed to load peaks', error);
            container.classList.add('hidden');
        }

        if (!container._resizeObserver && typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => draw());
            ro.observe(canvas);
            container._resizeObserver = ro;
        }
    }

    function destroy() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (mountEl?._resizeObserver) {
            mountEl._resizeObserver.disconnect();
            delete mountEl._resizeObserver;
        }
        if (canvas) {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
            canvas.removeEventListener('pointercancel', onPointerUp);
        }
        mountEl = null;
        canvas = null;
        ctx = null;
        cue = null;
        peaksData = null;
        dragging = null;
        onTrimChange = null;
    }

    global.RemoteCuePropWaveform = {
        mount,
        destroy,
    };
})(window);
