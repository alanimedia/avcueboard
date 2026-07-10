// Companion_soundboard/src/renderer/ui/appConfigUI.js
// Manages the App Configuration Sidebar UI, state, and interactions.

import * as ipcRendererBindingsModule from '../ipcRendererBindings.js'; // Import the module
import { uiLog } from './uiLogger.js';
import { normalizeRecentColors } from './buttonColorPresets.js';
import {
    populateRetriggerSelect,
    updateRetriggerHelpText,
    renderRetriggerLegend
} from '../retriggerBehaviorCatalog.js';
import { refreshAllCueBadges } from './cueGrid.js';
import * as relinkMissingAudioUI from './relinkMissingAudioUI.js';
import {
    setMonitorOutputDeviceId,
    setRouteShowPlaybackToMonitor,
    setMainOutputVolume,
    setMonitorOutputVolume
} from '../audioOutputRouting.js';
import {
    initAudioOutputDiagnostics,
    setOutputChannelDevice,
    syncOutputChannelDevice,
    startOutputChannelTest,
    stopAllOutputChannelTests,
    isOutputChannelTestPlaying,
    ensureMainOutputAnalyser,
    formatOutputLoudness,
    refreshActiveTestToneVolumes
} from '../audioOutputDiagnostics.js';
import { dbfsToMeterRatio, peakToMeterRatio, buildOutputMeterZonesGradient } from '../cueMeterDisplay.js';
import { formatDbfsCompact } from '../audioLoudnessMeter.js';

// let ipcRendererBindings; // REMOVE: This will now refer to the imported module alias

// --- Debounce Utility ---
let debounceTimer;
function debounce(func, delay) {
    return function(...args) {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), delay);
    };
}
// --- End Debounce Utility ---

// --- App Configuration DOM Elements ---
let configSidebar;
let saveAppConfigButton;
let closeConfigSidebarButton;

// General
let configCuesFilePathInput;
let configAutoLoadLastWorkspaceCheckbox;
let configLastOpenedWorkspacePathDiv;

// Default Cue Settings
let configDefaultCueTypeSelect;
let configDefaultFadeInInput; // in seconds in UI, converted to ms for config
let configDefaultFadeOutInput; // in seconds in UI, converted to ms for config
let configDefaultLoopSingleCueCheckbox;
let configDefaultRetriggerBehaviorSelect;
let retriggerBehaviorHelp;
let globalRetriggerLegend;
let configDefaultStopAllBehaviorSelect;
let configDefaultStopAllFadeOutInput;
let configDefaultStopAllFadeOutGroup;
let configCrossfadeTimeInput;

// Audio Settings
let configAudioOutputDeviceSelect;
let configAudioMonitorOutputDeviceSelect;
let configRouteShowPlaybackToMonitorCheckbox;
let configMainOutputTestBtn;
let configMonitorOutputTestBtn;
let configMainOutputVolume;
let configMonitorOutputVolume;
let configMainOutputVolumeValue;
let configMonitorOutputVolumeValue;
let headerMainOutputVolume;
let headerMainOutputVolumeValue;
let headerMainOutputMeter;
let headerMainOutputDbfs;
let configMainOutputMeter;
let configMonitorOutputMeter;
let configMainOutputLufs;
let configMonitorOutputLufs;
let configMainOutputDbfs;
let configMonitorOutputDbfs;
let lastRemoteLevelsSentAt = 0;

// UI Settings
// let configShowQuickControlsCheckbox; // REMOVED

// HTTP Remote Control Elements
let configHttpRemoteEnabledCheckbox;
let configHttpRemotePortGroup;
let configHttpRemotePortInput;
let configHttpRemoteLinksGroup;
let configHttpRemoteLinksDiv;
let configMainWaveformEnabledCheckbox;
let configDefaultShowButtonWaveformCheckbox;
let configDefaultShowCueMeterCheckbox;
let configRelinkMissingAudioBtn;

// Mixer Integration Elements
// Mixer Integration removed



// --- App Configuration State (local cache) ---
let currentAppConfig = {};
let isPopulatingSidebar = false;
let audioOutputDiagnosticsBound = false;
let mainVuDisplayLevel = 0;
let monitorVuDisplayLevel = 0;
let audioControllerRef = null; // Reference to audioController for applying device changes

async function init(electronAPI) { // Renamed parameter to avoid confusion
    uiLog.info('AppConfigUI: Initializing...');
    // ipcRendererBindings is already available as ipcRendererBindingsModule via import
    // No need to store electronAPI here if all IPC calls go through the module.
    cacheDOMElements();
    bindEventListeners();

    // Set up device change listener
    setupDeviceChangeListener();

    try {
        await forceLoadAndApplyAppConfiguration();
        setupAudioOutputDiagnostics();
        uiLog.info('AppConfigUI: Initial config loaded and populated after init. Returning config.');
        return currentAppConfig; // Return the loaded config
    } catch (error) {
        uiLog.error('AppConfigUI: Error during initial config load in init:', error);
        return {}; // Return empty object or handle error as appropriate
    }
}

// Function to set up device change listener
function setupDeviceChangeListener() {
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            uiLog.info('AppConfigUI: Audio devices changed, refreshing device list...');
            // Debounce the device list refresh to avoid excessive updates
            setTimeout(() => {
                loadAudioOutputDevices();
            }, 500);
        });
        uiLog.info('AppConfigUI: Device change listener set up.');
    } else {
        uiLog.warn('AppConfigUI: navigator.mediaDevices.addEventListener not available, device changes won\'t be detected.');
    }
}

// Function to set the audioController reference
function syncAppConfigToAudioController(config) {
    if (audioControllerRef && typeof audioControllerRef.updateAppConfig === 'function') {
        audioControllerRef.updateAppConfig(config);
    }
    if (config) {
        setMonitorOutputDeviceId(config.audioMonitorOutputDeviceId || 'default');
        setRouteShowPlaybackToMonitor(config.routeShowPlaybackToMonitor === true);
        setMainOutputVolume(typeof config.mainOutputVolume === 'number' ? config.mainOutputVolume : 1);
        setMonitorOutputVolume(typeof config.monitorOutputVolume === 'number' ? config.monitorOutputVolume : 1);
        refreshActiveTestToneVolumes();
    }
}

async function applyAudioRoutingFromConfig(config) {
    if (!audioControllerRef || !config) return;
    try {
        if (config.audioOutputDeviceId) {
            await audioControllerRef.setAudioOutputDevice(config.audioOutputDeviceId);
        }
        if (typeof audioControllerRef.setMonitorOutputDevice === 'function') {
            await audioControllerRef.setMonitorOutputDevice(config.audioMonitorOutputDeviceId || 'default');
        }
        setRouteShowPlaybackToMonitor(config.routeShowPlaybackToMonitor === true);
    } catch (error) {
        uiLog.error('AppConfigUI: Error applying audio routing from config:', error);
    }
}

function setAudioControllerRef(audioController) {
    audioControllerRef = audioController;
    uiLog.info('AppConfigUI: AudioController reference set');
    if (audioControllerRef && Object.keys(currentAppConfig).length > 0) {
        syncAppConfigToAudioController(currentAppConfig);
    }
}

function cacheDOMElements() {
    configSidebar = document.getElementById('configSidebar');
    saveAppConfigButton = document.getElementById('saveAppConfigButton'); 
    closeConfigSidebarButton = document.getElementById('closeConfigSidebarButton'); 

    // General
    configCuesFilePathInput = document.getElementById('configCuesFilePath');
    configAutoLoadLastWorkspaceCheckbox = document.getElementById('configAutoLoadLastWorkspace');
    configLastOpenedWorkspacePathDiv = document.getElementById('configLastOpenedWorkspacePath');

    // Default Cue Settings
    configDefaultCueTypeSelect = document.getElementById('configDefaultCueType');
    configDefaultFadeInInput = document.getElementById('defaultFadeIn');
    configDefaultFadeOutInput = document.getElementById('defaultFadeOut');
    configDefaultLoopSingleCueCheckbox = document.getElementById('defaultLoop');
    configDefaultRetriggerBehaviorSelect = document.getElementById('retriggerBehavior');
    retriggerBehaviorHelp = document.getElementById('retriggerBehaviorHelp');
    globalRetriggerLegend = document.getElementById('globalRetriggerLegend');
    populateRetriggerSelect(configDefaultRetriggerBehaviorSelect, { includeDefault: false });
    renderRetriggerLegend(globalRetriggerLegend);
    configDefaultStopAllBehaviorSelect = document.getElementById('defaultStopAllBehavior');
    configDefaultStopAllFadeOutInput = document.getElementById('defaultStopAllFadeOut');
    configDefaultStopAllFadeOutGroup = document.getElementById('defaultStopAllFadeOutGroup');
    configCrossfadeTimeInput = document.getElementById('crossfadeTime');

    // Audio Settings
    configAudioOutputDeviceSelect = document.getElementById('configAudioOutputDevice');
    configAudioMonitorOutputDeviceSelect = document.getElementById('configAudioMonitorOutputDevice');
    configRouteShowPlaybackToMonitorCheckbox = document.getElementById('configRouteShowPlaybackToMonitor');
    configMainOutputTestBtn = document.getElementById('configMainOutputTestBtn');
    configMonitorOutputTestBtn = document.getElementById('configMonitorOutputTestBtn');
    configMainOutputVolume = document.getElementById('configMainOutputVolume');
    configMonitorOutputVolume = document.getElementById('configMonitorOutputVolume');
    configMainOutputVolumeValue = document.getElementById('configMainOutputVolumeValue');
    configMonitorOutputVolumeValue = document.getElementById('configMonitorOutputVolumeValue');
    configMainOutputMeter = document.getElementById('configMainOutputMeter');
    configMonitorOutputMeter = document.getElementById('configMonitorOutputMeter');
    configMainOutputLufs = document.getElementById('configMainOutputLufs');
    configMonitorOutputLufs = document.getElementById('configMonitorOutputLufs');
    configMainOutputDbfs = document.getElementById('configMainOutputDbfs');
    configMonitorOutputDbfs = document.getElementById('configMonitorOutputDbfs');
    headerMainOutputVolume = document.getElementById('headerMainOutputVolume');
    headerMainOutputVolumeValue = document.getElementById('headerMainOutputVolumeValue');
    headerMainOutputMeter = document.getElementById('headerMainOutputMeter');
    headerMainOutputDbfs = document.getElementById('headerMainOutputDbfs');

    // HTTP Remote Control Elements
    configHttpRemoteEnabledCheckbox = document.getElementById('configHttpRemoteEnabled');
    configHttpRemotePortGroup = document.getElementById('httpRemotePortGroup');
    configHttpRemotePortInput = document.getElementById('configHttpRemotePort');
    configHttpRemoteLinksGroup = document.getElementById('httpRemoteLinksGroup');
    configHttpRemoteLinksDiv = document.getElementById('httpRemoteLinksDiv');
    configMainWaveformEnabledCheckbox = document.getElementById('configMainWaveformEnabled');
    configDefaultShowButtonWaveformCheckbox = document.getElementById('configDefaultShowButtonWaveform');
    configDefaultShowCueMeterCheckbox = document.getElementById('configDefaultShowCueMeter');
    configRelinkMissingAudioBtn = document.getElementById('configRelinkMissingAudioBtn');

    // Mixer Integration removed

    uiLog.info('AppConfigUI: DOM elements cached.');
}

// Mixer integration elements removed

function bindEventListeners() {
    uiLog.debug('AppConfigUI (DEBUG): bindEventListeners CALLED.');
    if (saveAppConfigButton) saveAppConfigButton.addEventListener('click', handleSaveButtonClick);
    if (closeConfigSidebarButton) closeConfigSidebarButton.addEventListener('click', () => uiAPI.toggleSidebar('configSidebar', false));
    if (configRelinkMissingAudioBtn) {
        configRelinkMissingAudioBtn.addEventListener('click', () => {
            relinkMissingAudioUI.openModal();
        });
    }

    if (configCuesFilePathInput) configCuesFilePathInput.addEventListener('change', handleAppConfigChange);
    if (configAutoLoadLastWorkspaceCheckbox) configAutoLoadLastWorkspaceCheckbox.addEventListener('change', handleAppConfigChange);

    if (configDefaultCueTypeSelect) configDefaultCueTypeSelect.addEventListener('change', handleAppConfigChange);
    if (configDefaultFadeInInput) configDefaultFadeInInput.addEventListener('change', handleAppConfigChange);
    if (configDefaultFadeOutInput) {
        uiLog.debug('AppConfigUI (DEBUG): configDefaultFadeOutInput FOUND. Adding event listener.');
        configDefaultFadeOutInput.addEventListener('change', handleAppConfigChange);
    } else {
        uiLog.error('AppConfigUI (DEBUG): configDefaultFadeOutInput NOT FOUND when trying to bind event listener!');
    }
    if (configDefaultLoopSingleCueCheckbox) configDefaultLoopSingleCueCheckbox.addEventListener('change', handleAppConfigChange);
    if (configDefaultRetriggerBehaviorSelect) {
        configDefaultRetriggerBehaviorSelect.addEventListener('change', () => {
            updateRetriggerHelpText(configDefaultRetriggerBehaviorSelect, retriggerBehaviorHelp);
            handleAppConfigChange();
        });
    }
    if (configDefaultStopAllBehaviorSelect) {
        configDefaultStopAllBehaviorSelect.value = currentAppConfig.defaultStopAllBehavior || 'stop';
        configDefaultStopAllBehaviorSelect.addEventListener('change', () => {
            handleStopAllBehaviorChange();
            handleAppConfigChange();
        });
    }
    if (configDefaultStopAllFadeOutInput) {
        configDefaultStopAllFadeOutInput.addEventListener('change', handleAppConfigChange);
    }

    if (configAudioOutputDeviceSelect) configAudioOutputDeviceSelect.addEventListener('change', handleAudioOutputDeviceChange);
    if (configAudioMonitorOutputDeviceSelect) configAudioMonitorOutputDeviceSelect.addEventListener('change', handleAudioOutputDeviceChange);
    if (configRouteShowPlaybackToMonitorCheckbox) configRouteShowPlaybackToMonitorCheckbox.addEventListener('change', handleAppConfigChange);
    bindAudioOutputDiagnosticsControls();
    
    // HTTP Remote Control event listeners
    if (configHttpRemoteEnabledCheckbox) {
        configHttpRemoteEnabledCheckbox.addEventListener('change', () => {
            handleHttpRemoteEnabledChange();
            handleAppConfigChange(); 
        });
    }
    if (configHttpRemotePortInput) configHttpRemotePortInput.addEventListener('change', handleAppConfigChange);
    if (configHttpRemotePortInput) configHttpRemotePortInput.addEventListener('blur', handleAppConfigChange);

    if (configMainWaveformEnabledCheckbox) {
        configMainWaveformEnabledCheckbox.addEventListener('change', () => {
            const enabled = configMainWaveformEnabledCheckbox.checked;
            if (window.uiModules?.mainWaveformPanel?.setPanelVisible) {
                window.uiModules.mainWaveformPanel.setPanelVisible(enabled, false);
            } else if (window.uiModules?.mainWaveformPanel?.applyConfig) {
                window.uiModules.mainWaveformPanel.applyConfig({
                    ...currentAppConfig,
                    mainWaveformEnabled: enabled,
                    mainWaveformHeight: currentAppConfig.mainWaveformHeight || 140
                });
            }
            handleAppConfigChange();
        });
    }
    if (configDefaultShowButtonWaveformCheckbox) {
        configDefaultShowButtonWaveformCheckbox.addEventListener('change', handleAppConfigChange);
    }
    if (configDefaultShowCueMeterCheckbox) {
        configDefaultShowCueMeterCheckbox.addEventListener('change', handleAppConfigChange);
    }
    
    // Mixer event listeners removed

    uiLog.info('AppConfigUI: Event listeners bound.');
}

function handleSaveButtonClick() {
    uiLog.info('AppConfigUI: Save button clicked.');
    saveAppConfiguration();
}

function updateOutputVolumeLabel(sliderEl, labelEl) {
    if (!sliderEl || !labelEl) return;
    labelEl.textContent = `${parseInt(sliderEl.value, 10) || 0}%`;
}

function setupOutputMeterZoneGradients() {
    const gradient = buildOutputMeterZonesGradient();
    document.querySelectorAll('.audio-output-vu-zones, .header-output-vu-zones').forEach((el) => {
        el.style.background = gradient;
    });
}

function updateOutputMeterUI(levels) {
    const applyVuLevel = (maskEl, rawLevel, channel, dbfs) => {
        if (!maskEl) return;
        const targetRatio = Number.isFinite(dbfs)
            ? dbfsToMeterRatio(dbfs)
            : peakToMeterRatio(rawLevel || 0);
        const clamped = Math.max(0, Math.min(1, targetRatio));
        let displayLevel = channel === 'main' ? mainVuDisplayLevel : monitorVuDisplayLevel;
        if (clamped >= displayLevel) {
            displayLevel = clamped;
        } else {
            displayLevel = Math.max(clamped, displayLevel * 0.9);
        }
        if (channel === 'main') {
            mainVuDisplayLevel = displayLevel;
        } else {
            monitorVuDisplayLevel = displayLevel;
        }
        const dimPct = (1 - displayLevel) * 100;
        maskEl.style.width = `${dimPct}%`;
    };
    applyVuLevel(configMainOutputMeter, levels?.main, 'main', levels?.dbfs?.main);
    applyVuLevel(configMonitorOutputMeter, levels?.monitor, 'monitor', levels?.dbfs?.monitor);
    applyVuLevel(headerMainOutputMeter, levels?.main, 'main', levels?.dbfs?.main);

    const meterLabels = formatOutputLoudness(levels);
    if (configMainOutputDbfs) configMainOutputDbfs.textContent = meterLabels.mainDbfs;
    if (configMonitorOutputDbfs) configMonitorOutputDbfs.textContent = meterLabels.monitorDbfs;
    if (headerMainOutputDbfs) {
        headerMainOutputDbfs.textContent = formatDbfsCompact(levels?.dbfs?.main);
    }
    if (configMainOutputLufs) configMainOutputLufs.textContent = meterLabels.main;
    if (configMonitorOutputLufs) configMonitorOutputLufs.textContent = meterLabels.monitor;

    const now = performance.now();
    if (now - lastRemoteLevelsSentAt >= 100) {
        lastRemoteLevelsSentAt = now;
        if (window.electronAPI?.send) {
            window.electronAPI.send('report-remote-output-levels', {
                main: levels?.main || 0,
                monitor: levels?.monitor || 0,
                dbfs: levels?.dbfs || {},
                lufs: levels?.lufs || {}
            });
        }
    }
}

function clampOutputVolumePercent(value) {
    if (!Number.isFinite(value)) return 100;
    return Math.max(0, Math.min(100, value));
}

function setMainVolumeSlidersPct(pct, skipEl = null) {
    const clamped = clampOutputVolumePercent(pct);
    const value = String(clamped);
    if (configMainOutputVolume && configMainOutputVolume !== skipEl) {
        configMainOutputVolume.value = value;
    }
    if (headerMainOutputVolume && headerMainOutputVolume !== skipEl) {
        headerMainOutputVolume.value = value;
    }
    updateOutputVolumeLabel(configMainOutputVolume, configMainOutputVolumeValue);
    updateOutputVolumeLabel(headerMainOutputVolume, headerMainOutputVolumeValue);
}

function applyOutputVolumesFromSliders({ persistConfig = false } = {}) {
    const mainSource = configMainOutputVolume || headerMainOutputVolume;
    const mainVol = mainSource
        ? clampOutputVolumePercent(parseInt(mainSource.value, 10))
        : 100;
    setMainVolumeSlidersPct(mainVol);

    const monitorVol = configMonitorOutputVolume
        ? clampOutputVolumePercent(parseInt(configMonitorOutputVolume.value, 10))
        : 100;

    setMainOutputVolume(mainVol / 100);
    setMonitorOutputVolume(monitorVol / 100);
    refreshActiveTestToneVolumes();

    updateOutputVolumeLabel(configMonitorOutputVolume, configMonitorOutputVolumeValue);

    if (persistConfig) {
        handleAppConfigChange();
    }
}

function populateOutputVolumeSliders(config) {
    const mainPct = Math.round((typeof config?.mainOutputVolume === 'number' ? config.mainOutputVolume : 1) * 100);
    const monitorPct = Math.round((typeof config?.monitorOutputVolume === 'number' ? config.monitorOutputVolume : 1) * 100);
    setMainVolumeSlidersPct(mainPct);
    if (configMonitorOutputVolume) configMonitorOutputVolume.value = String(monitorPct);
    updateOutputVolumeLabel(configMonitorOutputVolume, configMonitorOutputVolumeValue);
}

function syncOutputDiagnosticsDevices() {
    const mainDeviceId = configAudioOutputDeviceSelect?.value || currentAppConfig.audioOutputDeviceId || 'default';
    const monitorDeviceId = configAudioMonitorOutputDeviceSelect?.value || currentAppConfig.audioMonitorOutputDeviceId || 'default';
    syncOutputChannelDevice('main', mainDeviceId);
    syncOutputChannelDevice('monitor', monitorDeviceId);
}

function setOutputTestButtonState(mainPlaying, monitorPlaying) {
    if (configMainOutputTestBtn) {
        configMainOutputTestBtn.classList.toggle('active', mainPlaying);
        configMainOutputTestBtn.textContent = mainPlaying ? 'Stop' : 'Test';
    }
    if (configMonitorOutputTestBtn) {
        configMonitorOutputTestBtn.classList.toggle('active', monitorPlaying);
        configMonitorOutputTestBtn.textContent = monitorPlaying ? 'Stop' : 'Test';
    }
}

async function handleOutputTestButtonClick(channelKey) {
    syncOutputDiagnosticsDevices();
    const isMain = channelKey === 'main';
    const isPlaying = isOutputChannelTestPlaying(channelKey);

    if (isPlaying) {
        await stopAllOutputChannelTests();
        setOutputTestButtonState(false, false);
        return;
    }

    await startOutputChannelTest(channelKey);
    setOutputTestButtonState(isMain, !isMain);
}

function setupAudioOutputDiagnostics() {
    setupOutputMeterZoneGradients();
    initAudioOutputDiagnostics(updateOutputMeterUI);
    syncOutputDiagnosticsDevices();
    populateOutputVolumeSliders(currentAppConfig);
    applyOutputVolumesFromSliders();
    ensureMainOutputAnalyser();
}

function bindAudioOutputDiagnosticsControls() {
    if (audioOutputDiagnosticsBound) return;
    audioOutputDiagnosticsBound = true;

    if (configMainOutputTestBtn) {
        configMainOutputTestBtn.addEventListener('click', () => {
            handleOutputTestButtonClick('main');
        });
    }
    if (configMonitorOutputTestBtn) {
        configMonitorOutputTestBtn.addEventListener('click', () => {
            handleOutputTestButtonClick('monitor');
        });
    }
    if (configMainOutputVolume) {
        configMainOutputVolume.addEventListener('input', () => {
            setMainVolumeSlidersPct(parseInt(configMainOutputVolume.value, 10) || 0, configMainOutputVolume);
            applyOutputVolumesFromSliders({ persistConfig: true });
        });
    }
    if (headerMainOutputVolume) {
        headerMainOutputVolume.addEventListener('input', () => {
            setMainVolumeSlidersPct(parseInt(headerMainOutputVolume.value, 10) || 0, headerMainOutputVolume);
            applyOutputVolumesFromSliders({ persistConfig: true });
        });
    }
    if (configMonitorOutputVolume) {
        configMonitorOutputVolume.addEventListener('input', () => {
            applyOutputVolumesFromSliders({ persistConfig: true });
        });
    }
}

async function handleAudioOutputDeviceChange() {
    const mainDeviceId = configAudioOutputDeviceSelect?.value || 'default';
    const monitorDeviceId = configAudioMonitorOutputDeviceSelect?.value || 'default';
    setOutputChannelDevice('main', mainDeviceId);
    setOutputChannelDevice('monitor', monitorDeviceId);
    if (isOutputChannelTestPlaying('main') || isOutputChannelTestPlaying('monitor')) {
        await stopAllOutputChannelTests();
        setOutputTestButtonState(false, false);
    }
    handleAppConfigChange();
}

const debouncedSaveAppConfiguration = debounce(saveAppConfiguration, 500);

function handleAppConfigChange() {
    uiLog.debug('AppConfigUI (DEBUG): handleAppConfigChange CALLED.');
    if (isPopulatingSidebar) {
        uiLog.debug('AppConfigUI: App config field change detected during population, save suppressed.');
        return;
    }
    uiLog.info('AppConfigUI: App config field changed, attempting to save (debounced).');
    debouncedSaveAppConfiguration();
}

function populateConfigSidebar(config) {
    isPopulatingSidebar = true;
    try {
        currentAppConfig = config || {}; 
        uiLog.debug('AppConfigUI: Populating sidebar with config:', currentAppConfig);

        // General
        if (configCuesFilePathInput) configCuesFilePathInput.value = currentAppConfig.cuesFilePath || '';
        if (configAutoLoadLastWorkspaceCheckbox) configAutoLoadLastWorkspaceCheckbox.checked = currentAppConfig.autoLoadLastWorkspace === undefined ? true : currentAppConfig.autoLoadLastWorkspace;
        if (configLastOpenedWorkspacePathDiv) configLastOpenedWorkspacePathDiv.textContent = currentAppConfig.lastOpenedWorkspacePath || 'None';

        // Default Cue Settings
        if (configDefaultCueTypeSelect) configDefaultCueTypeSelect.value = currentAppConfig.defaultCueType || 'single_file';
        if (configDefaultFadeInInput) configDefaultFadeInInput.value = currentAppConfig.defaultFadeInTime !== undefined ? currentAppConfig.defaultFadeInTime : 0;
        if (configDefaultFadeOutInput) configDefaultFadeOutInput.value = currentAppConfig.defaultFadeOutTime !== undefined ? currentAppConfig.defaultFadeOutTime : 0;
        
        if (configDefaultLoopSingleCueCheckbox) configDefaultLoopSingleCueCheckbox.checked = currentAppConfig.defaultLoopSingleCue || false;
        if (configDefaultRetriggerBehaviorSelect) {
            configDefaultRetriggerBehaviorSelect.value = currentAppConfig.defaultRetriggerBehavior || 'restart';
            updateRetriggerHelpText(configDefaultRetriggerBehaviorSelect, retriggerBehaviorHelp);
        }
        if (configDefaultStopAllBehaviorSelect) configDefaultStopAllBehaviorSelect.value = currentAppConfig.defaultStopAllBehavior || 'stop';
        if (configDefaultStopAllFadeOutInput) configDefaultStopAllFadeOutInput.value = currentAppConfig.defaultStopAllFadeOutTime || 1500;
        if (configCrossfadeTimeInput) configCrossfadeTimeInput.value = currentAppConfig.crossfadeTime || 2000;
        
        // HTTP Remote Control Settings
        if (configHttpRemoteEnabledCheckbox) configHttpRemoteEnabledCheckbox.checked = currentAppConfig.httpRemoteEnabled !== false; // Default to true
        if (configHttpRemotePortInput) configHttpRemotePortInput.value = currentAppConfig.httpRemotePort || 3000;
        if (configMainWaveformEnabledCheckbox) {
            configMainWaveformEnabledCheckbox.checked = currentAppConfig.mainWaveformEnabled !== false;
        }
        if (configDefaultShowButtonWaveformCheckbox) {
            configDefaultShowButtonWaveformCheckbox.checked = currentAppConfig.defaultShowButtonWaveform === true;
        }
        if (configDefaultShowCueMeterCheckbox) {
            configDefaultShowCueMeterCheckbox.checked = currentAppConfig.defaultShowCueMeter !== false;
        }
        
        if (configAudioOutputDeviceSelect && currentAppConfig.audioOutputDeviceId) {
            configAudioOutputDeviceSelect.value = currentAppConfig.audioOutputDeviceId;
        } else if (configAudioOutputDeviceSelect) {
            configAudioOutputDeviceSelect.value = 'default';
        }

        if (configAudioMonitorOutputDeviceSelect && currentAppConfig.audioMonitorOutputDeviceId) {
            configAudioMonitorOutputDeviceSelect.value = currentAppConfig.audioMonitorOutputDeviceId;
        } else if (configAudioMonitorOutputDeviceSelect) {
            configAudioMonitorOutputDeviceSelect.value = 'default';
        }

        if (configRouteShowPlaybackToMonitorCheckbox) {
            configRouteShowPlaybackToMonitorCheckbox.checked = currentAppConfig.routeShowPlaybackToMonitor === true;
        }

        populateOutputVolumeSliders(currentAppConfig);
        applyOutputVolumesFromSliders();
        syncAppConfigToAudioController(currentAppConfig);
        applyAudioRoutingFromConfig(currentAppConfig);
        syncOutputDiagnosticsDevices();
        
        handleHttpRemoteEnabledChange();
        handleStopAllBehaviorChange();



        uiLog.debug('AppConfigUI: Sidebar populated (end of try block).');
    } finally {
        isPopulatingSidebar = false; 
    }
    uiLog.debug('AppConfigUI: DOM elements updated.');
}

function handleHttpRemoteEnabledChange() {
    const isEnabled = configHttpRemoteEnabledCheckbox && configHttpRemoteEnabledCheckbox.checked;
    if (configHttpRemotePortGroup) {
        configHttpRemotePortGroup.style.display = isEnabled ? 'block' : 'none';
    }
    if (configHttpRemoteLinksGroup) {
        configHttpRemoteLinksGroup.style.display = isEnabled ? 'block' : 'none';
    }
    
    // Load remote info when enabled
    if (isEnabled) {
        loadHttpRemoteInfo();
    }
}

async function loadHttpRemoteInfo() {
    if (!ipcRendererBindingsModule || !configHttpRemoteLinksDiv) return;
    
    try {
        const remoteInfo = await ipcRendererBindingsModule.getHttpRemoteInfo();
        uiLog.info('AppConfigUI: Received HTTP remote info:', remoteInfo);
        
        if (!remoteInfo.enabled) {
            configHttpRemoteLinksDiv.innerHTML = '<p class="small-text">HTTP remote is disabled.</p>';
            return;
        }
        
        if (!remoteInfo.interfaces || remoteInfo.interfaces.length === 0) {
            configHttpRemoteLinksDiv.innerHTML = '<p class="small-text">No network interfaces found.</p>';
            return;
        }
        
        let linksHTML = '';
        remoteInfo.interfaces.forEach(iface => {
            linksHTML += `
                <div class="remote-link-item">
                    <div class="remote-link-info">
                        <div class="remote-link-interface">${iface.interface}</div>
                        <div class="remote-link-url">${iface.url}</div>
                    </div>
                    <button class="remote-link-copy" data-url="${iface.url}">Copy</button>
                </div>
            `;
        });
        
        configHttpRemoteLinksDiv.innerHTML = linksHTML;
        
        // Add event listeners to all copy buttons (event delegation)
        configHttpRemoteLinksDiv.querySelectorAll('.remote-link-copy').forEach(button => {
            button.addEventListener('click', function() {
                const url = this.getAttribute('data-url');
                if (url) {
                    window.copyToClipboard(url, this);
                }
            });
        });
    } catch (error) {
        uiLog.error('AppConfigUI: Error loading HTTP remote info:', error);
        configHttpRemoteLinksDiv.innerHTML = '<p class="small-text">Error loading remote info.</p>';
    }
}

// Global function for copy to clipboard
window.copyToClipboard = async function(text, button) {
    const setBtn = (label, clsAdd, clsRemove) => {
        if (!button) return;
        const original = button.getAttribute('data-original-label') || button.textContent;
        if (!button.getAttribute('data-original-label')) button.setAttribute('data-original-label', original);
        button.textContent = label;
        if (clsAdd) button.classList.add(clsAdd);
        if (clsRemove) button.classList.remove(clsRemove);
        setTimeout(() => {
            button.textContent = original;
            if (clsAdd) button.classList.remove(clsAdd);
        }, 2000);
    };
    
    // Use Electron's clipboard API (most reliable for Electron apps)
    try {
        if (window.electronAPI && typeof window.electronAPI.writeToClipboard === 'function') {
            const result = await window.electronAPI.writeToClipboard(text);
            if (result && result.success) {
                setBtn('Copied!', 'copied');
                return;
            } else {
                uiLog.error('Electron clipboard API failed:', result?.error);
            }
        }
    } catch (error) {
        uiLog.error('Error using Electron clipboard API:', error);
    }
    
    // Fallback: Try browser clipboard API
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            setBtn('Copied!', 'copied');
            return;
        }
    } catch (error) {
        uiLog.warn('Browser clipboard API failed, trying execCommand fallback:', error);
    }

    // Last resort: use textarea + execCommand
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (ok) {
            setBtn('Copied!', 'copied');
        } else {
            setBtn('Failed');
            uiLog.error('All clipboard methods failed');
        }
    } catch (error) {
        uiLog.error('Failed to copy to clipboard:', error);
        setBtn('Failed');
    }
};

// Mixer handlers removed

function handleStopAllBehaviorChange() {
    const behavior = configDefaultStopAllBehaviorSelect ? configDefaultStopAllBehaviorSelect.value : 'stop';
    const showFadeOutTime = behavior === 'fade_out_and_stop';
    
    if (configDefaultStopAllFadeOutGroup) {
        configDefaultStopAllFadeOutGroup.style.display = showFadeOutTime ? 'block' : 'none';
    }
    
    uiLog.info('AppConfigUI: Stop All behavior changed to:', behavior, 'Show fade out time:', showFadeOutTime);
}


async function populateAudioOutputSelect(selectEl, selectedDeviceId) {
    if (!selectEl) return;

    selectEl.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = 'default';
    defaultOption.textContent = 'System Default';
    selectEl.appendChild(defaultOption);

    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            devices
                .filter((device) => device.kind === 'audiooutput')
                .forEach((device) => {
                    const option = document.createElement('option');
                    option.value = device.deviceId;
                    option.textContent = device.label || `Audio Output ${device.deviceId.substring(0, 8)}...`;
                    selectEl.appendChild(option);
                });
        } catch (deviceError) {
            uiLog.warn('AppConfigUI: Error enumerating audio output devices:', deviceError);
            const fallbackOption = document.createElement('option');
            fallbackOption.value = 'default';
            fallbackOption.textContent = 'System Default (Device list unavailable)';
            selectEl.appendChild(fallbackOption);
        }
    }

    selectEl.value = selectedDeviceId || 'default';
}

function reportAudioOutputDevicesToRemote() {
    const collectDevices = (selectEl) => {
        if (!selectEl) return [];
        return [...selectEl.options].map((option) => ({
            id: option.value,
            label: option.textContent || option.value
        }));
    };
    const devices = collectDevices(configAudioOutputDeviceSelect);
    if (devices.length === 0 || !window.electronAPI?.send) return;
    window.electronAPI.send('report-remote-audio-devices', { devices });
}

async function loadAudioOutputDevices() {
    if (!configAudioOutputDeviceSelect && !configAudioMonitorOutputDeviceSelect) {
        uiLog.warn('AppConfigUI: Audio output select elements not found.');
        return;
    }

    try {
        uiLog.info('AppConfigUI: Loading audio output devices...');
        const mainSelected = currentAppConfig?.audioOutputDeviceId || 'default';
        const monitorSelected = currentAppConfig?.audioMonitorOutputDeviceId || 'default';
        await populateAudioOutputSelect(configAudioOutputDeviceSelect, mainSelected);
        await populateAudioOutputSelect(configAudioMonitorOutputDeviceSelect, monitorSelected);
        reportAudioOutputDevicesToRemote();
        uiLog.info('AppConfigUI: Audio output device selection completed.');
    } catch (error) {
        uiLog.error('AppConfigUI: Error loading audio output devices:', error);
        [configAudioOutputDeviceSelect, configAudioMonitorOutputDeviceSelect].forEach((selectEl) => {
            if (!selectEl) return;
            selectEl.innerHTML = '';
            const errorOption = document.createElement('option');
            errorOption.value = 'default';
            errorOption.textContent = 'System Default (Error loading devices)';
            selectEl.appendChild(errorOption);
            selectEl.value = 'default';
        });
    }
}

let uiAPI = {}; 

function setUiApi(api) {
    uiAPI = api;
}
 
function gatherConfigFromUI() {
    const config = {
        cuesFilePath: configCuesFilePathInput ? configCuesFilePathInput.value : '',
        autoLoadLastWorkspace: configAutoLoadLastWorkspaceCheckbox ? configAutoLoadLastWorkspaceCheckbox.checked : true,
        lastOpenedWorkspacePath: currentAppConfig.lastOpenedWorkspacePath || '', // Preserve this from loaded config, not UI
        recentWorkspaces: currentAppConfig.recentWorkspaces || [], // Preserve this from loaded config
        recentButtonColors: currentAppConfig.recentButtonColors || [],

        defaultCueType: configDefaultCueTypeSelect ? configDefaultCueTypeSelect.value : 'single_file',
        defaultFadeInTime: configDefaultFadeInInput ? parseInt(configDefaultFadeInInput.value) : 0,
        defaultFadeOutTime: configDefaultFadeOutInput ? parseInt(configDefaultFadeOutInput.value) : 0,
        defaultLoopSingleCue: configDefaultLoopSingleCueCheckbox ? configDefaultLoopSingleCueCheckbox.checked : false,
        defaultRetriggerBehavior: configDefaultRetriggerBehaviorSelect ? configDefaultRetriggerBehaviorSelect.value : 'restart',
        defaultStopAllBehavior: configDefaultStopAllBehaviorSelect ? configDefaultStopAllBehaviorSelect.value : 'stop',
        defaultStopAllFadeOutTime: configDefaultStopAllFadeOutInput ? parseInt(configDefaultStopAllFadeOutInput.value) : 1500,
        crossfadeTime: configCrossfadeTimeInput ? parseInt(configCrossfadeTimeInput.value) : 2000,
        
        httpRemoteEnabled: configHttpRemoteEnabledCheckbox ? configHttpRemoteEnabledCheckbox.checked : true,
        httpRemotePort: configHttpRemotePortInput ? parseInt(configHttpRemotePortInput.value) : 3000,
        mainWaveformEnabled: configMainWaveformEnabledCheckbox ? configMainWaveformEnabledCheckbox.checked : true,
        mainWaveformHeight: currentAppConfig.mainWaveformHeight || 140,
        defaultShowButtonWaveform: configDefaultShowButtonWaveformCheckbox
            ? configDefaultShowButtonWaveformCheckbox.checked
            : false,
        defaultShowCueMeter: configDefaultShowCueMeterCheckbox
            ? configDefaultShowCueMeterCheckbox.checked
            : true,
        
        audioOutputDeviceId: configAudioOutputDeviceSelect ? configAudioOutputDeviceSelect.value : 'default',
        audioMonitorOutputDeviceId: configAudioMonitorOutputDeviceSelect ? configAudioMonitorOutputDeviceSelect.value : 'default',
        mainOutputVolume: configMainOutputVolume
            ? clampOutputVolumePercent(parseInt(configMainOutputVolume.value, 10)) / 100
            : (currentAppConfig.mainOutputVolume ?? 1),
        monitorOutputVolume: configMonitorOutputVolume
            ? clampOutputVolumePercent(parseInt(configMonitorOutputVolume.value, 10)) / 100
            : (currentAppConfig.monitorOutputVolume ?? 1),
        routeShowPlaybackToMonitor: configRouteShowPlaybackToMonitorCheckbox ? configRouteShowPlaybackToMonitorCheckbox.checked : false,
        
        // theme setting is not directly edited here, but preserved if it exists
        theme: currentAppConfig.theme || 'system',
    };
    
    uiLog.debug('AppConfigUI (gatherConfigFromUI): Gathered config:', JSON.parse(JSON.stringify(config)));
    return config;
}

async function savePartialAppConfiguration(partialSettings) {
    if (!ipcRendererBindingsModule) {
        uiLog.error('AppConfigUI: ipcRendererBindingsModule not available. Cannot save partial config.');
        return { success: false };
    }
    try {
        const payload = { ...partialSettings };
        if (Array.isArray(payload.recentButtonColors)) {
            payload.recentButtonColors = normalizeRecentColors(payload.recentButtonColors);
        }
        const result = await ipcRendererBindingsModule.saveAppConfig(payload);
        if (result && result.success) {
            currentAppConfig = { ...currentAppConfig, ...partialSettings };
            if (result.config) {
                currentAppConfig = { ...currentAppConfig, ...result.config };
            }
            syncAppConfigToAudioController(currentAppConfig);
        }
        return result;
    } catch (error) {
        uiLog.error('AppConfigUI: Error during savePartialAppConfiguration:', error);
        return { success: false, error: error.message };
    }
}

async function saveAppConfiguration() {
    uiLog.debug('AppConfigUI (DEBUG): saveAppConfiguration CALLED.');
    try {
        const configToSave = gatherConfigFromUI();
        uiLog.debug('AppConfigUI (DEBUG): gatherConfigFromUI completed, configToSave:', JSON.stringify(configToSave));

        if (!configToSave) {
            uiLog.error('AppConfigUI: No config data gathered from UI. Aborting save.');
            return;
        }

        uiLog.debug('AppConfigUI (DEBUG): Attempting to call ipcRendererBindingsModule.saveAppConfig...');
        const result = await ipcRendererBindingsModule.saveAppConfig(configToSave);
        uiLog.debug('AppConfigUI (DEBUG): ipcRendererBindingsModule.saveAppConfig call completed, result:', result);

        if (result && result.success) {
            uiLog.info('AppConfigUI: App configuration successfully saved via main process.');
            
            if (audioControllerRef) {
                try {
                    if (configToSave.audioOutputDeviceId !== currentAppConfig.audioOutputDeviceId) {
                        uiLog.info('AppConfigUI: Main audio output changed to', configToSave.audioOutputDeviceId);
                        await audioControllerRef.setAudioOutputDevice(configToSave.audioOutputDeviceId);
                    }
                    if (configToSave.audioMonitorOutputDeviceId !== currentAppConfig.audioMonitorOutputDeviceId
                        && typeof audioControllerRef.setMonitorOutputDevice === 'function') {
                        uiLog.info('AppConfigUI: Monitor audio output changed to', configToSave.audioMonitorOutputDeviceId);
                        await audioControllerRef.setMonitorOutputDevice(configToSave.audioMonitorOutputDeviceId);
                    }
                } catch (error) {
                    uiLog.error('AppConfigUI: Error applying audio routing changes:', error);
                    if (configAudioOutputDeviceSelect) {
                        configAudioOutputDeviceSelect.value = currentAppConfig.audioOutputDeviceId || 'default';
                    }
                    if (configAudioMonitorOutputDeviceSelect) {
                        configAudioMonitorOutputDeviceSelect.value = currentAppConfig.audioMonitorOutputDeviceId || 'default';
                    }
                }
            }
            
            currentAppConfig = { ...currentAppConfig, ...configToSave };
            syncAppConfigToAudioController(currentAppConfig);
            if (typeof refreshAllCueBadges === 'function') {
                refreshAllCueBadges();
            }
        } else {
            uiLog.error('AppConfigUI: Failed to save app configuration via main process:', result ? result.error : 'Unknown error');
        }
    } catch (error) {
        uiLog.error('AppConfigUI: Error during saveAppConfiguration:', error);
    }
}

async function forceLoadAndApplyAppConfiguration() {
    uiLog.info('AppConfigUI: Forcing load and apply of app configuration...');
    if (!ipcRendererBindingsModule) {
        uiLog.error('AppConfigUI: ipcRendererBindingsModule not available. Cannot force load config.');
        return Promise.reject('ipcRendererBindingsModule not available');
    }
    try {
        const loadedConfig = await ipcRendererBindingsModule.getAppConfig();
        uiLog.info('AppConfigUI: Successfully loaded config from main:', loadedConfig);
        populateConfigSidebar(loadedConfig);
        syncAppConfigToAudioController(loadedConfig);
        await loadAudioOutputDevices();
        syncOutputDiagnosticsDevices();
        setupAudioOutputDiagnostics();
        await applyAudioRoutingFromConfig(loadedConfig);
        return loadedConfig; 
    } catch (error) {
        uiLog.error('AppConfigUI: Error loading app configuration from main:', error);
        populateConfigSidebar({ ...currentAppConfig });
        await loadAudioOutputDevices();
        return Promise.reject(error);
    }
}

function getCurrentAppConfig() {
    return { ...currentAppConfig };
}

export { 
    init,
    populateConfigSidebar,
    saveAppConfiguration,
    savePartialAppConfiguration,
    forceLoadAndApplyAppConfiguration,
    getCurrentAppConfig,
    loadAudioOutputDevices,
    setUiApi,
    setAudioControllerRef
}; 