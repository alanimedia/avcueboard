const { dialog } = require('electron');
const logger = require('../utils/logger');
const {
    collectMissingMedia,
    buildFilenameIndex,
    planRelinks,
    summarizeMissingMedia,
    summarizeRelinkPlan,
    applyRelinkMatches
} = require('../utils/audioRelinkUtils');
const { scanMissingMediaState, syncMissingMediaSignature } = require('../utils/missingMediaMonitor');

function registerWorkspaceHandlers(ipcMain, { appConfigManager, cueManager, workspaceManager, mainWindow, httpServer }) {
    ipcMain.handle('get-initial-config', async () => {
        const config = appConfigManager.getConfig();
        logger.info('[IPC get-initial-config] Sending config to renderer:', config);
        return config;
    });

    ipcMain.handle('save-app-config', async (event, config) => {
        logger.info(`IPC_HANDLER: 'save-app-config' received with config:`, JSON.stringify(config));
        try {
            const result = await appConfigManager.updateConfig(config);
            if (result && result.saved) {
                logger.info('IPC_HANDLER: appConfigManager.updateConfig successful and config saved.');
                return { success: true, config: result.config };
            } else {
                logger.error('IPC_HANDLER: appConfigManager.updateConfig called, but config save FAILED.');
                return { success: false, error: 'Failed to save configuration file.', config: result.config };
            }
        } catch (error) {
            logger.error('IPC_HANDLER: Error calling appConfigManager.updateConfig:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-config-path', () => {
        return appConfigManager.getConfigPath();
    });

    ipcMain.handle('scan-missing-media', async () => {
        try {
            if (!cueManager || typeof cueManager.getCues !== 'function') {
                return { success: false, error: 'CueManager not available' };
            }
            const workspaceDir = workspaceManager?.getCurrentWorkspacePath?.()
                || cueManager.getWorkspaceDirectory?.()
                || null;
            const missing = collectMissingMedia(cueManager.getCues(), workspaceDir);
            const summary = summarizeMissingMedia(missing);
            syncMissingMediaSignature(summary.missingCueIds);
            return { success: true, missing, workspaceDir, ...summary };
        } catch (error) {
            logger.error("IPC_HANDLER: 'scan-missing-media' error:", error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('poll-missing-media', async () => {
        try {
            if (!cueManager || typeof cueManager.getCues !== 'function') {
                return { success: false, error: 'CueManager not available' };
            }
            const state = scanMissingMediaState(cueManager, workspaceManager);
            if (state.changed && httpServer && typeof httpServer.broadcastToRemotes === 'function') {
                httpServer.broadcastToRemotes({
                    type: 'missing_media_state',
                    payload: {
                        missingCueIds: state.missingCueIds,
                        fileCount: state.fileCount,
                        cueCount: state.cueCount
                    }
                });
            }
            return {
                success: true,
                changed: state.changed,
                missingCueIds: state.missingCueIds,
                fileCount: state.fileCount,
                cueCount: state.cueCount
            };
        } catch (error) {
            logger.error("IPC_HANDLER: 'poll-missing-media' error:", error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('plan-relink-from-folder', async (event, searchRoot = null) => {
        try {
            if (!cueManager || typeof cueManager.getCues !== 'function') {
                return { success: false, error: 'CueManager not available' };
            }

            let folder = searchRoot;
            if (!folder) {
                const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
                const dialogResult = await dialog.showOpenDialog(win, {
                    title: 'Choose folder to search for audio files',
                    properties: ['openDirectory']
                });
                if (dialogResult.canceled || !dialogResult.filePaths?.length) {
                    return { success: false, canceled: true };
                }
                folder = dialogResult.filePaths[0];
            }

            const workspaceDir = workspaceManager?.getCurrentWorkspacePath?.()
                || cueManager.getWorkspaceDirectory?.()
                || null;
            const missing = collectMissingMedia(cueManager.getCues(), workspaceDir);
            const index = buildFilenameIndex(folder);
            const plan = planRelinks(missing, index);
            const stats = summarizeRelinkPlan(plan);

            logger.info(
                `IPC_HANDLER: 'plan-relink-from-folder' searched "${folder}" — `
                + `${stats.matched} matched, ${stats.ambiguous} ambiguous, ${stats.notFound} not found`
            );

            return { success: true, searchRoot: folder, plan, stats };
        } catch (error) {
            logger.error("IPC_HANDLER: 'plan-relink-from-folder' error:", error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('apply-relink-matches', async (event, matches) => {
        try {
            if (!cueManager) {
                return { success: false, error: 'CueManager not available' };
            }
            const appliedCount = await applyRelinkMatches(cueManager, matches);
            if (appliedCount > 0) {
                if (workspaceManager) workspaceManager.markWorkspaceAsEdited();
                if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                    mainWindow.webContents.send('cues-updated-from-main', cueManager.getWorkspaceSnapshot());
                }
                const workspaceDir = workspaceManager?.getCurrentWorkspacePath?.()
                    || cueManager.getWorkspaceDirectory?.()
                    || null;
                const summary = summarizeMissingMedia(collectMissingMedia(cueManager.getCues(), workspaceDir));
                syncMissingMediaSignature(summary.missingCueIds);
                if (httpServer && typeof httpServer.broadcastToRemotes === 'function') {
                    httpServer.broadcastToRemotes({
                        type: 'missing_media_state',
                        payload: {
                            missingCueIds: summary.missingCueIds,
                            fileCount: summary.fileCount,
                            cueCount: summary.cueCount
                        }
                    });
                }
            }
            logger.info(`IPC_HANDLER: 'apply-relink-matches' applied ${appliedCount} relinks`);
            return { success: true, appliedCount };
        } catch (error) {
            logger.error("IPC_HANDLER: 'apply-relink-matches' error:", error);
            return { success: false, error: error.message };
        }
    });
}

module.exports = registerWorkspaceHandlers;
