/**
 * Button color picker UI for the properties sidebar.
 * Preset swatches, custom color input, recent custom colors, and preview.
 */

import {
    DEFAULT_CUE_BUTTON_COLOR,
    PRESET_BUTTON_COLORS,
    MAX_RECENT_CUSTOM_COLORS,
    normalizeHexColor,
    isDefaultButtonColor,
    isPresetButtonColor,
    addRecentCustomColor,
    normalizeRecentColors,
    isColorInRecentList,
    getContrastTextColors,
} from './buttonColorPresets.js';

let debouncedSaveCueProperties = null;
let getCurrentAppConfig = null;
let saveAppConfiguration = null;
let onButtonColorPreview = null;

let buttonColorUseDefault = true;
let selectedColor = DEFAULT_CUE_BUTTON_COLOR;
let suppressColorInputEvent = false;
let pendingRecentPersist = null;

let previewEl = null;
let customInputEl = null;
let resetBtnEl = null;
let presetsContainerEl = null;
let recentContainerEl = null;

function getEffectiveColor() {
    return buttonColorUseDefault ? DEFAULT_CUE_BUTTON_COLOR : selectedColor;
}

function updatePreview() {
    if (!previewEl) return;
    const color = getEffectiveColor();
    const { primary } = getContrastTextColors(color);
    previewEl.style.backgroundColor = color;
    previewEl.style.color = primary;
    previewEl.title = buttonColorUseDefault
        ? 'Default gray — click to pick a custom color'
        : `${color} — click to pick a custom color`;
    previewEl.dataset.isDefault = buttonColorUseDefault ? 'true' : 'false';
}

function updateCustomInput() {
    if (!customInputEl) return;
    suppressColorInputEvent = true;
    customInputEl.value = buttonColorUseDefault ? DEFAULT_CUE_BUTTON_COLOR : selectedColor;
    suppressColorInputEvent = false;
}

function updateSwatchSelection() {
    const effective = getEffectiveColor();
    document.querySelectorAll('.button-color-swatch').forEach(swatch => {
        const swatchColor = swatch.dataset.color;
        const isSelected = !buttonColorUseDefault && swatchColor === effective;
        swatch.classList.toggle('selected', isSelected);
        swatch.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
}

function getRecentColorsFromConfig() {
    if (!getCurrentAppConfig) return [];
    const config = getCurrentAppConfig();
    return normalizeRecentColors(config.recentButtonColors);
}

async function persistRecentColors(recentColors) {
    if (!saveAppConfiguration) return;
    const normalized = normalizeRecentColors(recentColors);
    await saveAppConfiguration({ recentButtonColors: normalized });
}

function scheduleRecentPersist(color) {
    const normalized = normalizeHexColor(color);
    if (!normalized || isDefaultButtonColor(normalized) || isPresetButtonColor(normalized)) return;
    if (isColorInRecentList(getRecentColorsFromConfig(), normalized)) return;

    pendingRecentPersist = normalized;
}

async function flushRecentPersist() {
    if (!pendingRecentPersist) return;
    const color = pendingRecentPersist;
    pendingRecentPersist = null;
    const updatedRecent = addRecentCustomColor(getRecentColorsFromConfig(), color);
    await persistRecentColors(updatedRecent);
    renderRecentSwatches();
}

function openCustomColorPicker() {
    if (!customInputEl) return;
    if (typeof customInputEl.showPicker === 'function') {
        customInputEl.showPicker();
    } else {
        customInputEl.click();
    }
}

function createSwatch(color, { isEmpty = false, title = '', source = 'recent' } = {}) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'button-color-swatch';
    if (isEmpty) {
        swatch.classList.add('empty');
        swatch.disabled = true;
        swatch.title = 'No recent color';
        swatch.setAttribute('aria-label', 'Empty recent color slot');
        return swatch;
    }
    swatch.dataset.color = color;
    swatch.style.setProperty('background-color', color, 'important');
    swatch.title = title || color;
    swatch.setAttribute('aria-label', `Color ${color}`);
    swatch.addEventListener('click', () => selectColor(color, { source }));
    return swatch;
}

function renderPresetSwatches() {
    if (!presetsContainerEl) return;
    presetsContainerEl.innerHTML = '';
    PRESET_BUTTON_COLORS.forEach(color => {
        presetsContainerEl.appendChild(createSwatch(color, { title: `Preset ${color}`, source: 'preset' }));
    });
}

function renderRecentSwatches() {
    if (!recentContainerEl) return;
    recentContainerEl.innerHTML = '';
    const recent = getRecentColorsFromConfig();
    for (let i = 0; i < MAX_RECENT_CUSTOM_COLORS; i++) {
        const color = recent[i];
        if (color) {
            recentContainerEl.appendChild(createSwatch(color, { title: `Recent ${color}` }));
        } else {
            recentContainerEl.appendChild(createSwatch(null, { isEmpty: true }));
        }
    }
}

async function selectColor(color, { source = 'custom', useDefault = false } = {}) {
    if (useDefault) {
        buttonColorUseDefault = true;
        selectedColor = DEFAULT_CUE_BUTTON_COLOR;
    } else {
        const normalized = normalizeHexColor(color);
        if (!normalized) return;
        buttonColorUseDefault = false;
        selectedColor = normalized;

        // New custom colors are saved when the picker closes
        if (source === 'custom') {
            scheduleRecentPersist(normalized);
        } else if (source === 'recent') {
            const updatedRecent = addRecentCustomColor(getRecentColorsFromConfig(), normalized);
            await persistRecentColors(updatedRecent);
            renderRecentSwatches();
        }
    }

    updatePreview();
    updateCustomInput();
    updateSwatchSelection();

    if (typeof onButtonColorPreview === 'function') {
        onButtonColorPreview(getButtonColorFormState());
    } else if (typeof window.__refreshActiveCueCardAppearance === 'function') {
        window.__refreshActiveCueCardAppearance();
    }

    if (debouncedSaveCueProperties) {
        debouncedSaveCueProperties();
    }
}

function bindEvents() {
    if (previewEl) {
        previewEl.addEventListener('click', openCustomColorPicker);
        previewEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openCustomColorPicker();
            }
        });
    }

    if (customInputEl) {
        customInputEl.addEventListener('input', () => {
            if (suppressColorInputEvent) return;
            selectColor(customInputEl.value, { source: 'custom' });
        });
        customInputEl.addEventListener('change', () => {
            if (suppressColorInputEvent) return;
            selectColor(customInputEl.value, { source: 'custom' });
            flushRecentPersist();
        });
        customInputEl.addEventListener('cancel', () => {
            pendingRecentPersist = null;
        });
    }

    if (resetBtnEl) {
        resetBtnEl.addEventListener('click', () => {
            pendingRecentPersist = null;
            selectColor(DEFAULT_CUE_BUTTON_COLOR, { useDefault: true });
        });
    }
}

export function initButtonColorPicker(saveCallback, appConfigGetter, appConfigSaver, colorPreviewCallback = null) {
    debouncedSaveCueProperties = saveCallback;
    getCurrentAppConfig = appConfigGetter;
    saveAppConfiguration = appConfigSaver;
    onButtonColorPreview = colorPreviewCallback;

    previewEl = document.getElementById('propButtonColorPreview');
    customInputEl = document.getElementById('propButtonColor');
    resetBtnEl = document.getElementById('propButtonColorReset');
    presetsContainerEl = document.getElementById('propButtonColorPresets');
    recentContainerEl = document.getElementById('propButtonColorRecent');

    renderPresetSwatches();
    renderRecentSwatches();
    bindEvents();
}

export function setButtonColorFromCue(cue) {
    pendingRecentPersist = null;
    if (cue && cue.buttonColor) {
        buttonColorUseDefault = false;
        selectedColor = normalizeHexColor(cue.buttonColor) || DEFAULT_CUE_BUTTON_COLOR;
    } else {
        buttonColorUseDefault = true;
        selectedColor = DEFAULT_CUE_BUTTON_COLOR;
    }
    updatePreview();
    updateCustomInput();
    updateSwatchSelection();
}

export function getButtonColorFormState() {
    return {
        useDefault: buttonColorUseDefault,
        color: buttonColorUseDefault ? null : selectedColor,
    };
}

export function setButtonColorUseDefault(useDefault) {
    if (useDefault) {
        buttonColorUseDefault = true;
        selectedColor = DEFAULT_CUE_BUTTON_COLOR;
        updatePreview();
        updateCustomInput();
        updateSwatchSelection();
    }
}

export function refreshRecentSwatches() {
    renderRecentSwatches();
    updateSwatchSelection();
}

export { DEFAULT_CUE_BUTTON_COLOR };
