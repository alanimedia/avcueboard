const fs = require('fs');
const fsPromises = require('fs').promises; // Use promises for async I/O
const path = require('path');
const { app } = require('electron'); // Required for app.getPath('userData')
const { v4: uuidv4 } = require('uuid');
const logger = require('./utils/logger');
const { getAudioFileDuration } = require('./utils/audioFileUtils');
const { normalizeCueAudioPaths } = require('./utils/audioPathUtils');
const {
  migrateToV2,
  repairWorkspace,
  getOrderedCueIds,
  removeCueFromLayout,
  removeSectionFromLayout,
  insertCueInLayout,
  appendCueToDefaultSection,
  createDefaultSection,
  sanitizeSectionPatch,
  sanitizeSection,
  findSectionIdForLayoutIndex
} = require('./cueLayoutUtils');
const appConfig = require('./appConfig');
const {
  normalizeRetriggerBehaviorOverride,
  migrateCueRetriggerStorage
} = require('./retriggerBehaviorUtils');
// Mixer integration removed as per requirements

const CUES_FILE_NAME = 'cues.json';
let currentCuesFilePath = path.join(app.getPath('userData'), CUES_FILE_NAME); // Default path

let cues = [];
let sections = [];
let layout = [];
let websocketServerInstance; // To notify on updates
let httpServerInstance; // Added: To notify remote HTTP clients
let mainWindowRef; // To store mainWindow reference for IPC

// Function to explicitly set the directory for the cues file.
// If dirPath is null, resets to default userData path.
function setCuesDirectory(dirPath) {
  if (dirPath) {
    try {
      // If a full file path was provided (e.g., ends with .json), use it directly
      if (typeof dirPath === 'string' && path.extname(dirPath).toLowerCase() === '.json') {
        currentCuesFilePath = dirPath;
      } else {
        currentCuesFilePath = path.join(dirPath, CUES_FILE_NAME);
      }
    } catch (e) {
      logger.warn('Cues file path resolution failed, falling back to userData. Input:', dirPath, 'Error:', e);
      currentCuesFilePath = path.join(app.getPath('userData'), CUES_FILE_NAME);
    }
  } else {
    currentCuesFilePath = path.join(app.getPath('userData'), CUES_FILE_NAME);
  }
  logger.info('Cues file path set to:', currentCuesFilePath);
  // After changing path, existing cues array might be stale.
  // Caller should explicitly call loadCuesFromFile() if needed.
}

async function loadCuesFromFile() {
  try {
    try {
      await fsPromises.access(currentCuesFilePath);
    } catch (e) {
      const empty = migrateToV2([]);
      cues = empty.cues;
      sections = empty.sections;
      layout = empty.layout;
      logger.info(`No cues file found at ${currentCuesFilePath}, starting fresh. Save explicitly if needed.`);
      return getWorkspaceSnapshot();
    }

    const data = await fsPromises.readFile(currentCuesFilePath, 'utf-8');
    const parsed = JSON.parse(data);
    const wasV1Array = Array.isArray(parsed);
    const workspace = migrateToV2(parsed);
    const defaultRetrigger = appConfig.getConfig()?.defaultRetriggerBehavior || 'restart';
    const workspaceDir = getWorkspaceDirectory();
    let pathsChanged = false;
    cues = workspace.cues.map(cue => {
      const migratedCue = migrateCueRetriggerStorage({
        ...cue,
        enableDucking: cue.enableDucking !== undefined ? cue.enableDucking : false,
        duckingLevel: cue.duckingLevel !== undefined ? cue.duckingLevel : 80,
        isDuckingTrigger: cue.isDuckingTrigger !== undefined ? cue.isDuckingTrigger : false,
      }, defaultRetrigger);
      if (migratedCue.hasOwnProperty('x32Trigger')) {
        delete migratedCue.x32Trigger;
      }
      const normalizedCue = normalizeCueAudioPaths(migratedCue, workspaceDir);
      if (normalizedCue.filePath !== migratedCue.filePath) pathsChanged = true;
      if (Array.isArray(normalizedCue.playlistItems) && Array.isArray(migratedCue.playlistItems)) {
        normalizedCue.playlistItems.forEach((item, index) => {
          const original = migratedCue.playlistItems[index];
          if (original && item.path !== original.path) pathsChanged = true;
        });
      }
      return normalizedCue;
    });
    sections = workspace.sections;
    layout = repairWorkspace({ ...workspace, cues }).layout;
    logger.info('Cues loaded from file:', currentCuesFilePath);
    if (wasV1Array) {
      logger.info('CueManager: Migrated v1 cues array to v2 workspace format.');
      await saveCuesToFile(true);
    } else if (pathsChanged) {
      logger.info('CueManager: Normalized audio file paths during load. Saving workspace.');
      await saveCuesToFile(true);
    }
  } catch (error) {
    logger.error('Error loading cues from file:', currentCuesFilePath, error);
    const empty = migrateToV2([]);
    cues = empty.cues;
    sections = empty.sections;
    layout = empty.layout;
  }
  return getWorkspaceSnapshot();
}

function getWorkspaceSnapshot() {
  return {
    version: 2,
    cues: getCues(),
    sections: sections.map(section => ({ ...section })),
    layout: layout.map(entry => ({ ...entry }))
  };
}

function applyWorkspaceSnapshot(snapshot) {
  if (!snapshot) return;
  if (Array.isArray(snapshot)) {
    const workspace = migrateToV2(snapshot);
    cues = workspace.cues;
    sections = workspace.sections;
    layout = workspace.layout;
    return;
  }
  const workspace = repairWorkspace(snapshot);
  cues = workspace.cues;
  sections = workspace.sections;
  layout = workspace.layout;
}

function getSections() {
  return sections.map(section => ({ ...section }));
}

function getLayout() {
  return layout.map(entry => ({ ...entry }));
}

async function saveCuesToFile(silent = false) {
  if (!currentCuesFilePath) {
    logger.error('CueManager: Cues file path not set. Cannot save cues.');
    return false;
  }
  // --- DIAGNOSTIC LOG --- 
  logger.info('CueManager: Attempting to save cues to path:', currentCuesFilePath, 'Silent mode:', silent);
  try {
    await fsPromises.writeFile(currentCuesFilePath, JSON.stringify(getWorkspaceSnapshot(), null, 2));
    logger.info('Cues saved to file:', currentCuesFilePath);

    if (!silent) {
      if (websocketServerInstance) {
        websocketServerInstance.broadcastCuesListUpdate(cues);
      }
      if (httpServerInstance && typeof httpServerInstance.broadcastToRemotes === 'function') {
        const workspace = getWorkspaceSnapshot();
        const payload = typeof httpServerInstance.formatCuesForRemote === 'function'
          ? httpServerInstance.formatCuesForRemote(cues)
          : cues;
        httpServerInstance.broadcastToRemotes({
          type: 'all_cues',
          payload,
          sections: workspace.sections,
          layout: workspace.layout
        });
        logger.info('CueManager: Broadcasted all_cues to HTTP remotes.');
      }
      if (mainWindowRef && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
        logger.info('CueManager (saveCuesToFile): Non-silent save, sending cues-updated-from-main to renderer.');
        mainWindowRef.webContents.send('cues-updated-from-main', getWorkspaceSnapshot());
      }
    }
    return true;
  } catch (error) {
    logger.error('Error saving cues to file:', currentCuesFilePath, error);
    return false;
  }
}

function getCues() {
  // --- DIAGNOSTIC LOG ---
  logger.info(`CueManager: getCues() called. Returning ${cues.length} cues.`);
  return cues;
}

function getCuesInLayoutOrder() {
  const orderedIds = getOrderedCueIds(layout);
  const cueMap = new Map(cues.map(cue => [cue.id, cue]));
  const ordered = orderedIds.map(cueId => cueMap.get(cueId)).filter(Boolean);
  cues.forEach(cue => {
    if (!orderedIds.includes(cue.id)) {
      ordered.push(cue);
    }
  });
  return ordered;
}

function getCueById(cueId) {
  const cue = cues.find(c => c.id === cueId);
  return cue;
}

async function setCues(updatedCues) {
  cues = updatedCues;
  const orderedIds = getOrderedCueIds(layout);
  const newIds = updatedCues.map(cue => cue.id);
  if (orderedIds.join(',') !== newIds.join(',')) {
    layout = repairWorkspace({
      version: 2,
      sections,
      cues,
      layout: layout.filter(entry => entry.type === 'section').concat(
        newIds.map(cueId => {
          const existing = layout.find(entry => entry.type === 'cue' && entry.cueId === cueId);
          return {
            type: 'cue',
            cueId,
            sectionId: existing?.sectionId || sections[0]?.id
          };
        })
      )
    }).layout;
  }
  const success = await saveCuesToFile();
  if (!success) {
    logger.error("Failed to save cues after setCues.");
  }
}

async function setWorkspace({ cues: nextCues, sections: nextSections, layout: nextLayout }) {
  if (Array.isArray(nextCues)) cues = nextCues;
  if (Array.isArray(nextSections)) sections = nextSections.map(sanitizeSection);
  if (Array.isArray(nextLayout)) {
    layout = repairWorkspace({
      version: 2,
      sections,
      cues,
      layout: nextLayout
    }).layout;
  }
  const success = await saveCuesToFile();
  if (!success) {
    logger.error('Failed to save workspace after setWorkspace.');
  }
  return success;
}

async function addSection(title = 'New Section', afterSectionId = null) {
  const section = createDefaultSection(title);
  if (!afterSectionId) {
    sections.push(section);
    layout.push({ type: 'section', sectionId: section.id });
  } else {
    const index = sections.findIndex(item => item.id === afterSectionId);
    const insertAt = index >= 0 ? index + 1 : sections.length;
    sections.splice(insertAt, 0, section);
    const layoutIndex = layout.findIndex(entry => entry.type === 'section' && entry.sectionId === afterSectionId);
    if (layoutIndex >= 0) {
      layout.splice(layoutIndex + 1, 0, { type: 'section', sectionId: section.id });
    } else {
      layout.push({ type: 'section', sectionId: section.id });
    }
  }
  await saveCuesToFile();
  return section;
}

async function updateSection(sectionId, patch = {}) {
  const index = sections.findIndex(section => section.id === sectionId);
  if (index === -1) return false;
  sections[index] = { ...sections[index], ...sanitizeSectionPatch(patch) };
  await saveCuesToFile();
  return true;
}

async function deleteSection(sectionId) {
  if (sections.length <= 1) return false;
  const fallbackSection = sections.find(section => section.id !== sectionId);
  if (!fallbackSection) return false;

  layout = layout.map(entry => {
    if (entry.type === 'cue' && (entry.sectionId === sectionId || findSectionIdForLayoutIndex(layout, layout.indexOf(entry)) === sectionId)) {
      return { ...entry, sectionId: fallbackSection.id };
    }
    return entry;
  });
  layout = removeSectionFromLayout(layout, sectionId);
  sections = sections.filter(section => section.id !== sectionId);
  layout = repairWorkspace({ version: 2, sections, cues, layout }).layout;
  await saveCuesToFile();
  return true;
}

// Resets the in-memory cues to an empty array. Does NOT automatically save.
async function resetCues() {
  logger.info('CueManager: resetCues() called. Current cues length:', cues.length);
  const empty = migrateToV2([]);
  cues = empty.cues;
  sections = empty.sections;
  layout = empty.layout;
  logger.info('CueManager: Cues array now empty. Length:', cues.length);
  await saveCuesToFile();
  logger.info('CueManager: After saveCuesToFile in resetCues.');
}

function generateUUID() {
  return uuidv4();
}

// websocketServerInstance is injected to allow broadcasting updates
// mainWindow is injected to allow sending IPC to renderer
// httpServer is injected for remote control updates
async function initialize(wssInstance, mainWin, httpServerRef) {
  websocketServerInstance = wssInstance;
  mainWindowRef = mainWin; // Store mainWindow reference
  httpServerInstance = httpServerRef; // Added: Store httpServer reference
  await loadCuesFromFile(); // Load cues asynchronously

  // Post-load processing for durations
  let durationsChanged = false;
  const processedCues = [...cues]; // Work on a copy to modify
  const workspaceDir = getWorkspaceDirectory();

  for (let i = 0; i < processedCues.length; i++) {
    const cue = processedCues[i];
    if (cue.type === 'single_file' && cue.filePath && (!cue.knownDuration || cue.knownDuration <= 0)) {
      logger.info(`CueManager Init: Processing duration for single file cue ${cue.id} - Path: ${cue.filePath}`);
      const duration = await getAudioFileDuration(cue.filePath, workspaceDir);
      if (duration && duration > 0) {
        processedCues[i] = { ...cue, knownDuration: duration };
        durationsChanged = true;
        logger.info(`CueManager Init: Updated knownDuration to ${duration} for cue ${cue.id}`);
      }
    } else if (cue.type === 'playlist' && cue.playlistItems && cue.playlistItems.length > 0) {
      let playlistItemsChanged = false;
      const updatedPlaylistItems = [...cue.playlistItems]; // Work on a copy

      for (let j = 0; j < updatedPlaylistItems.length; j++) {
        const item = updatedPlaylistItems[j];
        if (item.path && (!item.knownDuration || item.knownDuration <= 0)) {
          logger.info(`CueManager Init: Processing duration for playlist item ${item.path} in cue ${cue.id}`);
          const itemDuration = await getAudioFileDuration(item.path, workspaceDir);
          if (itemDuration && itemDuration > 0) {
            updatedPlaylistItems[j] = { ...item, knownDuration: itemDuration };
            playlistItemsChanged = true;
            logger.info(`CueManager Init: Updated knownDuration to ${itemDuration} for item ${item.path} in cue ${cue.id}`);
          }
        }
      }
      if (playlistItemsChanged) {
        processedCues[i] = { ...cue, playlistItems: updatedPlaylistItems };
        durationsChanged = true;
      }
    }
  }

  if (durationsChanged) {
    cues = processedCues; // Assign the modified array back to the module-level 'cues'
    logger.info("CueManager Init: Durations updated for some cues during initialization. Saving and notifying renderer.");
    await saveCuesToFile(); // This will also broadcast to companion

    if (mainWindowRef && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
      logger.info("CueManager Init: Sending 'cues-updated-from-main' to renderer due to duration processing.");
      mainWindowRef.webContents.send('cues-updated-from-main', getWorkspaceSnapshot());
    }
  } else {
    logger.info("CueManager Init: No durations needed updating during initialization.");
  }
}

async function deleteCue(cueId) {
  const initialLength = cues.length;
  cues = cues.filter(cue => cue.id !== cueId);
  if (cues.length < initialLength) {
    layout = removeCueFromLayout(layout, cueId);
    await saveCuesToFile();
    logger.info(`Cue with ID ${cueId} deleted.`);
    return true;
  }
  logger.info(`Cue with ID ${cueId} not found for deletion.`);
  return false;
}

async function deleteCues(cueIds) {
  if (!Array.isArray(cueIds) || cueIds.length === 0) {
    return [];
  }

  const idSet = new Set(cueIds.filter(Boolean));
  const deleted = cues.filter(cue => idSet.has(cue.id)).map(cue => cue.id);
  if (deleted.length === 0) {
    return [];
  }

  const deletedSet = new Set(deleted);
  cues = cues.filter(cue => !deletedSet.has(cue.id));
  deleted.forEach(cueId => {
    layout = removeCueFromLayout(layout, cueId);
  });

  await saveCuesToFile();
  logger.info(`Deleted ${deleted.length} cue(s).`);
  return deleted;
}

// New function to update known duration of a cue
async function updateCueKnownDuration(cueId, duration) {
  logger.info(`CueManager: Attempting to update knownDuration for cue ${cueId} with duration ${duration}.`);
  const cueIndex = cues.findIndex(c => c.id === cueId);
  if (cueIndex !== -1) {
    logger.info(`CueManager: Found cue ${cueId} at index ${cueIndex}. Current knownDuration: ${cues[cueIndex].knownDuration}`);
    // Only update if duration is a positive number and different or not set
    if (duration > 0 && cues[cueIndex].knownDuration !== duration) {
      cues[cueIndex].knownDuration = duration;
      logger.info(`CueManager: Updated knownDuration for cue ${cueId} to ${duration}. Triggering save.`);
      const success = await saveCuesToFile();
      if (success) { // Check if save was successful
        if (mainWindowRef && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
          logger.info(`CueManager (updateCueKnownDuration): Sending 'cues-updated-from-main' to renderer.`);
          mainWindowRef.webContents.send('cues-updated-from-main', getWorkspaceSnapshot());
        }
      }
      return true;
    } else {
      logger.info(`CueManager: Did not update knownDuration for ${cueId}. Reason: duration not positive (${duration > 0}) or not different (${cues[cueIndex].knownDuration !== duration}).`);
      return false; // Duration not updated (e.g., same or invalid)
    }
  } else {
    logger.warn(`CueManager: Cue with ID ${cueId} not found to update knownDuration.`);
    return false;
  }
}

// ***** NEW FUNCTION *****
// Function to trigger a cue by its ID
function triggerCueById(cueId, source = 'unknown') {
  logger.info(`CueManager: triggerCueById called for ID: ${cueId}, Source: ${source}`);
  const cue = cues.find(c => c.id === cueId);

  if (cue) {
    logger.info(`CueManager: Found cue "${cue.name}" to trigger.`);
    if (mainWindowRef && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
      logger.info(`CueManager: Sending 'trigger-cue-by-id-from-main' to renderer for cue ${cueId}`);
      mainWindowRef.webContents.send('trigger-cue-by-id-from-main', { cueId, source });
    } else {
      logger.error('CueManager: mainWindowRef not available or webContents destroyed. Cannot send trigger IPC message.');
    }
  } else {
    logger.warn(`CueManager: Cue with ID ${cueId} not found for triggering.`);
  }
}

// Mixer trigger function removed

async function addOrUpdateProcessedCue(cueData, workspacePath, options = {}) {
  logger.info(`[CueManager] addOrUpdateProcessedCue received raw cueData. ID: ${cueData.id}, Name: ${cueData.name}`);
  const layoutOptions = cueData._layoutOptions || null;
  const cleanCueData = { ...cueData };
  delete cleanCueData._layoutOptions;

  const cueId = cleanCueData.id || generateUUID();
  const existingCueIndex = cues.findIndex(c => c.id === cueId);
  let isNew = true;
  if (existingCueIndex !== -1) {
    isNew = false;
  }

  const existingCue = existingCueIndex !== -1 ? cues[existingCueIndex] : null;
  const mergedCueData = existingCue ? { ...existingCue, ...cleanCueData } : cleanCueData;

  const retriggerOverride = Object.prototype.hasOwnProperty.call(cleanCueData, 'retriggerBehavior')
    ? normalizeRetriggerBehaviorOverride(cleanCueData.retriggerBehavior)
    : normalizeRetriggerBehaviorOverride(existingCue?.retriggerBehavior);

  const workspaceDir = workspacePath || getWorkspaceDirectory();

  const baseCue = {
    id: cueId,
    name: mergedCueData.name || 'Unnamed Cue',
    type: mergedCueData.type || 'single_file',
    filePath: mergedCueData.filePath || null,
    volume: mergedCueData.volume !== undefined ? mergedCueData.volume : 1,
    fadeInTime: mergedCueData.fadeInTime || 0,
    fadeOutTime: mergedCueData.fadeOutTime || 0,
    loop: mergedCueData.loop || false,
    retriggerBehavior: retriggerOverride,
    knownDuration: mergedCueData.knownDuration || 0,
    playlistItems: mergedCueData.playlistItems || [],
    shuffle: mergedCueData.shuffle || false,
    repeatOne: mergedCueData.repeatOne || false,
    playlistPlayMode: mergedCueData.playlistPlayMode || 'continue',
    trimStartTime: (mergedCueData.trimStartTime !== undefined && mergedCueData.trimStartTime !== null) ? mergedCueData.trimStartTime : 0,
    trimEndTime: (mergedCueData.trimEndTime !== undefined && mergedCueData.trimEndTime !== null) ? mergedCueData.trimEndTime : undefined,
    enableDucking: mergedCueData.enableDucking !== undefined ? mergedCueData.enableDucking : false,
    duckingLevel: mergedCueData.duckingLevel !== undefined ? mergedCueData.duckingLevel : 80,
    isDuckingTrigger: mergedCueData.isDuckingTrigger !== undefined ? mergedCueData.isDuckingTrigger : false,
    buttonColor: mergedCueData.buttonColor || null,
    showButtonWaveform: mergedCueData.showButtonWaveform === true
        ? true
        : (mergedCueData.showButtonWaveform === false ? false : null),
  };

  const normalizedCue = normalizeCueAudioPaths(baseCue, workspaceDir);
  Object.assign(baseCue, normalizedCue);

  // Ensure playlist items have unique IDs and knownDurations if not present
  if (baseCue.type === 'playlist' && baseCue.playlistItems) {
    baseCue.playlistItems.forEach(item => {
      if (!item.id) {
        item.id = generateUUID();
      }
      if (item.knownDuration === undefined || item.knownDuration === null || typeof item.knownDuration !== 'number' || item.knownDuration <= 0) {
        item.knownDuration = 0;
      }
    });
  }

  // IMMEDIATE DURATION DETECTION
  let durationsDetected = false;

  // For single file cues
  if (baseCue.type === 'single_file' && baseCue.filePath && (!baseCue.knownDuration || baseCue.knownDuration <= 0)) {
    logger.info(`CueManager: Detecting duration for new single file cue ${baseCue.id}`);
    try {
      const duration = await getAudioFileDuration(baseCue.filePath, workspaceDir);
      if (duration && duration > 0) {
        baseCue.knownDuration = duration;
        durationsDetected = true;
        logger.info(`CueManager: Detected knownDuration ${duration}`);
      }
    } catch (error) {
      logger.error(`CueManager: Error detecting duration:`, error);
    }
  }

  // For playlist cues
  if (baseCue.type === 'playlist' && baseCue.playlistItems) {
    for (let i = 0; i < baseCue.playlistItems.length; i++) {
      const item = baseCue.playlistItems[i];
      if (item.path && (!item.knownDuration || item.knownDuration <= 0)) {
        logger.info(`CueManager: Detecting duration for playlist item ${item.path}`);
        try {
          const itemDuration = await getAudioFileDuration(item.path, workspaceDir);
          if (itemDuration && itemDuration > 0) {
            baseCue.playlistItems[i].knownDuration = itemDuration;
            durationsDetected = true;
            logger.info(`CueManager: Detected knownDuration ${itemDuration}`);
          }
        } catch (error) {
          logger.error(`CueManager: Error detecting duration:`, error);
        }
      }
    }
  }

  if (isNew) {
    cues.push(baseCue);
    if (layoutOptions?.sectionId) {
      layout = insertCueInLayout(
        layout,
        cueId,
        layoutOptions.sectionId,
        layoutOptions.insertBeforeCueId || null
      );
    } else {
      layout = appendCueToDefaultSection(layout, sections, cueId);
    }
    logger.info(`[CueManager] Added new cue.`);
  } else {
    cues[existingCueIndex] = baseCue;
    logger.info(`[CueManager] Updated existing cue.`);
  }

  // Save and notify renderer/remotes with full workspace snapshot (sections + layout).
  await saveCuesToFile(options.silentSave === true);

  // Return a copy of the processed cue
  const finalCueIndex = isNew ? cues.length - 1 : existingCueIndex;
  return { ...cues[finalCueIndex] };
}

// New function to update duration for a single cue or a specific playlist item
async function updateCueItemDuration(cueId, duration, playlistItemId = null) {
  if (playlistItemId) {
    // Update duration for a specific playlist item
    const cueIndex = cues.findIndex(c => c.id === cueId);
    if (cueIndex === -1) {
      logger.warn(`CueManager: Cue with ID ${cueId} not found to update playlist item duration.`);
      return false;
    }
    if (cues[cueIndex].type !== 'playlist' || !cues[cueIndex].playlistItems) {
      logger.warn(`CueManager: Cue ${cueId} is not a playlist or has no items.`);
      return false;
    }
    const itemIndex = cues[cueIndex].playlistItems.findIndex(item => item.id === playlistItemId);
    if (itemIndex === -1) {
      logger.warn(`CueManager: Playlist item with ID ${playlistItemId} not found in cue ${cueId}.`);
      return false;
    }

    const existingItem = cues[cueIndex].playlistItems[itemIndex];
    const currentItemKnownDuration = existingItem.knownDuration;

    const isValidNewDuration = duration && typeof duration === 'number' && duration > 0;
    let shouldUpdate = false;

    if (isValidNewDuration) {
      if (currentItemKnownDuration === undefined || currentItemKnownDuration === null || typeof currentItemKnownDuration !== 'number') {
        shouldUpdate = true;
      } else if (Math.abs(currentItemKnownDuration - duration) > 0.01) {
        shouldUpdate = true;
      }
    }

    if (shouldUpdate) {
      cues[cueIndex].playlistItems[itemIndex].knownDuration = duration;
      logger.info(`CueManager: Updated knownDuration for playlist item ${playlistItemId}.`);
      const success = await saveCuesToFile();
      if (success) { // Check if save was successful
        if (mainWindowRef && mainWindowRef.webContents && !mainWindowRef.webContents.isDestroyed()) {
          logger.info(`CueManager (updateCueItemDuration): Sending 'cues-updated-from-main' to renderer.`);
          mainWindowRef.webContents.send('cues-updated-from-main', getWorkspaceSnapshot());
        }
      }
      return true;
    } else {
      logger.info(`CueManager: Did not update knownDuration for playlist item ${playlistItemId}.`);
      return false;
    }
  } else {
    // Update duration for a single cue (no playlistItemId provided)
    return updateCueKnownDuration(cueId, duration);
  }
}

// Function to get the default cues file path
function getDefaultCuesPath() {
  return path.join(app.getPath('userData'), CUES_FILE_NAME);
}

function getCuesFilePath() {
  return currentCuesFilePath;
}

function getWorkspaceDirectory() {
  return path.dirname(currentCuesFilePath);
}

module.exports = {
  initialize,
  setCuesDirectory,
  loadCuesFromFile,
  saveCuesToFile,
  getCues,
  getCuesInLayoutOrder,
  getCueById,
  getSections,
  getLayout,
  getWorkspaceSnapshot,
  applyWorkspaceSnapshot,
  setCues,
  setWorkspace,
  addSection,
  updateSection,
  deleteSection,
  addOrUpdateProcessedCue,
  resetCues,
  generateUUID,
  deleteCue,
  deleteCues,
  updateCueKnownDuration,
  updateCueItemDuration,
  triggerCueById,
  getDefaultCuesPath,
  getCuesFilePath,
  getWorkspaceDirectory
};
