/** Visual gap placeholders during cue drag-reorder (pushes grid items aside). */

export function createDragGapState() {
    return { placeholders: [], dropIntent: null };
}

let activeDragGapState = null;

export function beginDragGap(slotCount = 1) {
    endDragGap();
    activeDragGapState = createDragGapState();
    activeDragGapState.slotCount = Math.max(1, slotCount);
    return activeDragGapState;
}

export function getDragGapState() {
    return activeDragGapState;
}

export function endDragGap() {
    if (activeDragGapState) {
        clearDragGapPlaceholders(activeDragGapState);
        activeDragGapState.dropIntent = null;
    }
    activeDragGapState = null;
}

export function clearDragGapPlaceholders(state = activeDragGapState) {
    if (!state?.placeholders?.length) return;
    state.placeholders.forEach((node) => node.remove());
    state.placeholders = [];
}

function isSameDropIntent(current, next) {
    if (!current || !next || current.parent !== next.parent) return false;
    if (current.insertionIndex !== undefined && next.insertionIndex !== undefined) {
        return current.insertionIndex === next.insertionIndex;
    }
    return current.refNode === next.refNode && current.insertBefore === next.insertBefore;
}

export function updateDragGapAt(state, {
    parent,
    refNode = null,
    insertBefore = true,
    slotCount = 1,
    insertionIndex,
    className = 'cue-drag-gap-placeholder'
} = {}) {
    if (!state || !parent) return;

    const count = Math.max(1, slotCount);
    const nextIntent = {
        parent,
        refNode,
        insertBefore,
        ...(insertionIndex !== undefined ? { insertionIndex } : {})
    };

    if (isSameDropIntent(state.dropIntent, nextIntent) && state.placeholders.length === count) {
        return;
    }

    clearDragGapPlaceholders(state);
    state.dropIntent = nextIntent;
    for (let i = 0; i < count; i += 1) {
        const placeholder = document.createElement('div');
        placeholder.className = className;
        placeholder.setAttribute('aria-hidden', 'true');
        state.placeholders.push(placeholder);
    }

    if (!refNode) {
        state.placeholders.forEach((placeholder) => parent.appendChild(placeholder));
        return;
    }

    if (insertBefore) {
        let insertPoint = refNode;
        state.placeholders.forEach((placeholder) => {
            parent.insertBefore(placeholder, insertPoint);
            insertPoint = placeholder.nextSibling;
        });
        return;
    }

    let insertPoint = refNode.nextSibling;
    state.placeholders.forEach((placeholder) => {
        parent.insertBefore(placeholder, insertPoint);
        insertPoint = placeholder.nextSibling;
    });
}

export function applyDragGapFromTarget(state, {
    parent,
    targetElement,
    clientX,
    slotCount = 1,
    className = 'cue-drag-gap-placeholder'
} = {}) {
    if (!state || !parent || !targetElement) return;
    const rect = targetElement.getBoundingClientRect();
    const insertBefore = clientX < rect.left + rect.width / 2;
    updateDragGapAt(state, {
        parent,
        refNode: targetElement,
        insertBefore,
        slotCount,
        className
    });
}

/** Insert dragged items at the last recorded gap position. Returns true if applied. */
export function applyItemsAtDropIntent(items, callbacks, state = activeDragGapState) {
    if (!state?.dropIntent || !items?.length || !callbacks) return false;

    const { parent, refNode, insertBefore } = state.dropIntent;
    const { insertBefore: insertBeforeFn, insertAfter: insertAfterFn, append: appendFn } = callbacks;

    if (!refNode) {
        appendFn(parent, items);
    } else if (insertBefore) {
        insertBeforeFn(parent, items, refNode);
    } else {
        insertAfterFn(parent, items, refNode);
    }
    return true;
}
