const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const { formatTimeMMSS, calculateEffectiveTrimmedDurationSec } = require('./utils/timeUtils'); // Import utilities
const logger = require('./utils/logger');
const { getWaveformPeaksForFile, resolveAudioFilePathForCue } = require('./waveformPeaksService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const recentlyTriggeredCuesByRemote = new Map(); // cueId -> timestamp
const REMOTE_TRIGGER_DEBOUNCE_MS = 400; // Ignore duplicate remote triggers for the same cue within this time
let ipcSentForThisRemoteTrigger = {}; // cueId -> boolean : Blocks IPC send if true for this specific trigger event

// Cleanup function to prevent memory leaks in ipcSentForThisRemoteTrigger
function cleanupIpcTriggerLocks() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [cueId, timestamp] of Object.entries(ipcSentForThisRemoteTrigger)) {
        // Remove entries older than 5 seconds (safety margin)
        if (now - timestamp > 5000) {
            keysToDelete.push(cueId);
        }
    }

    keysToDelete.forEach(key => delete ipcSentForThisRemoteTrigger[key]);

    if (keysToDelete.length > 0) {
        logger.info(`HTTP_SERVER: Cleaned up ${keysToDelete.length} stale IPC trigger locks`);
    }
}

// Run cleanup every 30 seconds
setInterval(cleanupIpcTriggerLocks, 30000);

const {
    normalizeShowButtonWaveformOverride,
    resolveEffectiveShowButtonWaveform
} = require('./showButtonWaveformUtils');
const {
    mergeCuePatch,
    sanitizeConfigPatch,
    getRemoteConfigSnapshot,
    reorderCuesByIds,
    processCueDetailForRemote
} = require('./remoteEditUtils');

let cueManagerRef;
let mainWindowRef;
let workspaceManagerRef = null;
let appConfigManagerRef = null;
let configuredPort = 3000;
let appConfigRef = null;

function sendToClient(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function sendActionResult(ws, action, success, error = null) {
    sendToClient(ws, { type: 'action_result', action, success, error });
}

function broadcastConfigSnapshot() {
    broadcastToRemotes({
        type: 'config_snapshot',
        payload: getRemoteConfigSnapshot(appConfigRef || {})
    });
}

async function handleRemoteMessage(ws, message) {
    try {
        const parsedMessage = JSON.parse(message.toString());
        const action = parsedMessage.action;

        if (action === 'trigger_cue' && parsedMessage.cueId) {
            const cueId = parsedMessage.cueId;
            const now = Date.now();
            const lastTriggerTime = recentlyTriggeredCuesByRemote.get(cueId);
            if (lastTriggerTime && (now - lastTriggerTime < REMOTE_TRIGGER_DEBOUNCE_MS)) {
                logger.info(`HTTP_SERVER: Ignoring duplicate trigger for cue ${cueId} (debounced)`);
                return;
            }
            recentlyTriggeredCuesByRemote.set(cueId, now);
            if (ipcSentForThisRemoteTrigger[cueId]) {
                logger.info(`HTTP_SERVER: Ignoring duplicate IPC trigger for cue ${cueId} (already sent)`);
                return;
            }
            ipcSentForThisRemoteTrigger[cueId] = now;
            setTimeout(() => { delete ipcSentForThisRemoteTrigger[cueId]; }, 1000);
            setTimeout(() => { recentlyTriggeredCuesByRemote.delete(cueId); }, REMOTE_TRIGGER_DEBOUNCE_MS);
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('trigger-cue-by-id-from-main', {
                    cueId: parsedMessage.cueId,
                    source: 'remote_http'
                });
            } else {
                logger.warn('HTTP_SERVER: Cannot send trigger message - mainWindowRef or webContents not available');
            }
            return;
        }

        if (action === 'stop_all_cues') {
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('stop-all-audio');
                logger.info('HTTP_SERVER: Stop all cues command sent to main window');
            }
            return;
        }

        if (action === 'playlist_jump_to_item' && parsedMessage.cueId !== undefined && parsedMessage.targetIndex !== undefined) {
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('playlist-jump-to-item-from-main', {
                    cueId: parsedMessage.cueId,
                    targetIndex: parsedMessage.targetIndex
                });
            }
            return;
        }

        if (action === 'prepare_seek' && parsedMessage.cueId) {
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('prepare-seek-cue-by-id-from-main', {
                    cueId: parsedMessage.cueId
                });
            }
            return;
        }

        if (action === 'seek_cue' && parsedMessage.cueId != null && parsedMessage.positionSec != null) {
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('seek-cue-by-id-from-main', {
                    cueId: parsedMessage.cueId,
                    positionSec: Number(parsedMessage.positionSec),
                    finalizeScrub: parsedMessage.finalizeScrub !== false
                });
            }
            return;
        }

        if (action === 'set_cue_volume' && parsedMessage.cueId != null && parsedMessage.volume != null) {
            const volume = Math.max(0, Math.min(1, Number(parsedMessage.volume)));
            if (mainWindowRef && mainWindowRef.webContents) {
                mainWindowRef.webContents.send('set-cue-volume-by-id-from-main', {
                    cueId: parsedMessage.cueId,
                    volume,
                    persist: parsedMessage.persist !== false
                });
            }
            if (parsedMessage.persist !== false && cueManagerRef) {
                const existingCue = cueManagerRef.getCueById(parsedMessage.cueId);
                if (existingCue) {
                    cueManagerRef.addOrUpdateProcessedCue({ ...existingCue, volume }, null, { silentSave: true }).catch((err) => {
                        logger.error('HTTP_SERVER: Failed to persist live volume patch:', err);
                    });
                }
            }
            return;
        }

        if (action === 'request_all_cues_for_remote') {
            if (cueManagerRef) {
                sendToClient(ws, formatWorkspaceBroadcast(cueManagerRef));
                sendToClient(ws, { type: 'config_snapshot', payload: getRemoteConfigSnapshot(appConfigRef || {}) });
            }
            return;
        }

        if (action === 'update_cue') {
            if (!cueManagerRef || !parsedMessage.cueId) {
                sendActionResult(ws, action, false, 'Cue manager unavailable or missing cueId');
                return;
            }
            const existingCue = cueManagerRef.getCueById(parsedMessage.cueId);
            if (!existingCue) {
                sendActionResult(ws, action, false, 'Cue not found');
                return;
            }
            const mergedCue = mergeCuePatch(existingCue, parsedMessage.patch || {});
            const patch = parsedMessage.patch || {};
            const patchKeys = Object.keys(patch);
            const volumeOnlyPatch = patchKeys.length === 1
                && patchKeys[0] === 'volume'
                && typeof patch.volume === 'number';
            await cueManagerRef.addOrUpdateProcessedCue(mergedCue, null, { silentSave: volumeOnlyPatch });
            if (workspaceManagerRef && typeof workspaceManagerRef.markWorkspaceAsEdited === 'function') {
                workspaceManagerRef.markWorkspaceAsEdited();
            }
            sendActionResult(ws, action, true);
            return;
        }

        if (action === 'get_cue_detail') {
            if (!cueManagerRef || !parsedMessage.cueId) {
                sendActionResult(ws, action, false, 'Cue manager unavailable or missing cueId');
                return;
            }
            const cue = cueManagerRef.getCueById(parsedMessage.cueId);
            if (!cue) {
                sendActionResult(ws, action, false, 'Cue not found');
                return;
            }
            sendToClient(ws, {
                type: 'cue_detail',
                payload: processCueDetailForRemote(cue, appConfigRef || {})
            });
            return;
        }

        if (action === 'delete_cue') {
            if (!cueManagerRef || !parsedMessage.cueId) {
                sendActionResult(ws, action, false, 'Cue manager unavailable or missing cueId');
                return;
            }
            const deleted = await cueManagerRef.deleteCue(parsedMessage.cueId);
            if (!deleted) {
                sendActionResult(ws, action, false, 'Failed to delete cue');
                return;
            }
            if (workspaceManagerRef && typeof workspaceManagerRef.markWorkspaceAsEdited === 'function') {
                workspaceManagerRef.markWorkspaceAsEdited();
            }
            sendActionResult(ws, action, true);
            return;
        }

        if (action === 'reorder_cues') {
            if (!cueManagerRef) {
                sendActionResult(ws, action, false, 'Invalid reorder request');
                return;
            }
            const hasLayout = Array.isArray(parsedMessage.layout) && parsedMessage.layout.length > 0;
            const hasCueIds = Array.isArray(parsedMessage.cueIds) && parsedMessage.cueIds.length > 0;
            if (!hasLayout && !hasCueIds) {
                sendActionResult(ws, action, false, 'Invalid reorder request');
                return;
            }
            try {
                if (hasLayout && typeof cueManagerRef.setWorkspace === 'function') {
                    await cueManagerRef.setWorkspace({
                        layout: parsedMessage.layout,
                        sections: Array.isArray(parsedMessage.sections) ? parsedMessage.sections : cueManagerRef.getSections()
                    });
                } else if (hasCueIds) {
                    const reordered = reorderCuesByIds(cueManagerRef.getCues(), parsedMessage.cueIds);
                    await cueManagerRef.setCues(reordered);
                }
                if (workspaceManagerRef && typeof workspaceManagerRef.markWorkspaceAsEdited === 'function') {
                    workspaceManagerRef.markWorkspaceAsEdited();
                }
                sendActionResult(ws, action, true);
            } catch (error) {
                sendActionResult(ws, action, false, error.message);
            }
            return;
        }

        if (action === 'update_section') {
            if (!cueManagerRef || !parsedMessage.sectionId) {
                sendActionResult(ws, action, false, 'Invalid section update request');
                return;
            }
            const success = await cueManagerRef.updateSection(parsedMessage.sectionId, parsedMessage.patch || {});
            if (success && workspaceManagerRef) workspaceManagerRef.markWorkspaceAsEdited();
            sendActionResult(ws, action, success);
            return;
        }

        if (action === 'add_section') {
            if (!cueManagerRef) {
                sendActionResult(ws, action, false, 'Cue manager unavailable');
                return;
            }
            await cueManagerRef.addSection(parsedMessage.title || 'New Section', parsedMessage.afterSectionId || null);
            if (workspaceManagerRef) workspaceManagerRef.markWorkspaceAsEdited();
            sendActionResult(ws, action, true);
            return;
        }

        if (action === 'update_config') {
            if (!appConfigManagerRef || typeof appConfigManagerRef.updateConfig !== 'function') {
                sendActionResult(ws, action, false, 'Config manager unavailable');
                return;
            }
            const patch = sanitizeConfigPatch(parsedMessage.patch || {});
            if (Object.keys(patch).length === 0) {
                sendActionResult(ws, action, false, 'No valid config fields in patch');
                return;
            }
            const result = await appConfigManagerRef.updateConfig(patch);
            if (!result || !result.saved) {
                sendActionResult(ws, action, false, result?.error || 'Failed to save config');
                return;
            }
            appConfigRef = appConfigManagerRef.getConfig();
            broadcastConfigSnapshot();
            sendActionResult(ws, action, true);
            return;
        }
    } catch (error) {
        logger.error('HTTP_SERVER: Error in handleRemoteMessage:', error);
        sendActionResult(ws, 'unknown', false, error.message);
    }
}

function processCueForRemote(cue, overrides = {}) {
    let initialTrimmedDurationValueS = 0;
    let originalKnownDurationS = 0;

    if (cue.type === 'single_file') {
        initialTrimmedDurationValueS = calculateEffectiveTrimmedDurationSec(cue);
        originalKnownDurationS = cue.knownDuration || cue.knownDurationS || 0;
    } else if (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0) {
        const firstItem = cue.playlistItems[0];
        initialTrimmedDurationValueS = calculateEffectiveTrimmedDurationSec(firstItem);
        originalKnownDurationS = firstItem.knownDuration || 0;
    } else {
        initialTrimmedDurationValueS = cue.knownDuration || cue.knownDurationS || 0;
        originalKnownDurationS = cue.knownDuration || cue.knownDurationS || 0;
    }

    const trimStartTime = cue.type === 'single_file'
        ? (cue.trimStartTime || 0)
        : (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0
            ? (cue.playlistItems[0].trimStartTime || 0)
            : 0);
    const trimEndTime = cue.type === 'single_file'
        ? (cue.trimEndTime || 0)
        : (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0
            ? (cue.playlistItems[0].trimEndTime || 0)
            : 0);

    const status = overrides.status || cue.status || 'stopped';
    const currentTimeS = overrides.currentTimeS !== undefined ? overrides.currentTimeS : (cue.currentTimeS || 0);
    const currentItemDurationS = overrides.currentItemDurationS !== undefined
        ? overrides.currentItemDurationS
        : (cue.currentItemDurationS !== undefined ? cue.currentItemDurationS : initialTrimmedDurationValueS);

    return {
        id: cue.id,
        name: cue.name,
        type: cue.type,
        status,
        currentTimeS,
        currentItemDurationS,
        currentItemRemainingTimeS: overrides.currentItemRemainingTimeS !== undefined
            ? overrides.currentItemRemainingTimeS
            : (cue.currentItemRemainingTimeS !== undefined ? cue.currentItemRemainingTimeS : initialTrimmedDurationValueS),
        initialTrimmedDurationS: cue.initialTrimmedDurationS !== undefined ? cue.initialTrimmedDurationS : initialTrimmedDurationValueS,
        knownDurationS: cue.knownDurationS !== undefined ? cue.knownDurationS : originalKnownDurationS,
        playlistItemName: overrides.playlistItemName !== undefined
            ? overrides.playlistItemName
            : (cue.playlistItemName || ((cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0) ? cue.playlistItems[0].name : null)),
        nextPlaylistItemName: overrides.nextPlaylistItemName !== undefined ? overrides.nextPlaylistItemName : (cue.nextPlaylistItemName || null),
        trimStartTime: overrides.trimStartTime !== undefined ? overrides.trimStartTime : trimStartTime,
        trimEndTime: overrides.trimEndTime !== undefined ? overrides.trimEndTime : trimEndTime,
        progressRatio: overrides.progressRatio !== undefined ? overrides.progressRatio : (cue.progressRatio || 0),
        fileProgressRatio: overrides.fileProgressRatio !== undefined
            ? overrides.fileProgressRatio
            : (cue.fileProgressRatio !== undefined
                ? cue.fileProgressRatio
                : (trimStartTime > 0 && originalKnownDurationS > 0 ? Math.min(1, trimStartTime / originalKnownDurationS) : 0)),
        hasWaveform: !!(cue.type === 'single_file'
            ? cue.filePath
            : (cue.playlistItems && cue.playlistItems.length > 0 && cue.playlistItems[0].filePath)),
        buttonColor: cue.buttonColor || null,
        showButtonWaveform: normalizeShowButtonWaveformOverride(cue.showButtonWaveform),
        effectiveShowButtonWaveform: resolveEffectiveShowButtonWaveform(cue, appConfigRef || {}),
        volume: cue.volume !== undefined ? cue.volume : 1,
        fadeInTime: cue.fadeInTime || 0,
        fadeOutTime: cue.fadeOutTime || 0,
        loop: !!cue.loop,
        retriggerBehavior: cue.retriggerBehavior || 'restart'
    };
}

function formatCuesForRemote(cues) {
    if (!Array.isArray(cues)) return [];
    return cues.map(cue => processCueForRemote(cue));
}

function formatWorkspaceBroadcast(cueManager) {
    const workspace = typeof cueManager.getWorkspaceSnapshot === 'function'
        ? cueManager.getWorkspaceSnapshot()
        : { cues: cueManager.getCues(), sections: [], layout: [] };
    return {
        type: 'all_cues',
        payload: formatCuesForRemote(workspace.cues),
        sections: workspace.sections || [],
        layout: workspace.layout || []
    };
}

function initialize(cueMgr, mainWin, appConfig = null, workspaceMgr = null, appConfigMgr = null) {
    cueManagerRef = cueMgr;
    mainWindowRef = mainWin;
    appConfigRef = appConfig;
    workspaceManagerRef = workspaceMgr;
    appConfigManagerRef = appConfigMgr;

    // Use configured port if available
    if (appConfig && appConfig.httpRemotePort) {
        configuredPort = appConfig.httpRemotePort;
    }

    // Serve static files (like remote.html, and later CSS/JS for it)
    // Assuming remote.html will be in src/renderer/remote_control/
    app.use(express.static(path.join(__dirname, '..', 'renderer', 'remote_control')));
    // Add static serving for the top-level assets directory
    app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'renderer', 'remote_control', 'remote.html'));
    });

    app.get('/api/cues/:cueId/waveform-peaks', async (req, res) => {
        try {
            if (!cueManagerRef) {
                return res.status(503).json({ success: false, error: 'Cue manager unavailable' });
            }
            const cue = cueManagerRef.getCueById(req.params.cueId);
            if (!cue) {
                return res.status(404).json({ success: false, error: 'Cue not found' });
            }
            const playlistItemName = req.query.playlistItemName || null;
            const filePath = resolveAudioFilePathForCue(cue, playlistItemName);
            if (!filePath) {
                return res.status(404).json({ success: false, error: 'No audio file for cue' });
            }
            const peaksResult = await getWaveformPeaksForFile(filePath);
            if (!peaksResult.success) {
                return res.status(500).json(peaksResult);
            }
            res.json(peaksResult);
        } catch (error) {
            logger.error('HTTP_SERVER: Error serving waveform peaks:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/config', (req, res) => {
        res.json({ success: true, config: getRemoteConfigSnapshot(appConfigRef || {}) });
    });

    wss.on('connection', (ws) => {
        logger.info('HTTP_SERVER: Remote client connected via WebSocket.');

        // Send current cues on connection
        if (cueManagerRef) {
            const workspace = formatWorkspaceBroadcast(cueManagerRef);
            workspace.payload.forEach((cue, index) => {
                logger.info(`HTTP_SERVER: Initial cue data for ${cue.id} (${cue.type}): trimmed=${cue.currentItemDurationS}s, original=${cue.knownDurationS}s`);
            });
            ws.send(JSON.stringify(workspace));
            sendToClient(ws, { type: 'config_snapshot', payload: getRemoteConfigSnapshot(appConfigRef || {}) });
        }

        ws.on('message', (message) => {
            handleRemoteMessage(ws, message);
        });

        ws.on('close', () => {
            logger.info('HTTP_SERVER: Remote client disconnected.');
        });

        ws.on('error', (error) => {
            logger.error('HTTP_SERVER: WebSocket error:', error);
        });
    });

    // Function to try starting server on a port, with automatic retry on different ports
    function tryStartServer(port, maxRetries = 10) {
        server.listen(port, () => {
            configuredPort = port; // Update the configured port to the actual port used
            logger.info(`HTTP_SERVER: HTTP and WebSocket server started on port ${port}. Access remote at http://localhost:${port}`);
        }).on('error', (error) => {
            logger.error(`HTTP_SERVER: Failed to start server on port ${port}:`, error);
            if (error.code === 'EADDRINUSE') {
                const nextPort = port + 1;
                if (nextPort <= configuredPort + maxRetries) {
                    logger.info(`HTTP_SERVER: Port ${port} is already in use. Trying port ${nextPort}...`);
                    tryStartServer(nextPort, maxRetries);
                } else {
                    logger.error(`HTTP_SERVER: Could not find an available port after trying ${maxRetries} ports starting from ${configuredPort}. Please check your system.`);
                }
            } else {
                logger.error(`HTTP_SERVER: Server startup failed with error: ${error.message}`);
            }
        });
    }

    tryStartServer(configuredPort);
}

// Function to broadcast updates to all connected remote clients
function broadcastToRemotes(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(JSON.stringify(message));
            } catch (error) {
                logger.error('HTTP_SERVER: Error sending message to remote client:', error);
            }
        }
    });
}

// Function to get all network interface IP addresses
function getNetworkInterfaces() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const interfaceName in interfaces) {
        const interfaceInfo = interfaces[interfaceName];
        for (const info of interfaceInfo) {
            // Skip internal (loopback) and non-IPv4 addresses
            if (!info.internal && info.family === 'IPv4') {
                addresses.push({
                    interface: interfaceName,
                    address: info.address,
                    url: `http://${info.address}:${configuredPort}`
                });
            }
        }
    }

    return addresses;
}

// Function to get HTTP remote info for app config
function getRemoteInfo() {
    return {
        enabled: appConfigRef ? appConfigRef.httpRemoteEnabled !== false : true,
        port: configuredPort,
        interfaces: getNetworkInterfaces()
    };
}

// Function to update configuration (for port changes, etc.)
function updateConfig(newConfig) {
    const prevDefaultShowButtonWaveform = appConfigRef?.defaultShowButtonWaveform;
    appConfigRef = newConfig;

    if (newConfig.httpRemotePort && newConfig.httpRemotePort !== configuredPort) {
        logger.info(`HTTP_SERVER: Port change detected (${configuredPort} -> ${newConfig.httpRemotePort}). Server restart required for changes to take effect.`);
    }

    broadcastConfigSnapshot();

    if (newConfig.defaultShowButtonWaveform !== prevDefaultShowButtonWaveform && cueManagerRef) {
        const cues = cueManagerRef.getCues();
        broadcastToRemotes({ type: 'all_cues', payload: formatCuesForRemote(cues) });
    }
}

module.exports = { initialize, broadcastToRemotes, formatCuesForRemote, getRemoteInfo, updateConfig }; 