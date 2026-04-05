// background.js – работа с фоновым изображением
import { getCy } from './core.js';

let bgImageWidth = null;
let bgImageHeight = null;
let backgroundLoaded = false;
let elementsLoaded = false;
let pendingFit = false;

export function setElementsLoaded(loaded) { elementsLoaded = loaded; checkReadyAndFit(); }
export function setBackgroundLoaded(loaded) { backgroundLoaded = loaded; checkReadyAndFit(); }
export function setPendingFit(value) { pendingFit = value; }

export function getBgDimensions() { return { width: bgImageWidth, height: bgImageHeight }; }
export function getBgImageSize() { return { width: bgImageWidth, height: bgImageHeight }; } // для элементов

export function loadBackground(bgUrl) {
    if (!bgUrl) {
        setBackgroundLoaded(true);
        return;
    }
    const img = new Image();
    img.onload = () => {
        bgImageWidth = img.naturalWidth;
        bgImageHeight = img.naturalHeight;
        const bgEl = document.getElementById('cy-background');
        if (bgEl) {
            bgEl.style.backgroundImage = `url(/static/uploads/maps/${bgUrl})`;
            bgEl.style.backgroundSize = `${bgImageWidth}px ${bgImageHeight}px`;
            bgEl.style.width = `${bgImageWidth}px`;
            bgEl.style.height = `${bgImageHeight}px`;
            bgEl.classList.add('has-image');
        }
        setBackgroundLoaded(true);
    };
    img.onerror = () => {
        console.error('Failed to load background');
        setBackgroundLoaded(true);
    };
    img.src = `/static/uploads/maps/${bgUrl}`;
}

export function updateBackgroundTransform() {
    const cy = getCy();
    if (!cy) return;
    const bgEl = document.getElementById('cy-background');
    if (!bgEl) return;
    if (!bgImageWidth || !bgImageHeight) {
        bgEl.style.transform = 'none';
        return;
    }
    const pan = cy.pan();
    const zoom = cy.zoom();
    bgEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    bgEl.style.transformOrigin = '0 0';
}

export function enforcePanBounds() {
    const cy = getCy();
    if (!cy || !bgImageWidth || !bgImageHeight) return;
    const zoom = cy.zoom();
    const containerWidth = cy.width();
    const containerHeight = cy.height();
    const scaledImgWidth = bgImageWidth * zoom;
    const scaledImgHeight = bgImageHeight * zoom;
    let minPanX, maxPanX, minPanY, maxPanY;
    if (scaledImgWidth > containerWidth) {
        minPanX = containerWidth - scaledImgWidth;
        maxPanX = 0;
    } else {
        minPanX = (containerWidth - scaledImgWidth) / 2;
        maxPanX = (containerWidth - scaledImgWidth) / 2;
    }
    if (scaledImgHeight > containerHeight) {
        minPanY = containerHeight - scaledImgHeight;
        maxPanY = 0;
    } else {
        minPanY = (containerHeight - scaledImgHeight) / 2;
        maxPanY = (containerHeight - scaledImgHeight) / 2;
    }
    const currentPan = cy.pan();
    const newPanX = Math.min(Math.max(currentPan.x, minPanX), maxPanX);
    const newPanY = Math.min(Math.max(currentPan.y, minPanY), maxPanY);
    if (Math.abs(newPanX - currentPan.x) > 0.5 || Math.abs(newPanY - currentPan.y) > 0.5) {
        cy.pan({ x: newPanX, y: newPanY });
    }
}

export function fitImageToView() {
    const cy = getCy();
    if (!cy || !bgImageWidth || !bgImageHeight) return;
    const container = document.getElementById('cy').getBoundingClientRect();
    const zoom = Math.min(container.width / bgImageWidth, container.height / bgImageHeight) * 0.95;
    const panX = (container.width / zoom - bgImageWidth) / 2;
    const panY = (container.height / zoom - bgImageHeight) / 2;
    cy.viewport({ pan: { x: panX, y: panY }, zoom });
    updateBackgroundTransform();
    enforcePanBounds();
}

function checkReadyAndFit() {
    if (backgroundLoaded && elementsLoaded && !pendingFit) {
        const cyEl = document.getElementById('cy');
        const panX = parseFloat(cyEl.dataset.panX) || 0;
        const panY = parseFloat(cyEl.dataset.panY) || 0;
        const zoom = parseFloat(cyEl.dataset.zoom) || 1;
        if (panX !== 0 || panY !== 0 || zoom !== 1) {
            getCy().viewport({ pan: { x: panX, y: panY }, zoom });
        } else {
            fitImageToView();
        }
        updateBackgroundTransform();
        enforcePanBounds();
    }
}

export function boundNodePosition(pos) {
    if (!bgImageWidth || !bgImageHeight) return pos;
    const margin = 30;
    return {
        x: Math.min(Math.max(pos.x, margin), bgImageWidth - margin),
        y: Math.min(Math.max(pos.y, margin), bgImageHeight - margin)
    };
}