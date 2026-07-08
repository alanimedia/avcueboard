import { formatTime } from './utils.js';
import { uiLog } from './uiLogger.js';
import { getContrastTextColors } from './buttonColorPresets.js';
import {
    shouldShowButtonWaveform,
    ensureButtonWaveform,
    updateButtonWaveformPlayhead,
    removeButtonWaveform,
    buildCueForWaveformDraw
} from './cueButtonWaveform.js';
import {
    buildLayoutFromDom,
    createSectionBlock,
    createAddSectionButton,
    persistLayoutFromDom,
    bindSectionCueDragDrop,
    bindSectionBlockDragDrop,
    getActiveDragWrappers,
    insertWrappersBefore,
    insertWrappersAfter
} from './cueGridSections.js';

function getAppConfigForWaveform() {
    return (uiCore && typeof uiCore.getCurrentAppConfig === 'function')
        ? uiCore.getCurrentAppConfig()
        : {};
}

let isInitialized = false;
let cueStore, audioController, dragDrop, uiCore; // Scoped module refs
let cueButtonMap = {}; // To store references to cue button DOM elements
let cueMeterElements = {}; // Stores meter bar elements per cue
let cueMeterLevels = {}; // Stores smoothed meter level per cue
const cueMeterLiveSources = new Set(); // Tracks cues with live analyser-driven meters
let cueBadgeElements = {}; // Stores references to icon elements per cue

const METER_MIN_HEIGHT_PERCENT = 4; // Prevent meter from collapsing completely when active
const METER_SMOOTHING = 0.4; // Smoothing factor for visual stability
const RETRIGGER_ICON_MAP = {
    restart: '↺',
    restart_from_beginning: '↺',
    stop: '■',
    stop_then_start: '■',
    toggle: '⏯',
    toggle_pause: '⏯',
    resume: '▶',
    resume_from_position: '▶'
};
const RETRIGGER_IMAGE_MAP = {
    fade: '../../assets/icons/fade&stop.png',
    fade_out: '../../assets/icons/fade&stop.png',
    fade_out_and_stop: '../../assets/icons/fade&stop.png',
    restart: '../../assets/icons/restart.png',
    restart_from_beginning: '../../assets/icons/restart.png',
    toggle: '../../assets/icons/playpause.png',
    toggle_pause: '../../assets/icons/playpause.png',
    toggle_pause_play: '../../assets/icons/playpause.png',
    stop: '../../assets/icons/stop.png',
    stop_then_start: '../../assets/icons/stop.png',
    do_nothing: '../../assets/icons/donothing.png',
    do_nothing_if_playing: '../../assets/icons/donothing.png',
    play_next_item: '../../assets/icons/skip-end.png',
    replay_current_item: '../../assets/icons/skip-start.png',
    play_new_instance: '../../assets/icons/playnew.png'
};
const DUCK_TRIGGER_ICON_PATH = '../../assets/icons/DUCKING_TRIGGER.png';
const DUCK_ACTIVE_ICON_PATH = '../../assets/icons/DUCKED.png';
let dragOverCueId = null;
let cueGridContainer;
const selectedCueIds = new Set();
let selectionAnchorId = null;
let deleteSelectedCuesBtn = null;
let clearSectionDragOver = null;
let activeDragCueIds = [];

function getOrderedSelectedCueIds(primaryCueId) {
    if (selectedCueIds.size <= 1 || !selectedCueIds.has(primaryCueId)) {
        return [primaryCueId];
    }
    return getVisibleCueOrder().filter(id => selectedCueIds.has(id));
}

function markDragWrappers(cueIds, primaryCueId) {
    cueIds.forEach(id => {
        const button = document.querySelector(`[data-cue-id="${id}"]`);
        const wrapper = button?.closest('.cue-wrapper');
        if (!wrapper) return;
        wrapper.classList.add('dragging-cue-group');
        if (id === primaryCueId) {
            wrapper.classList.add('dragging-cue');
        }
        button?.classList.add('dragging');
    });
}

function clearDragWrappers() {
    document.querySelectorAll('.cue-wrapper.dragging-cue-group').forEach(wrapper => {
        wrapper.classList.remove('dragging-cue-group', 'dragging-cue');
    });
    document.querySelectorAll('.cue-button.dragging').forEach(button => {
        button.classList.remove('dragging');
    });
    activeDragCueIds = [];
}

function applyCueButtonColor(button, buttonColor) {
    if (buttonColor) {
        const { primary, secondary } = getContrastTextColors(buttonColor);
        const useDarkText = primary === '#1a1a1a';
        button.style.setProperty('--cue-custom-bg', buttonColor);
        button.style.setProperty('--cue-custom-fg', primary);
        button.style.setProperty('--cue-custom-fg-secondary', secondary);
        button.dataset.buttonColor = buttonColor;
        button.dataset.darkText = useDarkText ? 'true' : 'false';
        button.classList.add('has-custom-color');
    } else {
        button.style.removeProperty('--cue-custom-bg');
        button.style.removeProperty('--cue-custom-fg');
        button.style.removeProperty('--cue-custom-fg-secondary');
        delete button.dataset.buttonColor;
        delete button.dataset.darkText;
        button.classList.remove('has-custom-color');
    }
}

export function initCueGrid(cs, ac, dd, ui) {
    uiLog.info('CueGrid: Initializing...');
    cueStore = cs;
    audioController = ac;
    dragDrop = dd;
    uiCore = ui;
    cacheDOMElements();
    bindEventListeners();
    isInitialized = true; // Set initialization flag
    uiLog.info('CueGrid: Initialized successfully.');
    // Do not call renderCues() here; let ui.loadAndRenderCues in renderer.js handle the first render.
}

export function setDeleteSelectedButton(button) {
    deleteSelectedCuesBtn = button;
    updateDeleteSelectedButton();
}

function updateDeleteSelectedButton() {
    if (!deleteSelectedCuesBtn) return;
    const count = selectedCueIds.size;
    const inEditMode = uiCore?.isPersistedEditMode?.() ?? (uiCore?.isEditMode?.() ?? false);
    deleteSelectedCuesBtn.disabled = count === 0;
    deleteSelectedCuesBtn.classList.toggle('hidden', !inEditMode);
    deleteSelectedCuesBtn.textContent = count > 0 ? `Delete (${count})` : 'Delete Selected';
    deleteSelectedCuesBtn.title = count > 0
        ? `Delete ${count} selected cue${count === 1 ? '' : 's'} (Delete key)`
        : 'Select cues with the checkbox or Ctrl/Cmd+click, then delete';
}

export function selectAllCues() {
    if (!cueStore) return;
    selectedCueIds.clear();
    cueStore.getAllCues().forEach(cue => selectedCueIds.add(cue.id));
    selectionAnchorId = cueStore.getAllCues()[0]?.id || null;
    applySelectionToDom();
}

function applySelectionToDom() {
    if (!cueGridContainer) return;
    cueGridContainer.querySelectorAll('.cue-wrapper').forEach(wrapper => {
        const button = wrapper.querySelector('.cue-button');
        const cueId = button?.dataset.cueId;
        const isSelected = !!cueId && selectedCueIds.has(cueId);
        wrapper.classList.toggle('cue-selected', isSelected);
        const checkbox = wrapper.querySelector('.cue-select-checkbox');
        if (checkbox) checkbox.checked = isSelected;
    });
    updateDeleteSelectedButton();
}

export function clearCueSelection() {
    selectedCueIds.clear();
    selectionAnchorId = null;
    applySelectionToDom();
}

function getVisibleCueOrder() {
    const ids = [];
    if (!cueGridContainer) return ids;
    cueGridContainer.querySelectorAll('.cue-wrapper .cue-button[data-cue-id]').forEach(button => {
        ids.push(button.dataset.cueId);
    });
    return ids;
}

function toggleCueSelection(cueId) {
    if (selectedCueIds.has(cueId)) {
        selectedCueIds.delete(cueId);
    } else {
        selectedCueIds.add(cueId);
    }
    selectionAnchorId = cueId;
    applySelectionToDom();
}

function setSingleCueSelection(cueId) {
    selectedCueIds.clear();
    selectedCueIds.add(cueId);
    selectionAnchorId = cueId;
    applySelectionToDom();
}

function selectCueRange(fromId, toId) {
    const order = getVisibleCueOrder();
    const startIndex = order.indexOf(fromId);
    const endIndex = order.indexOf(toId);
    if (startIndex === -1 || endIndex === -1) return;
    const [low, high] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
    for (let index = low; index <= high; index += 1) {
        selectedCueIds.add(order[index]);
    }
    selectionAnchorId = toId;
    applySelectionToDom();
}

export async function deleteSelectedCues() {
    if (!cueStore || selectedCueIds.size === 0) return { success: false };

    const ids = [...selectedCueIds];
    const count = ids.length;
    const noun = count === 1 ? 'cue' : 'cues';
    if (!confirm(`Delete ${count} selected ${noun}?`)) {
        return { success: false, cancelled: true };
    }

    if (audioController?.default) {
        ids.forEach(cueId => {
            if (audioController.default.isPlaying?.(cueId)) {
                audioController.default.toggle(cueId, false, 'stop');
            }
        });
    }

    const activePropertiesCueId = document.getElementById('propCueId')?.value;
    const result = await cueStore.deleteCues(ids);
    if (result?.success) {
        clearCueSelection();
        if (activePropertiesCueId && ids.includes(activePropertiesCueId) && uiCore?.hidePropertiesSidebar) {
            uiCore.hidePropertiesSidebar();
        }
    }
    return result;
}

export function handleDeleteSelectedKeydown(event) {
    if (!uiCore?.isPersistedEditMode?.()) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAllCues();
        return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedCueIds.size === 0) return;
        event.preventDefault();
        deleteSelectedCues();
        return;
    }

    if (event.key === 'Escape') {
        clearCueSelection();
    }
}

function cacheDOMElements() {
    cueGridContainer = document.getElementById('cueGridContainer'); 
}

// Track navigation button clicks to prevent rapid clicking
const navigationClickBlocked = new Set();

function bindEventListeners() {
    // Add global event listener for playlist navigation buttons
    if (cueGridContainer) {
        cueGridContainer.addEventListener('click', (event) => {
            if (event.target.classList.contains('playlist-nav-btn')) {
                event.stopPropagation(); // Prevent triggering the cue button click
                event.preventDefault(); // Prevent any default behavior
                
                const cueId = event.target.getAttribute('data-cue-id');
                const buttonType = event.target.classList.contains('playlist-prev-btn') ? 'prev' : 'next';
                const navigationKey = `${cueId}-${buttonType}`;
                
                // Block rapid clicking at the UI level
                if (navigationClickBlocked.has(navigationKey)) {
                    uiLog.debug(`🚫 CueGrid: Navigation click blocked for ${cueId} (${buttonType}) - too rapid`);
                    return;
                }
                
                // Block this navigation for 200ms at UI level
                navigationClickBlocked.add(navigationKey);
                uiLog.debug(`🔒 CueGrid: UI-level block added for ${navigationKey}`);
                setTimeout(() => {
                    navigationClickBlocked.delete(navigationKey);
                    uiLog.debug(`🔓 CueGrid: UI-level block removed for ${navigationKey}`);
                }, 200);
                
                if (event.target.classList.contains('playlist-prev-btn')) {
                    uiLog.debug(`CueGrid: Previous playlist item for cue ${cueId}`);
                    audioController.default.playlistNavigatePrevious(cueId);
                } else if (event.target.classList.contains('playlist-next-btn')) {
                    uiLog.debug(`CueGrid: Next playlist item for cue ${cueId}`);
                    audioController.default.playlistNavigateNext(cueId);
                }
                return;
            }

            if (uiCore?.isPersistedEditMode?.()) {
                if (event.target.closest('.cue-wrapper')) return;
                if (event.target.closest('.cue-section-header')) return;
                if (event.target.closest('.cue-section-add-btn')) return;
                clearCueSelection();
            }
        });

        clearSectionDragOver = bindSectionCueDragDrop(cueGridContainer, {
            canAcceptDrop: () => uiCore?.isPersistedEditMode?.() ?? false,
            onCueDropped: async () => {
                clearDragWrappers();
                await persistLayoutFromDom(cueGridContainer, cueStore);
            }
        });

        bindSectionBlockDragDrop(cueGridContainer, {
            canAcceptDrag: () => uiCore?.isPersistedEditMode?.() ?? false,
            onSectionReordered: async () => {
                await persistLayoutFromDom(cueGridContainer, cueStore);
            }
        });
    }
}

function renderCues() {
    if (!isInitialized) {
        uiLog.warn('renderCues (cueGrid.js) called before initCueGrid has completed. Aborting render.');
        return;
    }
    if (!cueGridContainer || !cueStore || !audioController || !uiCore) {
        uiLog.warn("renderCues (cueGrid.js) called before essential modules are initialized.");
        return;
    }
    cueGridContainer.innerHTML = ''; 
    cueMeterElements = {};
    cueMeterLevels = {};
    cueMeterLiveSources.clear();
    cueBadgeElements = {};
    const cues = cueStore.getAllCues();
    const sections = cueStore.getSections ? cueStore.getSections() : [];
    const layout = cueStore.getLayout ? cueStore.getLayout() : [];
    const validCueIds = new Set(cues.map(cue => cue.id));
    selectedCueIds.forEach(id => {
        if (!validCueIds.has(id)) selectedCueIds.delete(id);
    });
    const isEditModeActive = uiCore?.isPersistedEditMode?.() ?? false;
    const cueMap = new Map(cues.map(cue => [cue.id, cue]));

    function appendCueCard(cue, parentContainer) {
        const cueWrapper = document.createElement('div');
        cueWrapper.className = 'cue-wrapper';

        if (isEditModeActive) {
            const selectCheckbox = document.createElement('input');
            selectCheckbox.type = 'checkbox';
            selectCheckbox.className = 'cue-select-checkbox';
            selectCheckbox.checked = selectedCueIds.has(cue.id);
            selectCheckbox.title = 'Select cue';
            selectCheckbox.addEventListener('click', (event) => event.stopPropagation());
            selectCheckbox.addEventListener('change', (event) => {
                event.stopPropagation();
                if (selectCheckbox.checked) {
                    selectedCueIds.add(cue.id);
                    selectionAnchorId = cue.id;
                } else {
                    selectedCueIds.delete(cue.id);
                }
                applySelectionToDom();
            });
            cueWrapper.appendChild(selectCheckbox);
        }

        const interactiveContainer = document.createElement('div');
        interactiveContainer.className = 'cue-interactive-container';
        
        const button = document.createElement('div');
        button.className = 'cue-button';
        button.id = `cue-btn-${cue.id}`;
        button.dataset.cueId = cue.id;
        button.dataset.cueType = cue.type || 'single';
        applyCueButtonColor(button, cue.buttonColor);

        const statusIndicator = document.createElement('div');
        statusIndicator.className = 'cue-status-indicator';
        statusIndicator.id = `cue-status-${cue.id}`;
        button.appendChild(statusIndicator);

        const loopIcon = document.createElement('img');
        loopIcon.className = 'cue-loop-icon';
        loopIcon.src = '../../assets/icons/loop.png';
        loopIcon.alt = 'Loop';
        button.appendChild(loopIcon);

        const retriggerStrip = document.createElement('div');
        retriggerStrip.className = 'cue-retrigger-strip';
        button.appendChild(retriggerStrip);

        const retriggerIcon = document.createElement('span');
        retriggerIcon.className = 'cue-retrigger-icon';
        retriggerStrip.appendChild(retriggerIcon);

        const duckStrip = document.createElement('div');
        duckStrip.className = 'cue-duck-strip';
        button.appendChild(duckStrip);

        const duckTriggerIcon = document.createElement('img');
        duckTriggerIcon.className = 'cue-duck-icon duck-trigger-icon';
        duckTriggerIcon.src = DUCK_TRIGGER_ICON_PATH;
        duckTriggerIcon.alt = 'Ducking trigger';
        duckStrip.appendChild(duckTriggerIcon);

        const duckActiveIcon = document.createElement('img');
        duckActiveIcon.className = 'cue-duck-icon duck-active-icon';
        duckActiveIcon.src = DUCK_ACTIVE_ICON_PATH;
        duckActiveIcon.alt = 'Ducked';
        duckStrip.appendChild(duckActiveIcon);

        const nameContainer = document.createElement('div');
        nameContainer.className = 'cue-button-name-container';
        button.appendChild(nameContainer);

        const timeContainer = document.createElement('div');
        timeContainer.className = 'cue-time-display-container';

        const timeCurrentElem = document.createElement('span');
        timeCurrentElem.className = 'cue-time-current';
        timeCurrentElem.id = `cue-time-current-${cue.id}`;
        // timeCurrentElem.textContent = ''; // Set by updateCueButtonTime

        const timeSeparator = document.createElement('span');
        timeSeparator.className = 'cue-time-separator';
        timeSeparator.id = `cue-time-separator-${cue.id}`;
        // timeSeparator.textContent = ''; // Set by updateCueButtonTime

        const timeTotalElem = document.createElement('span');
        timeTotalElem.className = 'cue-time-total';
        timeTotalElem.id = `cue-time-total-${cue.id}`;
        // timeTotalElem.textContent = ''; // Set by updateCueButtonTime

        const timeRemainingElem = document.createElement('span');
        timeRemainingElem.className = 'cue-time-remaining';
        timeRemainingElem.id = `cue-time-remaining-${cue.id}`;
        // timeRemainingElem.textContent = ''; // Set by updateCueButtonTime

        timeContainer.appendChild(timeCurrentElem);
        timeContainer.appendChild(timeSeparator);
        timeContainer.appendChild(timeTotalElem);
        timeContainer.appendChild(timeRemainingElem);
        button.appendChild(timeContainer);

        const appConfig = getAppConfigForWaveform();
        if (shouldShowButtonWaveform(cue, appConfig)) {
            ensureButtonWaveform(
                button,
                cue,
                (filePath) => uiCore.getOrGenerateWaveformPeaks(filePath),
                appConfig,
                (cueId, positionSec, options) => audioController?.default?.seek?.(cueId, positionSec, options),
                (cueId) => audioController?.default?.prepareScrubSeek?.(cueId)
            );
        } else {
            removeButtonWaveform(button);
        }

        interactiveContainer.appendChild(button);

        const meterContainer = document.createElement('div');
        meterContainer.className = 'cue-audio-meter-container';
        meterContainer.setAttribute('data-cue-id', cue.id);

        const meterBar = document.createElement('div');
        meterBar.className = 'cue-audio-meter-bar';
        meterBar.id = `cue-meter-${cue.id}`;

        meterContainer.appendChild(meterBar);
        interactiveContainer.appendChild(meterContainer);

        cueMeterElements[cue.id] = meterBar;
        cueMeterLevels[cue.id] = 0;
        cueBadgeElements[cue.id] = {
            loopIcon,
            retriggerStrip,
            retriggerIcon,
            duckStrip,
            duckTriggerIcon,
            duckActiveIcon
        };

        cueWrapper.appendChild(interactiveContainer);
        
        // Add playlist navigation controls OUTSIDE the button for playlist cues
        if (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 1) {
            const playlistNavContainer = document.createElement('div');
            playlistNavContainer.className = 'playlist-nav-container';
            
            const prevButton = document.createElement('button');
            prevButton.className = 'playlist-nav-btn playlist-prev-btn';
            prevButton.innerHTML = '◀';
            prevButton.title = 'Previous item';
            prevButton.setAttribute('data-cue-id', cue.id);
            
            const nextButton = document.createElement('button');
            nextButton.className = 'playlist-nav-btn playlist-next-btn';
            nextButton.innerHTML = '▶';
            nextButton.title = 'Next item';
            nextButton.setAttribute('data-cue-id', cue.id);
            
            playlistNavContainer.appendChild(prevButton);
            playlistNavContainer.appendChild(nextButton);
            
            // Add navigation controls to the wrapper, NOT the button
            cueWrapper.appendChild(playlistNavContainer);
        }
        
        // Append the wrapper to the DOM (contains both button and navigation)
        parentContainer.appendChild(cueWrapper);

        const elementsForTimeUpdate = {
            current: timeCurrentElem,
            separator: timeSeparator,
            total: timeTotalElem,
            remaining: timeRemainingElem
        };

        const isCurrentlyPlaying = audioController.default.isPlaying(cue.id);
        const isCurrentlyCued = audioController.default.isCued(cue.id);
        // Pass the created elements directly for initial setup
        updateButtonPlayingState(cue.id, isCurrentlyPlaying, null, isCurrentlyCued, elementsForTimeUpdate);
        applyCueBadgeState(cue.id);

        button.addEventListener('click', (event) => handleCueButtonClick(event, cue));

        // Drag reordering in persisted edit mode (wrapper-level drag avoids button conflicts)
        if (isEditModeActive) {
            cueWrapper.draggable = true;
            cueWrapper.classList.add('draggable-cue-wrapper');

            cueWrapper.addEventListener('dragstart', (e) => {
                if (!uiCore.isPersistedEditMode?.()) return;
                if (e.target.closest('.cue-select-checkbox, .playlist-nav-btn')) {
                    e.preventDefault();
                    return;
                }
                activeDragCueIds = getOrderedSelectedCueIds(cue.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', cue.id);
                e.dataTransfer.setData('application/x-accompaniment-cue-ids', activeDragCueIds.join(','));
                markDragWrappers(activeDragCueIds, cue.id);
                cueGridContainer.classList.add('drag-active');
            });

            cueWrapper.addEventListener('dragend', () => {
                clearDragWrappers();
                cueGridContainer.classList.remove('drag-active');
                if (typeof clearSectionDragOver === 'function') {
                    clearSectionDragOver();
                }
                document.querySelectorAll('.drag-insert-before, .drag-insert-after').forEach(el => {
                    el.classList.remove('drag-insert-before', 'drag-insert-after');
                });
            });

            cueWrapper.addEventListener('dragover', (e) => {
                if (!uiCore.isPersistedEditMode?.()) return;
                if (cueWrapper.classList.contains('dragging-cue-group')) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';

                const draggedWrappers = getActiveDragWrappers(cueGridContainer);
                if (draggedWrappers.length === 0 || draggedWrappers.includes(cueWrapper)) return;

                document.querySelectorAll('.drag-insert-before, .drag-insert-after').forEach(el => {
                    el.classList.remove('drag-insert-before', 'drag-insert-after');
                });

                const rect = cueWrapper.getBoundingClientRect();
                if (e.clientX < rect.left + rect.width / 2) {
                    cueWrapper.classList.add('drag-insert-before');
                } else {
                    cueWrapper.classList.add('drag-insert-after');
                }
            });

            cueWrapper.addEventListener('dragleave', (e) => {
                const rect = cueWrapper.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;
                if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                    cueWrapper.classList.remove('drag-insert-before', 'drag-insert-after');
                }
            });

            cueWrapper.addEventListener('drop', async (e) => {
                if (!uiCore.isPersistedEditMode?.()) return;
                e.preventDefault();
                e.stopPropagation();

                const draggedWrappers = getActiveDragWrappers(cueGridContainer, e.dataTransfer);
                if (draggedWrappers.length === 0 || draggedWrappers.includes(cueWrapper)) {
                    cueWrapper.classList.remove('drag-insert-before', 'drag-insert-after');
                    return;
                }

                let insertBefore = cueWrapper.classList.contains('drag-insert-before');
                if (!cueWrapper.classList.contains('drag-insert-before') && !cueWrapper.classList.contains('drag-insert-after')) {
                    const rect = cueWrapper.getBoundingClientRect();
                    insertBefore = e.clientX < rect.left + rect.width / 2;
                }

                const dropParent = cueWrapper.parentElement || cueGridContainer;
                if (insertBefore) {
                    insertWrappersBefore(dropParent, draggedWrappers, cueWrapper);
                } else {
                    insertWrappersAfter(dropParent, draggedWrappers, cueWrapper);
                }

                cueWrapper.classList.remove('drag-insert-before', 'drag-insert-after');
                clearDragWrappers();
                await persistLayoutFromDom(cueGridContainer, cueStore);
            });
        }
    }

    const layoutEntries = layout.length > 0
        ? layout
        : (sections.length > 0
            ? [
                { type: 'section', sectionId: sections[0].id },
                ...cues.map(cue => ({ type: 'cue', cueId: cue.id, sectionId: sections[0].id }))
            ]
            : cues.map(cue => ({ type: 'cue', cueId: cue.id })));

    if (sections.length === 0 && cues.length === 0) {
        const emptyStateMessage = document.createElement('div');
        emptyStateMessage.className = 'empty-state-message';
        emptyStateMessage.innerHTML = `
            <div class="empty-state-content">
                <h3>No cues yet</h3>
                <p>Drag and drop audio files here to create cues</p>
            </div>
        `;
        cueGridContainer.appendChild(emptyStateMessage);
        return;
    }

    const sectionBodies = new Map();
    let flatFallbackContainer = null;

    layoutEntries.forEach(entry => {
        if (entry.type === 'section') {
            const section = sections.find(item => item.id === entry.sectionId);
            if (!section) return;
            const block = createSectionBlock(section, {
                isEditMode: isEditModeActive,
                gridContainer: cueGridContainer,
                onToggleCollapse: async (sectionId, collapsed) => {
                    if (cueStore.updateSection) {
                        await cueStore.updateSection(sectionId, { collapsed });
                    }
                },
                onRename: async (sectionId, title) => {
                    if (cueStore.updateSection) {
                        await cueStore.updateSection(sectionId, { title });
                    }
                },
                onDelete: async (sectionId) => {
                    if (sections.length <= 1) return;
                    if (cueStore.deleteSection) {
                        await cueStore.deleteSection(sectionId);
                    }
                }
            });
            cueGridContainer.appendChild(block);
            const body = block.querySelector('.cue-section-body');
            if (body) sectionBodies.set(section.id, body);
            return;
        }
        if (entry.type === 'cue') {
            const cue = cueMap.get(entry.cueId);
            if (!cue) return;
            const body = sectionBodies.get(entry.sectionId) || flatFallbackContainer || cueGridContainer;
            appendCueCard(cue, body);
        }
    });

    if (isEditModeActive) {
        cueGridContainer.appendChild(createAddSectionButton(async () => {
            if (cueStore.addSection) {
                await cueStore.addSection('New Section');
            }
        }));
    }

    if (dragDrop && typeof dragDrop.initializeCueButtonDragDrop === 'function') {
        dragDrop.initializeCueButtonDragDrop(cueGridContainer);
    }

    applySelectionToDom();
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.cue-wrapper:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleCueButtonClick(event, cue) {
    if (!cue) {
        uiLog.error(`UI: Cue not found.`);
        return;
    }
    if (!uiCore || !audioController) {
        uiLog.error("cueGrid.handleCueButtonClick: uiCore or audioController not initialized.");
        return;
    }

    // Persisted edit: properties / multi-select. Shift temporarily switches to show/playback mode.
    if (uiCore.isEditMode()) {
        const isMultiSelect = event.ctrlKey || event.metaKey;

        if (isMultiSelect) {
            event.preventDefault();
            toggleCueSelection(cue.id);
            return;
        }

        setSingleCueSelection(cue.id);
        uiLog.debug(`UI: Edit mode click on cue ${cue.id}. Opening properties.`);
        uiCore.openPropertiesSidebar(cue);
    } else {
        const retriggerBehavior = cue.retriggerBehavior || uiCore.getCurrentAppConfig().defaultRetriggerBehavior || 'restart';
        uiLog.debug(`UI: Show mode action for cue ${cue.id}. Using retrigger behavior: ${retriggerBehavior}`);
        audioController.default.toggle(cue.id, false, retriggerBehavior);
    }
}

function updateButtonPlayingState(cueId, isPlaying, statusTextArg = null, isCuedOverride = false, elements = null) {
    // uiLog.debug(`[CueGrid UpdateButtonPlayingState ENTRY] cueId: ${cueId}, isPlaying(arg): ${isPlaying}, isCuedOverride: ${isCuedOverride}, elements received:`, elements ? typeof elements : 'null', elements);
    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button || !cueStore || !audioController) return;
    const cue = cueStore.getCueById(cueId);
    if (!cue) return;

    const statusIndicator = button.querySelector('.cue-status-indicator');
    const nameContainer = button.querySelector('.cue-button-name-container');
    let nameHTML = ''; // Start with empty and build up
    const mainCueNameSpan = `<span class="cue-button-main-name">${cue.name || 'Cue'}</span>`;
    nameHTML += mainCueNameSpan;

    let statusIconSrc = '../../assets/icons/stop.png';
    let statusIconAlt = 'Stopped';

    // Ensure a text indicator element exists or create it
    let cuedTextIndicator = button.querySelector('.cue-cued-text-indicator');
    if (!cuedTextIndicator) {
        cuedTextIndicator = document.createElement('div');
        cuedTextIndicator.className = 'cue-cued-text-indicator';
        button.insertBefore(cuedTextIndicator, button.firstChild); // Add to top-left
    }
    
    // Ensure instance counter element exists
    let instanceCounter = button.querySelector('.cue-instance-counter');
    if (!instanceCounter) {
        instanceCounter = document.createElement('div');
        instanceCounter.className = 'cue-instance-counter';
        // Style it to be centered just above the time container
        instanceCounter.style.position = 'absolute';
        instanceCounter.style.left = '50%';
        instanceCounter.style.transform = 'translateX(-50%)';
        instanceCounter.style.bottom = '28px'; // Just above the time container
        instanceCounter.style.fontSize = '11px';
        instanceCounter.style.color = 'rgba(255, 255, 255, 0.9)'; // Increased opacity
        instanceCounter.style.fontWeight = 'bold';
        instanceCounter.style.pointerEvents = 'none';
        instanceCounter.style.zIndex = '1000'; // Very high Z-index
        instanceCounter.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
        button.appendChild(instanceCounter);
    }
    instanceCounter.style.display = 'none'; // Default hidden

    button.classList.remove('playing', 'paused', 'cued');
    statusIndicator.style.display = 'block'; // Default to visible
    cuedTextIndicator.style.display = 'none'; // Default to hidden

    // Handle crossfade status text (if provided)
    // Only treat as crossfade text if it contains fade-related keywords
    const isCrossfadeText = statusTextArg && (statusTextArg.includes('Fade Out') || statusTextArg.includes('Fade In') || statusTextArg.includes('Crossfade'));
    
    if (isCrossfadeText) {
        uiLog.debug(`🎵 [CueGrid] Displaying crossfade text: "${statusTextArg}" for cue ${cueId}`);
        
        // Apply crossfade styling directly to the button
        button.classList.add('crossfade-active');
        
        // Change button background for crossfade with !important to override hover
        if (statusTextArg.includes('Fade Out')) {
            button.style.setProperty('background-color', 'rgba(255, 69, 0, 0.8)', 'important'); // Red-orange for fade out
            button.classList.add('crossfade-fade-out');
        } else if (statusTextArg.includes('Fade In')) {
            button.style.setProperty('background-color', 'rgba(255, 165, 0, 0.8)', 'important'); // Orange for fade in
            button.classList.add('crossfade-fade-in');
        }
        
        // Update the name container to show crossfade text prominently
        if (nameContainer) {
            const originalName = cue.name || 'Cue';
            nameHTML = `<span class="cue-button-main-name">${originalName}</span><br><span class="crossfade-timer" style="font-size: 16px; font-weight: bold; color: white;">${statusTextArg}</span>`;
        }
        
        // Hide status indicator during crossfade to make timer more prominent
        statusIndicator.style.display = 'none';
        
        // Apply the updated HTML and continue normal processing for visual states
        if (nameContainer) nameContainer.innerHTML = nameHTML;
        
        // Set button to playing state during crossfade
        button.classList.add('playing');
        
        return; // Don't process normal state logic when showing crossfade
    } else {
        // Clear crossfade styling when no crossfade text
        button.classList.remove('crossfade-active', 'crossfade-fade-out', 'crossfade-fade-in');
        button.style.removeProperty('background-color'); // Reset to default
    }

    // Get comprehensive state from audioController
    const playbackState = audioController.default.getPlaybackTimes(cue.id);

    if (playbackState) {
        const actualIsPlaying = playbackState.isPlaying;
        const actualIsPaused = playbackState.isPaused;
        // isCued can be from playbackState.isCued (which includes isCuedNext) or the override
        const actualIsCued = isCuedOverride || playbackState.isCued;
        const currentItemName = playbackState.currentPlaylistItemName;
        const nextItemName = playbackState.nextPlaylistItemName;
        const instanceCount = playbackState.instanceCount || 1;
        
        // Update instance counter display
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) {
            // Force visibility update based on instance count
            if (instanceCount > 1) {
                instanceCounter.textContent = `x${instanceCount}`;
                instanceCounter.style.display = 'block';
                // Ensure high z-index and proper positioning are enforced
                instanceCounter.style.zIndex = '10000';
                instanceCounter.style.visibility = 'visible';
            } else {
                instanceCounter.style.display = 'none';
            }
        }
        
        let playlistInfoHTML = ''; // Initialize playlistInfoHTML here

        if (actualIsPlaying) {
            button.classList.add('playing');
            statusIconSrc = '../../assets/icons/play.png';
            statusIconAlt = 'Playing';
            if (nameContainer && cue.type === 'playlist') {
                if (currentItemName) {
                    playlistInfoHTML += `<span class="playlist-now-playing">(Now: ${currentItemName})</span>`;
                }
                if (nextItemName) {
                    if (playlistInfoHTML) playlistInfoHTML += '<br>';
                    playlistInfoHTML += `<span class="playlist-next-item-playing">(Next: ${nextItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else if (actualIsCued && !actualIsPlaying) {
            // Prioritize cued state over paused state - this handles playlist items that have ended and are cued for next
            button.classList.add('cued');
            statusIconSrc = '../../assets/icons/pause.png'; // Show pause icon for cued state
            statusIconAlt = 'Cued';
            if (nameContainer && cue.type === 'playlist') {
                if (nextItemName) {
                    playlistInfoHTML += `<span class="next-playlist-item">(Next: ${nextItemName})</span>`;
                } else if (currentItemName) {
                    playlistInfoHTML += `<span class="next-playlist-item">(Cued: ${currentItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else if (actualIsPaused) {
            // Normal paused state (not cued)
            button.classList.add('paused');
            statusIconSrc = '../../assets/icons/pause.png';
            statusIconAlt = 'Paused';
            if (nameContainer && cue.type === 'playlist') {
                if (currentItemName) {
                    playlistInfoHTML += `<span class="playlist-now-playing">(Paused: ${currentItemName})</span>`;
                }
                if (nextItemName) {
                    if (playlistInfoHTML) playlistInfoHTML += '<br>';
                    playlistInfoHTML += `<span class="playlist-next-item-playing">(Next: ${nextItemName})</span>`;
                }
                if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        } else { // Stopped / Idle (and not specifically cued by logic above, e.g. single file cue just stopped)
            // For idle single file cues, playbackState might be null or have isPlaying/isPaused false.
            // If it's a playlist and truly idle (no specific next item from isCued logic), 
            // playbackState.nextPlaylistItemName (first item) should be populated by audioController's fallback.
            if (nameContainer && cue.type === 'playlist' && nextItemName) {
                 playlistInfoHTML += `<span class="next-playlist-item">(Next: ${nextItemName})</span>`;
                 if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            }
        }
        
        // Update nameContainer with constructed HTML for playing states
        if (nameContainer) {
            nameContainer.innerHTML = nameHTML;
        }
    } else {
        // Fallback if playbackState is null (should be rare with new audioController logic but handle defensively)
        // uiLog.warn(`[CueGrid updateButtonPlayingState for ${cue.id}] Playback state was null. Defaulting to stopped state.`);
        
        // CRITICAL FIX: If playbackState is null (stopped), we MUST still check isCuedOverride
        // This handles the case where currentlyPlaying was deleted but we want to show "Cued Next"
        if (isCuedOverride) {
             button.classList.add('cued');
             statusIconSrc = '../../assets/icons/pause.png';
             statusIconAlt = 'Cued';
             
             // We need to apply statusTextArg if present (e.g., "Next: Item 1")
             // statusTextArg is usually passed as the 3rd arg to updateButtonPlayingState
             if (statusTextArg && nameContainer) {
                 // Rebuild nameHTML for cued state
                 let playlistInfoHTML = `<span class="next-playlist-item">(${statusTextArg})</span>`;
                 // Avoid duplicating "Next: Next: ..." if statusTextArg already has it
                 if (statusTextArg.startsWith("Next:")) {
                      playlistInfoHTML = `<span class="next-playlist-item">(${statusTextArg})</span>`;
                 }
                 nameContainer.innerHTML = `${mainCueNameSpan}<br>${playlistInfoHTML}`;
             }
        } else if (nameContainer && cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0) {
            // Basic fallback for idle playlist if everything else failed and NOT overridden
            const firstItemName = cue.playlistItems[0]?.name || 'Item 1';
            let playlistInfoHTML = `<span class="next-playlist-item">(Next: ${firstItemName})</span>`;
            if (playlistInfoHTML) nameHTML += `<br>${playlistInfoHTML}`;
            nameContainer.innerHTML = nameHTML;
        } else if (nameContainer) {
             nameContainer.innerHTML = nameHTML; // Restore original name
        }
    }

    // if (nameContainer) nameContainer.innerHTML = nameHTML; // Logic moved inside blocks to avoid overwrite
    

    applyCueBadgeState(cueId, playbackState);

    // Pass the elements through to updateCueButtonTime
    updateCueButtonTime(cueId, elements); 

    if (statusIndicator.style.display !== 'none') {
        statusIndicator.innerHTML = `<img src="${statusIconSrc}" alt="${statusIconAlt}" class="cue-status-icon">`;
    } else {
        statusIndicator.innerHTML = ''; // Clear if hidden to prevent old icon flash
    }
}

function updateCueButtonTime(cueId, elements = null, isFadingIn = false, isFadingOut = false, fadeTimeRemainingMs = 0) {
    if (!audioController || !cueStore) {
        uiLog.warn(`updateCueButtonTime: audioController or cueStore not ready for cue ${cueId}`);
        return;
    }
    const cueFromStore = cueStore.getCueById(cueId);

    if (!cueFromStore) {
        return;
    }

    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button) {
        return;
    }

    let localElements = elements;
    if (!localElements) {
        localElements = {
            current: button.querySelector(`#cue-time-current-${cueId}`),
            total: button.querySelector(`#cue-time-total-${cueId}`),
            remaining: button.querySelector(`#cue-time-remaining-${cueId}`),
            separator: button.querySelector(`#cue-time-separator-${cueId}`)
        };
    }

    const playbackTimes = audioController.default.getPlaybackTimes(cueId);

    let displayCurrentTimeFormatted = "00:00";
    let displayCurrentTime = 0;
    let displayItemDuration = 0;
    let displayItemDurationFormatted = "00:00";
    let displayItemRemainingTime = 0; 
    let displayItemRemainingTimeFormatted = "";

    if (playbackTimes) {
        displayCurrentTimeFormatted = playbackTimes.currentTimeFormatted || "00:00";
        displayCurrentTime = playbackTimes.currentTime || 0;
        displayItemDuration = playbackTimes.duration || 0;
        displayItemDurationFormatted = playbackTimes.durationFormatted || "00:00";
        
        if (typeof playbackTimes.remainingTime === 'number') {
            displayItemRemainingTime = playbackTimes.remainingTime;
            displayItemRemainingTimeFormatted = playbackTimes.remainingTimeFormatted || formatTimeMMSS(playbackTimes.remainingTime) || "";
        } else if (displayItemDuration > 0 && displayCurrentTime <= displayItemDuration) {
            displayItemRemainingTime = displayItemDuration - displayCurrentTime;
            displayItemRemainingTimeFormatted = formatTimeMMSS(displayItemRemainingTime);
        }

        const instanceCount = playbackTimes.instanceCount || 1;
        
        // Update instance counter display
        // Always re-query to be safe, or use the scoped variable if we trust it (we query by class so it should be fine)
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) {
            if (instanceCount > 1) {
                instanceCounter.textContent = `x${instanceCount}`;
                instanceCounter.style.display = 'block';
            } else {
                instanceCounter.style.display = 'none';
            }
        }
    } else {
        // Explicitly hide counter if no playback state (stopped)
        const instanceCounter = button.querySelector('.cue-instance-counter');
        if (instanceCounter) instanceCounter.style.display = 'none';
        
        uiLog.warn(`[CueGrid UpdateCueButtonTime] cueId: ${cueId}, getPlaybackTimes returned null. Using default display values.`);
    }

    const hasLiveMeter = cueMeterLiveSources.has(cueId);
    if (!hasLiveMeter) {
        const fallbackVolume = cueFromStore && cueFromStore.volume !== undefined ? cueFromStore.volume : 0;
        const meterVolume = playbackTimes && typeof playbackTimes.volume === 'number'
            ? playbackTimes.volume
            : fallbackVolume;
        const meterActive = !!(playbackTimes && (playbackTimes.isPlaying || playbackTimes.isFadingIn || playbackTimes.isFadingOut) || isFadingIn || isFadingOut);
        setCueMeterLevel(cueId, meterActive ? meterVolume : 0, { immediate: !meterActive });
    }

    _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs);
    applyCueBadgeState(cueId, playbackTimes);
}

// New function that uses time data directly from IPC instead of calling audioController.getPlaybackTimes()
function updateCueButtonTimeWithData(cueId, timeData, elements = null, isFadingIn = false, isFadingOut = false, fadeTimeRemainingMs = 0) {
    if (!cueStore) {
        uiLog.warn(`updateCueButtonTimeWithData: cueStore not ready for cue ${cueId}`);
        return;
    }

    const cueFromStore = cueStore.getCueById(cueId);
    if (!cueFromStore) {
        return;
    }

    const button = document.getElementById(`cue-btn-${cueId}`);
    if (!button) {
        return;
    }

    let localElements = elements;
    if (!localElements) {
        localElements = {
            current: button.querySelector(`#cue-time-current-${cueId}`),
            total: button.querySelector(`#cue-time-total-${cueId}`),
            remaining: button.querySelector(`#cue-time-remaining-${cueId}`),
            separator: button.querySelector(`#cue-time-separator-${cueId}`)
        };
    }

    // Use the provided time data directly
    const displayCurrentTimeFormatted = timeData.currentTimeFormatted || "00:00";
    const displayCurrentTime = timeData.currentTime || 0;
    const displayItemDuration = timeData.duration || 0;
    const displayItemDurationFormatted = timeData.durationFormatted || "00:00";
    const displayItemRemainingTime = timeData.remainingTime || 0;
    const displayItemRemainingTimeFormatted = timeData.remainingTimeFormatted || "";

    const hasLiveMeter = cueMeterLiveSources.has(cueId);
    if (!hasLiveMeter) {
        const meterVolume = typeof timeData.volume === 'number' ? timeData.volume : 0;
        const status = timeData.status || '';
        const statusActive = status === 'playing' || status === 'fading';
        const meterActive = statusActive || isFadingIn || isFadingOut;
        setCueMeterLevel(cueId, meterActive ? meterVolume : 0, { immediate: !meterActive });
    }

    _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs);
    applyCueBadgeState(cueId, timeData);

    const appConfig = getAppConfigForWaveform();
    if (shouldShowButtonWaveform(cueFromStore, appConfig)) {
        const drawCue = buildCueForWaveformDraw(cueFromStore, {
            currentTime: displayCurrentTime,
            duration: displayItemDuration
        });
        updateButtonWaveformPlayhead(button, drawCue, appConfig);
    }
}

// Helper function to update the button display (extracted from original updateCueButtonTime)
function _updateButtonTimeDisplay(button, localElements, displayCurrentTimeFormatted, displayCurrentTime, displayItemDuration, displayItemDurationFormatted, displayItemRemainingTime, displayItemRemainingTimeFormatted, isFadingIn, isFadingOut, fadeTimeRemainingMs) {

    if (localElements.current) localElements.current.textContent = displayCurrentTimeFormatted;
    if (localElements.separator) localElements.separator.textContent = (displayCurrentTime > 0 || displayItemDuration > 0) ? ' / ' : '';
    if (localElements.total) {
        localElements.total.textContent = displayItemDurationFormatted;
    }
    if (localElements.remaining) {
        const showRemaining = displayItemRemainingTime > 0 && displayCurrentTime < displayItemDuration;
        localElements.remaining.textContent = showRemaining ? `-${displayItemRemainingTimeFormatted}` : '';
        localElements.remaining.style.display = showRemaining ? 'inline' : 'none';
    }

    const isActuallyFading = (isFadingIn || isFadingOut) && fadeTimeRemainingMs > 0;

    // Clear previous fade-specific classes first
    button.classList.remove('fading', 'fading-in', 'fading-out');

    if (isActuallyFading) {
        button.classList.add('fading');
        // Don't remove playing/paused if it's just starting to fade from that state
        // button.classList.remove('playing', 'paused', 'stopped', 'cued'); 

        if (isFadingOut) {
            button.classList.add('fading-out');
            button.classList.remove('fading-in'); // Ensure only one fade direction class
        } else if (isFadingIn) {
            button.classList.add('fading-in');
            button.classList.remove('fading-out');
        }

        if (localElements.current) localElements.current.textContent = `Fading: ${(fadeTimeRemainingMs / 1000).toFixed(1)}s`;
        if (localElements.separator) localElements.separator.textContent = '';
        if (localElements.total) localElements.total.textContent = '';
        if (localElements.remaining) {
            localElements.remaining.textContent = '';
            localElements.remaining.style.display = 'none';
        }
    } else {
        // Not fading, ensure normal time display
        // Class 'fading', 'fading-in', 'fading-out' are already removed above
        if (localElements.current) localElements.current.textContent = displayCurrentTimeFormatted;
        if (localElements.separator) localElements.separator.textContent = (displayCurrentTime > 0 || displayItemDuration > 0) ? ' / ' : '';
        if (localElements.total) localElements.total.textContent = displayItemDurationFormatted;
        if (localElements.remaining) {
            const showRemaining = displayItemRemainingTime > 0 && displayCurrentTime < displayItemDuration;
            localElements.remaining.textContent = showRemaining ? `-${displayItemRemainingTimeFormatted}` : '';
            localElements.remaining.style.display = showRemaining ? 'inline' : 'none';
        }
    }
}

function applyCueBadgeState(cueId, playbackState = null) {
    if (!cueStore) return;
    const cue = cueStore.getCueById(cueId);
    if (!cue) return;

    const badges = cueBadgeElements[cueId];
    if (!badges) return;

    const loopEnabled = !!cue.loop;
    const isDuckingTrigger = !!cue.isDuckingTrigger;
    const isCurrentlyDucked = !!(playbackState?.isDucked);

    let retriggerBehavior = cue.retriggerBehavior || cue.retriggerAction || cue.retriggerActionCompanion;
    if (!retriggerBehavior && uiCore && typeof uiCore.getCurrentAppConfig === 'function') {
        const config = uiCore.getCurrentAppConfig();
        retriggerBehavior = config?.defaultRetriggerBehavior || config?.defaultRetriggerAction || null;
    }

    if (badges.loopIcon) {
        badges.loopIcon.classList.toggle('enabled', loopEnabled);
    }

    if (badges.retriggerIcon && badges.retriggerStrip) {
        if (retriggerBehavior) {
            const normalized = String(retriggerBehavior).toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
            const imagePath = RETRIGGER_IMAGE_MAP[normalized];
            if (imagePath) {
                badges.retriggerIcon.classList.add('icon-image');
                badges.retriggerIcon.style.backgroundImage = `url(${imagePath})`;
                badges.retriggerIcon.textContent = '';
            } else {
                const glyph = RETRIGGER_ICON_MAP[normalized] || 'R';
                badges.retriggerIcon.classList.remove('icon-image');
                badges.retriggerIcon.style.backgroundImage = 'none';
                badges.retriggerIcon.textContent = glyph;
            }
            badges.retriggerIcon.classList.add('visible');
            badges.retriggerStrip.style.display = 'flex';
        } else {
            badges.retriggerIcon.classList.remove('visible', 'icon-image');
            badges.retriggerIcon.style.backgroundImage = 'none';
            badges.retriggerIcon.textContent = '';
            badges.retriggerStrip.style.display = 'none';
        }
    }

    if (badges.duckTriggerIcon) {
        badges.duckTriggerIcon.classList.toggle('visible', isDuckingTrigger);
        badges.duckTriggerIcon.classList.toggle('active', isDuckingTrigger);
    }

    const enableDucking = !!cue.enableDucking;
    if (badges.duckActiveIcon) {
        const duckIconShouldShow = enableDucking || isCurrentlyDucked;
        badges.duckActiveIcon.classList.toggle('visible', duckIconShouldShow);
        badges.duckActiveIcon.classList.toggle('active', isCurrentlyDucked);
    }

    if (badges.duckStrip) {
        const duckVisible =
            (badges.duckTriggerIcon?.classList.contains('visible') ?? false) ||
            (badges.duckActiveIcon?.classList.contains('visible') ?? false);
        badges.duckStrip.style.display = duckVisible ? 'flex' : 'none';
    }
}

function setCueMeterLevel(cueId, level, { immediate = false } = {}) {
    const meter = cueMeterElements[cueId];
    if (!meter) return;

    const sanitizedLevel = Number.isFinite(level) ? level : 0;
    const clampedLevel = Math.max(0, Math.min(1, sanitizedLevel));
    const previousLevel = cueMeterLevels[cueId] ?? 0;
    const smoothingFactor = immediate ? 1 : METER_SMOOTHING;
    const smoothedLevel = previousLevel + (clampedLevel - previousLevel) * smoothingFactor;
    cueMeterLevels[cueId] = smoothedLevel;

    const percentage = smoothedLevel <= 0 ? 0 : Math.max(METER_MIN_HEIGHT_PERCENT, smoothedLevel * 100);
    meter.style.height = `${percentage}%`;

    const container = meter.parentElement;
    if (container) {
        if (smoothedLevel > 0.02) {
            container.classList.add('cue-audio-meter-active');
        } else {
            container.classList.remove('cue-audio-meter-active');
        }
    }
}

function updateCueMeterLevel(cueId, level, { immediate = false } = {}) {
    cueMeterLiveSources.add(cueId);
    setCueMeterLevel(cueId, level, { immediate });
}

function resetCueMeter(cueId, { immediate = true } = {}) {
    if (cueMeterLiveSources.has(cueId)) {
        cueMeterLiveSources.delete(cueId);
    }
    setCueMeterLevel(cueId, 0, { immediate });
}

function formatTimeMMSS(timeInSeconds) {
    if (isNaN(timeInSeconds) || timeInSeconds < 0) {
        return "00:00";
    }
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateAllCueButtonTimes() {
    if (!isInitialized || !cueStore || !audioController) {
        uiLog.warn('updateAllCueButtonTimes: CueGrid not initialized or dependencies missing');
        return;
    }
    
    const cues = cueStore.getAllCues();
    if (!cues || cues.length === 0) {
        return;
    }
    
    cues.forEach(cue => {
        updateCueButtonTime(cue.id);
    });
}

export {
    renderCues,
    updateButtonPlayingState, // Keep this exported if audioController calls it directly
    // updateCueButtonTime is mostly internal to renderCues now, but export if needed elsewhere
    updateCueButtonTime,
    updateCueButtonTimeWithData, // New function for direct time data updates from IPC
    updateCueMeterLevel,
    resetCueMeter
};