// background.js – работа с фоновым изображением
import { getCy } from './core.js';

let bgImageWidth = null;
let bgImageHeight = null;
let backgroundLoaded = false;
let elementsLoaded = false;
let pendingFit = false;
let skipAutoFit = false;
// Пользователь начал взаимодействовать с картой (скролл/зум/перетаскивание) —
// значит начальный авто-фит применять уже нельзя, иначе будет «телепортация».
let userInteracted = false;

export function markUserInteracted() { userInteracted = true; }
export function resetUserInteracted() { userInteracted = false; }

export function setSkipAutoFit(value) { skipAutoFit = value; window._skipAutoFit = value;}
export function setElementsLoaded(loaded) { elementsLoaded = loaded; checkReadyAndFit(); }
export function setBackgroundLoaded(loaded) { backgroundLoaded = loaded; checkReadyAndFit(); }
export function setPendingFit(value) { pendingFit = value; }

export function getBgDimensions() { return { width: bgImageWidth, height: bgImageHeight }; }
export function getBgImageSize() { return { width: bgImageWidth, height: bgImageHeight }; } // для элементов
export function isElementsLoaded() { return elementsLoaded; }

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

// Базовый шаг сетки в координатах карты (см. .cy-canvas в style.css)
const GRID_STEP = 25;

export function updateBackgroundTransform() {
    const cy = getCy();
    if (!cy) return;

    const pan = cy.pan();
    const zoom = cy.zoom();

    // Сетка нарисована CSS-фоном на контейнере #cy. Привязываем её к мировым
    // координатам карты: шаг ячейки масштабируется зумом, а начало отсчёта
    // следует за pan. Иначе сетка статична на экране (всегда 25px) и не
    // совпадает с устройствами при панораме/зуме.
    const cyEl = cy.container();
    if (cyEl) {
        const cell = GRID_STEP * zoom;
        // При отдалении ячейки мельчают и плотные точки рябят. Плавно гасим
        // прозрачность точек с уменьшением шага (через color-mix), а при шаге
        // < ~7px прячем сетку совсем. При приближении — точки полные.
        const alpha = Math.max(0, Math.min(1, (cell - 7) / (GRID_STEP - 7)));
        cyEl.style.backgroundSize = `${cell}px ${cell}px`;
        cyEl.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
        cyEl.style.backgroundImage = alpha <= 0
            ? 'none'
            : `radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--cy-grid) ${Math.round(alpha * 100)}%, transparent) 1px, transparent 1px)`;
    }

    // Фото-подложка (если задана) едет тем же трансформом
    const bgEl = document.getElementById('cy-background');
    if (!bgEl) return;
    if (!bgImageWidth || !bgImageHeight) {
        bgEl.style.transform = 'none';
        return;
    }
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
    if (!cy) return;
    
    // Если есть фоновое изображение - используем его размеры
    if (bgImageWidth && bgImageHeight) {
        const container = document.getElementById('cy').getBoundingClientRect();
        const zoom = Math.min(container.width / bgImageWidth, container.height / bgImageHeight) * 0.95;
        const panX = (container.width / zoom - bgImageWidth) / 2;
        const panY = (container.height / zoom - bgImageHeight) / 2;
        cy.viewport({ pan: { x: panX, y: panY }, zoom });
        updateBackgroundTransform();
        enforcePanBounds();
    } else {
        // Если фона нет - просто фитим контент
        cy.fit(null, 50);
    }
}

function checkReadyAndFit() {
    // Если пользователь уже начал взаимодействовать с картой до конца загрузки —
    // не трогаем вьюпорт (иначе резкая «телепортация» на подогнанную позицию).
    if (userInteracted) return;
    if (!skipAutoFit && backgroundLoaded && elementsLoaded && !pendingFit) {
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

export function updateMapBackground(background) {
    const bgEl = document.getElementById('cy-background');
    if (!bgEl) return;
    if (background) {
        bgEl.dataset.background = background;
        loadBackground(background);
    } else {
        bgEl.dataset.background = '';
        bgEl.style.backgroundImage = 'none';
        bgEl.classList.remove('has-image');
        bgImageWidth = null;
        bgImageHeight = null;
        setBackgroundLoaded(true);
        const cy = getCy();
        if (cy) {
            cy.fit(null, 50);
        }
    }
}
window.setSkipAutoFit = setSkipAutoFit;