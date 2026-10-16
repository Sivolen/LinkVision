import { getCy } from './core.js';
import { registerCleanup } from './moduleRegistry.js';

const CREATED_NODE_CLASS = 'cy-node-created';
const CREATED_NODE_HIGHLIGHT_MS = 2500;
const VIEWPORT_EDGE_MARGIN = 48;
const REVEAL_DURATION_MS = 250;

const highlightTimers = new Map();
let trackedCy = null;
let trackedContainer = null;
let interactionVersion = 0;
let revealAnimating = false;

function cancelRevealAnimation() {
    if (!revealAnimating || !trackedCy) return;
    trackedCy.stop(true, false);
    revealAnimating = false;
}

function noteUserInteraction() {
    interactionVersion += 1;
    cancelRevealAnimation();
}

function clearNodeHighlight(id) {
    const timer = highlightTimers.get(id);
    if (timer) clearTimeout(timer);
    highlightTimers.delete(id);

    const node = trackedCy?.getElementById(id);
    if (node?.length) node.removeClass(CREATED_NODE_CLASS);
}

function handleNodeRemoved(event) {
    clearNodeHighlight(String(event.target.id()));
}

function cleanupNewNodeFeedback() {
    if (trackedContainer) {
        trackedContainer.removeEventListener('wheel', noteUserInteraction, true);
        trackedContainer.removeEventListener('pointerdown', noteUserInteraction, true);
        trackedContainer.removeEventListener('touchstart', noteUserInteraction, true);
    }

    if (trackedCy) {
        cancelRevealAnimation();
        trackedCy.off('tap grab drag boxstart', noteUserInteraction);
        trackedCy.off('remove', 'node', handleNodeRemoved);
        trackedCy.nodes('.' + CREATED_NODE_CLASS).removeClass(CREATED_NODE_CLASS);
    }

    highlightTimers.forEach(timer => clearTimeout(timer));
    highlightTimers.clear();
    trackedCy = null;
    trackedContainer = null;
    interactionVersion = 0;
    revealAnimating = false;

    if (window.highlightNewMapNode === highlightNewMapNode) delete window.highlightNewMapNode;
    if (window.revealNewMapNode === revealNewMapNode) delete window.revealNewMapNode;
    if (window.getMapInteractionVersion === getMapInteractionVersion) delete window.getMapInteractionVersion;
}

export function initNewNodeFeedback(cy) {
    cleanupNewNodeFeedback();
    trackedCy = cy;
    trackedContainer = cy.container();

    if (trackedContainer) {
        trackedContainer.addEventListener('wheel', noteUserInteraction, { capture: true, passive: true });
        trackedContainer.addEventListener('pointerdown', noteUserInteraction, { capture: true, passive: true });
        trackedContainer.addEventListener('touchstart', noteUserInteraction, { capture: true, passive: true });
    }
    cy.on('tap grab drag boxstart', noteUserInteraction);
    cy.on('remove', 'node', handleNodeRemoved);

    window.highlightNewMapNode = highlightNewMapNode;
    window.revealNewMapNode = revealNewMapNode;
    window.getMapInteractionVersion = getMapInteractionVersion;
}

export function getMapInteractionVersion() {
    return interactionVersion;
}

export function highlightNewMapNode(nodeId) {
    const cy = getCy();
    if (!cy || cy !== trackedCy) return;

    const id = String(nodeId);
    const node = cy.getElementById(id);
    if (!node.length) return;

    clearNodeHighlight(id);
    node.addClass(CREATED_NODE_CLASS);
    const timer = setTimeout(() => {
        highlightTimers.delete(id);
        const current = cy.getElementById(id);
        if (current.length) current.removeClass(CREATED_NODE_CLASS);
    }, CREATED_NODE_HIGHLIGHT_MS);
    highlightTimers.set(id, timer);
}

export function revealNewMapNode(nodeId, snapshot) {
    const cy = getCy();
    if (!cy || cy !== trackedCy || !snapshot) return;
    if (snapshot.interactionVersion !== null && snapshot.interactionVersion !== interactionVersion) return;

    const pan = cy.pan();
    const zoom = cy.zoom();
    if (Math.abs(zoom - snapshot.zoom) > 0.001
        || Math.abs(pan.x - snapshot.pan.x) > 1
        || Math.abs(pan.y - snapshot.pan.y) > 1) return;

    const node = cy.getElementById(String(nodeId));
    if (!node.length) return;

    const bounds = node.renderedBoundingBox();
    const width = cy.width();
    const height = cy.height();
    const margin = VIEWPORT_EDGE_MARGIN;
    let dx = 0;
    let dy = 0;

    if (bounds.w > width - margin * 2) {
        dx = width / 2 - (bounds.x1 + bounds.x2) / 2;
    } else if (bounds.x1 < margin) {
        dx = margin - bounds.x1;
    } else if (bounds.x2 > width - margin) {
        dx = width - margin - bounds.x2;
    }

    if (bounds.h > height - margin * 2) {
        dy = height / 2 - (bounds.y1 + bounds.y2) / 2;
    } else if (bounds.y1 < margin) {
        dy = margin - bounds.y1;
    } else if (bounds.y2 > height - margin) {
        dy = height - margin - bounds.y2;
    }

    if (!dx && !dy) return;

    revealAnimating = true;
    cy.animate(
        { pan: { x: pan.x + dx, y: pan.y + dy } },
        { duration: REVEAL_DURATION_MS, easing: 'ease-out', complete: () => { revealAnimating = false; } }
    );
}

registerCleanup(cleanupNewNodeFeedback);
