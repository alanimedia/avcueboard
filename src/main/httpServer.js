const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const { formatTimeMMSS, calculateEffectiveTrimmedDurationSec } = require('./utils/timeUtils'); // Import utilities
const logger = require('./utils/logger');
const { getWaveformPeaksForFile, resolveAudioFilePathForCue } = require('./waveformPeaksService');

let cueManagerRef;
let mainWindowRef; // To send messages to the renderer if needed

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

let configuredPort = 3000; // Default port
let appConfigRef = null; // Reference to app config

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
        effectiveShowButtonWaveform: resolveEffectiveShowButtonWaveform(cue, appConfigRef || {})
    };
}

function formatCuesForRemote(cues) {
    if (!Array.isArray(cues)) return [];
    return cues.map(cue => processCueForRemote(cue));
}

function initialize(cueMgr, mainWin, appConfig = null) {
    cueManagerRef = cueMgr;
    mainWindowRef = mainWin;
    appConfigRef = appConfig;

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

    wss.on('connection', (ws) => {
        logger.info('HTTP_SERVER: Remote client connected via WebSocket.');

        // Send current cues on connection
        if (cueManagerRef) {
            const rawCues = cueManagerRef.getCues();
            const processedCues = formatCuesForRemote(rawCues);
            rawCues.forEach((cue, index) => {
                logger.info(`HTTP_SERVER: Initial cue data for ${cue.id} (${cue.type}): trimmed=${processedCues[index].currentItemDurationS}s, original=${processedCues[index].knownDurationS}s`);
            });
            ws.send(JSON.stringify({ type: 'all_cues', payload: processedCues }));
        }

        ws.on('message', (message) => {
            // Reduced verbose logging
            try {
                const parsedMessage = JSON.parse(message.toString());

                if (parsedMessage.action === 'trigger_cue' && parsedMessage.cueId) {
                    const cueId = parsedMessage.cueId;
                    const now = Date.now();


                    const lastTriggerTime = recentlyTriggeredCuesByRemote.get(cueId);

                    if (lastTriggerTime && (now - lastTriggerTime < REMOTE_TRIGGER_DEBOUNCE_MS)) {
                        logger.info(`HTTP_SERVER: Ignoring duplicate trigger for cue ${cueId} (debounced)`);
                        return;
                    }

                    recentlyTriggeredCuesByRemote.set(cueId, now);

                    // New Guard: Ensure IPC for this specific trigger event is sent only once
                    if (ipcSentForThisRemoteTrigger[cueId]) {
                        logger.info(`HTTP_SERVER: Ignoring duplicate IPC trigger for cue ${cueId} (already sent)`);
                        // We still want the recentlyTriggeredCuesByRemote timeout to clear normally for the *next* distinct message.
                        // So, we just return from this execution path for THIS message.
                        return;
                    }
                    ipcSentForThisRemoteTrigger[cueId] = now;


                    // Clear the per-trigger IPC lock after a safe interval
                    setTimeout(() => {
                        delete ipcSentForThisRemoteTrigger[cueId];
                    }, 1000); // 1 second, well after any potential duplicate processing of the same event

                    // Original timeout for inter-message debounce
                    setTimeout(() => {
                        recentlyTriggeredCuesByRemote.delete(cueId);
                    }, REMOTE_TRIGGER_DEBOUNCE_MS);

                    if (mainWindowRef && mainWindowRef.webContents) {
                        const payload = {
                            cueId: parsedMessage.cueId,
                            source: 'remote_http'
                        };
                        mainWindowRef.webContents.send('trigger-cue-by-id-from-main', payload);

                    } else {
                        logger.warn('HTTP_SERVER: Cannot send trigger message - mainWindowRef or webContents not available');
                    }
                } else if (parsedMessage.action === 'stop_all_cues') {
                    if (mainWindowRef && mainWindowRef.webContents) {
                        mainWindowRef.webContents.send('stop-all-audio');
                        logger.info('HTTP_SERVER: Stop all cues command sent to main window');
                    } else {
                        logger.warn('HTTP_SERVER: Cannot send stop all command - mainWindowRef or webContents not available');
                    }
                } else if (parsedMessage.action === 'playlist_jump_to_item' && parsedMessage.cueId !== undefined && parsedMessage.targetIndex !== undefined) {
                    if (mainWindowRef && mainWindowRef.webContents) {
                        mainWindowRef.webContents.send('playlist-jump-to-item-from-main', { cueId: parsedMessage.cueId, targetIndex: parsedMessage.targetIndex });
                        logger.info(`HTTP_SERVER: Playlist jump to item command sent for cue ${parsedMessage.cueId}, index ${parsedMessage.targetIndex}`);
                    } else {
                        logger.warn('HTTP_SERVER: Cannot send playlist jump to item command - mainWindowRef or webContents not available');
                    }
                }
            } catch (error) {
                logger.error('HTTP_SERVER_LOG: Error in ws.on("message") handler:', error);
            }
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

    // If port changed, log a warning that restart is needed
    if (newConfig.httpRemotePort && newConfig.httpRemotePort !== configuredPort) {
        logger.info(`HTTP_SERVER: Port change detected (${configuredPort} -> ${newConfig.httpRemotePort}). Server restart required for changes to take effect.`);
    }

    if (newConfig.defaultShowButtonWaveform !== prevDefaultShowButtonWaveform && cueManagerRef) {
        const cues = cueManagerRef.getCues();
        broadcastToRemotes({ type: 'all_cues', payload: formatCuesForRemote(cues) });
    }
}

module.exports = { initialize, broadcastToRemotes, formatCuesForRemote, getRemoteInfo, updateConfig }; 