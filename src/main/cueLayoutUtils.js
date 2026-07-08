const { v4: uuidv4 } = require('uuid');

const WORKSPACE_VERSION = 2;

function createDefaultSection(title = 'Cues') {
    return {
        id: uuidv4(),
        title,
        collapsed: false
    };
}

function createEmptyWorkspace() {
    const section = createDefaultSection();
    return {
        version: WORKSPACE_VERSION,
        sections: [section],
        cues: [],
        layout: [{ type: 'section', sectionId: section.id }]
    };
}

function migrateToV2(data) {
    if (data && data.version === WORKSPACE_VERSION && Array.isArray(data.cues)) {
        return repairWorkspace(data);
    }
    if (Array.isArray(data)) {
        const section = createDefaultSection();
        return {
            version: WORKSPACE_VERSION,
            sections: [section],
            cues: data,
            layout: [
                { type: 'section', sectionId: section.id },
                ...data.map(cue => ({ type: 'cue', cueId: cue.id }))
            ]
        };
    }
    return createEmptyWorkspace();
}

function repairWorkspace(workspace) {
    const sections = Array.isArray(workspace.sections) ? workspace.sections.map(section => ({
        id: section.id || uuidv4(),
        title: section.title || 'Section',
        collapsed: !!section.collapsed
    })) : [];

    const cues = Array.isArray(workspace.cues) ? workspace.cues : [];
    let layout = Array.isArray(workspace.layout) ? workspace.layout.filter(entry => {
        if (entry.type === 'section') return sections.some(s => s.id === entry.sectionId);
        if (entry.type === 'cue') return cues.some(c => c.id === entry.cueId);
        return false;
    }) : [];

    if (sections.length === 0) {
        sections.push(createDefaultSection());
    }

    const sectionIdsInLayout = new Set(
        layout.filter(entry => entry.type === 'section').map(entry => entry.sectionId)
    );
    sections.forEach(section => {
        if (!sectionIdsInLayout.has(section.id)) {
            layout.unshift({ type: 'section', sectionId: section.id });
        }
    });

    const cueIdsInLayout = new Set(
        layout.filter(entry => entry.type === 'cue').map(entry => entry.cueId)
    );
    const defaultSectionId = sections[0].id;
    cues.forEach(cue => {
        if (!cueIdsInLayout.has(cue.id)) {
            layout.push({ type: 'cue', cueId: cue.id, sectionId: defaultSectionId });
        }
    });

    layout = layout.map(entry => {
        if (entry.type !== 'cue') return entry;
        if (entry.sectionId) return entry;
        return { ...entry, sectionId: findSectionIdForLayoutIndex(layout, layout.indexOf(entry)) || defaultSectionId };
    });

    return {
        version: WORKSPACE_VERSION,
        sections,
        cues,
        layout
    };
}

function findSectionIdForLayoutIndex(layout, index) {
    for (let i = index; i >= 0; i--) {
        if (layout[i]?.type === 'section') return layout[i].sectionId;
    }
    return null;
}

function getOrderedCueIds(layout) {
    return layout.filter(entry => entry.type === 'cue').map(entry => entry.cueId);
}

function removeCueFromLayout(layout, cueId) {
    return layout.filter(entry => !(entry.type === 'cue' && entry.cueId === cueId));
}

function removeSectionFromLayout(layout, sectionId) {
    return layout.filter(entry => !(entry.type === 'section' && entry.sectionId === sectionId));
}

function insertCueInLayout(layout, cueId, sectionId, insertBeforeCueId = null) {
    const nextLayout = layout.filter(entry => !(entry.type === 'cue' && entry.cueId === cueId));
    const sectionIndex = nextLayout.findIndex(entry => entry.type === 'section' && entry.sectionId === sectionId);
    if (sectionIndex === -1) {
        nextLayout.push({ type: 'section', sectionId });
        nextLayout.push({ type: 'cue', cueId, sectionId });
        return nextLayout;
    }

    let insertIndex = sectionIndex + 1;
    while (insertIndex < nextLayout.length && nextLayout[insertIndex].type === 'cue') {
        const entrySectionId = nextLayout[insertIndex].sectionId || findSectionIdForLayoutIndex(nextLayout, insertIndex);
        if (entrySectionId !== sectionId) break;
        if (insertBeforeCueId && nextLayout[insertIndex].cueId === insertBeforeCueId) break;
        insertIndex++;
    }

    nextLayout.splice(insertIndex, 0, { type: 'cue', cueId, sectionId });
    return nextLayout;
}

function appendCueToDefaultSection(layout, sections, cueId) {
    const sectionId = sections[0]?.id;
    if (!sectionId) return layout;
    return insertCueInLayout(layout, cueId, sectionId);
}

function rebuildLayoutFromStructure(sections, layoutEntries) {
    const nextLayout = [];
    sections.forEach(section => {
        nextLayout.push({ type: 'section', sectionId: section.id });
        layoutEntries
            .filter(entry => entry.type === 'cue' && entry.sectionId === section.id)
            .forEach(entry => nextLayout.push({ type: 'cue', cueId: entry.cueId, sectionId: section.id }));
    });
    return nextLayout;
}

function layoutFromDomOrder(sections, orderedEntries) {
    const sectionMap = new Map(sections.map(section => [section.id, section]));
    const nextLayout = [];
    orderedEntries.forEach(entry => {
        if (entry.type === 'section' && sectionMap.has(entry.sectionId)) {
            nextLayout.push({ type: 'section', sectionId: entry.sectionId });
        } else if (entry.type === 'cue') {
            nextLayout.push({
                type: 'cue',
                cueId: entry.cueId,
                sectionId: entry.sectionId
            });
        }
    });
    return rebuildLayoutFromStructure(sections, nextLayout.filter(entry => entry.type === 'cue'));
}

function sanitizeSectionPatch(patch = {}) {
    const sanitized = {};
    if (patch.title !== undefined) {
        sanitized.title = String(patch.title || 'Section').trim().slice(0, 120) || 'Section';
    }
    if (patch.collapsed !== undefined) {
        sanitized.collapsed = !!patch.collapsed;
    }
    return sanitized;
}

function sanitizeSection(section) {
    return {
        id: section.id || uuidv4(),
        title: String(section.title || 'Section').trim().slice(0, 120) || 'Section',
        collapsed: !!section.collapsed
    };
}

module.exports = {
    WORKSPACE_VERSION,
    createDefaultSection,
    createEmptyWorkspace,
    migrateToV2,
    repairWorkspace,
    getOrderedCueIds,
    removeCueFromLayout,
    removeSectionFromLayout,
    insertCueInLayout,
    appendCueToDefaultSection,
    rebuildLayoutFromStructure,
    layoutFromDomOrder,
    sanitizeSectionPatch,
    sanitizeSection,
    findSectionIdForLayoutIndex
};
