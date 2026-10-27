/**
 * resync.js — отложенная перезагрузка карты после реконнекта сокета.
 *
 * Полная перезагрузка элементов (loadElements) пересоздаёт граф: сбрасывает
 * выделение, рвёт перетаскивание узла и режим создания связи. Поэтому после
 * реконнекта она выполняется только когда пользователь «свободен»; пока он
 * занят — актуальные статусы всё равно приходят через request_status, а
 * структура карты обновится сразу после паузы.
 */
import { isSelfUpdating } from '../utils/state.js';

const POLL_MS = 1000;
const POST_DRAG_GRACE_MS = 1500; // даём дойти debounce-сохранению позиции
const SELECTION_TTL_MS = 30000;

let cyRef = null;
let extraBusy = () => false;
let dragging = false;
let lastFreeAt = 0;
let pendingReload = null;
let pollTimer = null;
let savedSelection = null;

export function isMapBusy() {
    if (dragging) return true;
    if (Date.now() - lastFreeAt < POST_DRAG_GRACE_MS) return true;
    if (isSelfUpdating()) return true;
    if (extraBusy()) return true;
    return typeof document !== 'undefined' && !!document.querySelector('.modal.show');
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function tryFlush() {
    if (!pendingReload) {
        stopPolling();
        return;
    }
    if (isMapBusy()) {
        if (!pollTimer) pollTimer = setInterval(tryFlush, POLL_MS);
        return;
    }
    const run = pendingReload;
    pendingReload = null;
    stopPolling();
    if (cyRef) {
        savedSelection = { ids: cyRef.$(':selected').map(el => el.id()), ts: Date.now() };
    }
    run();
}

/** Запросить перезагрузку: выполнится сразу или после паузы в действиях. */
export function scheduleResync(reload) {
    pendingReload = reload; // несколько запросов подряд схлопываются в один
    tryFlush();
}

function restoreSelection() {
    const saved = savedSelection;
    savedSelection = null;
    if (!saved || !cyRef || !saved.ids.length) return;
    if (Date.now() - saved.ts > SELECTION_TTL_MS) return;
    cyRef.batch(() => {
        saved.ids.forEach(id => {
            const el = cyRef.getElementById(id);
            if (el.length) el.select();
        });
    });
}

/** Возвращает функцию очистки (для registerMapCleanup). */
export function initResync(cy, { isExtraBusy } = {}) {
    cyRef = cy;
    extraBusy = isExtraBusy || (() => false);
    dragging = false;
    lastFreeAt = 0;

    const onGrab = () => { dragging = true; };
    const onFree = () => { dragging = false; lastFreeAt = Date.now(); };
    cy.on('grab', 'node', onGrab);
    cy.on('free', 'node', onFree);
    window.addEventListener('elements:loaded', restoreSelection);

    return function cleanupResync() {
        cy.off('grab', 'node', onGrab);
        cy.off('free', 'node', onFree);
        window.removeEventListener('elements:loaded', restoreSelection);
        stopPolling();
        pendingReload = null;
        savedSelection = null;
        dragging = false;
        if (cyRef === cy) cyRef = null;
    };
}
