const { dialog, app, nativeTheme } = require('electron');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { checkForUpdates, showUpdateCheckDialog } = require('../utils/updateCheckUtils');

function handleThemeChange(theme, win, nativeTheme, appConfigManager) {
    if (theme === 'dark') {
        nativeTheme.themeSource = 'dark';
    } else if (theme === 'light') {
        nativeTheme.themeSource = 'light';
    } else {
        nativeTheme.themeSource = 'system';
    }
    if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send('theme-updated', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    }
    
    // Add check for appConfigManager
    if (appConfigManager && typeof appConfigManager.getConfig === 'function') {
        const currentConfig = appConfigManager.getConfig();
        if (currentConfig.theme !== theme) {
            appConfigManager.updateConfig({ theme: theme });
        }
    } else {
        logger.warn('handleThemeChange: appConfigManager is undefined or invalid, cannot update config');
    }
}

function registerSystemHandlers(ipcMain, { appConfigManager, mainWindow, openEasterEggGameFunc, httpServer }) {
    ipcMain.handle('generate-uuid', async () => uuidv4());

    ipcMain.handle('write-to-clipboard', async (event, text) => {
        try {
            clipboard.writeText(text);
            logger.info('IPC_HANDLER: Successfully wrote to clipboard');
            return { success: true };
        } catch (error) {
            logger.error('IPC_HANDLER: Error writing to clipboard:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-audio-output-devices', async () => {
        try {
            if (!app.isReady()) {
                logger.warn('Attempted to get media devices before app was ready.');
                return {
                    success: false,
                    error: 'Application not ready',
                    devices: [],
                    fallback: 'renderer_enumeration'
                };
            }
            logger.info('Audio output device enumeration delegated to renderer process');
            return {
                success: true,
                devices: [],
                delegated: true,
                message: 'Device enumeration delegated to renderer process for better compatibility'
            };
        } catch (error) {
            logger.error('Error in get-audio-output-devices handler:', error);
            return {
                success: false,
                error: error.message,
                devices: [],
                fallback: 'renderer_enumeration'
            };
        }
    });

    ipcMain.handle('get-app-version', async (event) => {
        const packageJson = require('../../../package.json');
        return packageJson.version;
    });

    ipcMain.handle('check-for-update', async () => checkForUpdates());

    ipcMain.handle('show-update-check-dialog', async () => {
        await showUpdateCheckDialog(mainWindow);
        return { success: true };
    });

    ipcMain.on('set-theme', (event, theme) => {
        handleThemeChange(theme, mainWindow, nativeTheme, appConfigManager);
    });

    ipcMain.handle('get-http-remote-info', async () => {
        if (httpServer && typeof httpServer.getRemoteInfo === 'function') {
            return httpServer.getRemoteInfo();
        }
        return { enabled: false, port: 3000, interfaces: [] };
    });

    ipcMain.on('open-easter-egg-game', () => {
        if (openEasterEggGameFunc && typeof openEasterEggGameFunc === 'function') {
            logger.info("IPC_HANDLER: 'open-easter-egg-game' - Requesting to open game window.");
            openEasterEggGameFunc();
        } else {
            logger.error("IPC_HANDLER: 'open-easter-egg-game' - openEasterEggGameWindowCallback function not found or not a function.");
        }
    });

    ipcMain.handle('show-open-dialog', async (event, options = {}) => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        if (!win) {
            return { canceled: true, filePaths: [] };
        }
        return dialog.showOpenDialog(win, options);
    });

    ipcMain.handle('show-save-dialog', async (event, options = {}) => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        if (!win) {
            return { canceled: true, filePath: undefined };
        }
        return dialog.showSaveDialog(win, options);
    });

    ipcMain.handle('show-confirmation-dialog', async (event, options = {}) => {
        const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        if (!win) {
            return { response: options.cancelId ?? 1, checkboxChecked: false };
        }
        const result = await dialog.showMessageBox(win, {
            type: options.type || 'warning',
            title: options.title || 'Confirm',
            message: options.message || '',
            detail: options.detail || '',
            buttons: options.buttons || ['OK', 'Cancel'],
            defaultId: options.defaultId ?? 0,
            cancelId: options.cancelId ?? 1,
            noLink: true
        });
        return { response: result.response, checkboxChecked: result.checkboxChecked };
    });
}

module.exports = {
    registerSystemHandlers,
    handleThemeChange
};

