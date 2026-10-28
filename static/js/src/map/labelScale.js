// labelScale.js – масштаб HTML-карточек и canvas-подписей карты.
// HTML-подписи устройств должны масштабироваться вместе с узлом через
// deviceLabelScale(). Подписи рёбер и групп остаются читаемыми на дальнем зуме:
// для них используется labelScale() и пересчёт стилей ниже.
//
// Тот же размер нужен подписям рёбер и рамкам групп, которые рисует холст
// Cytoscape (размеры в единицах графа). Для них стили — функции от zoom, а
// этот модуль пересчитывает их при изменении масштаба (initZoomLabelStyles).
import { registerCleanup } from './moduleRegistry.js';

export const SCALE_MIN = 0.72;       // минимальный коэффициент для canvas-подписей групп
export const EDGE_SCALE_MIN = 0.85;  // подписи рёбер: 9.5px × 0.85 ≈ 8px
export const SCALE_MAX = 1.15;
const SCALE_EXP = 0.7;
// Ниже этого зума подписи портов на рёбрах скрываются: на обзоре они сливаются.
export const EDGE_LABEL_MIN_ZOOM = 0.3;

export const viewState = { zoom: 1 };

/**
 * Жив ли экземпляр Cytoscape и привязан ли он к документу.
 * cy.destroyed() есть в используемой сборке (3.x), но: (а) он не ловит случай,
 * когда контейнер карты убрали из DOM без cy.destroy() — тогда слой подписей и
 * rAF продолжили бы работать с «мёртвым» графом; (б) в других сборках метода
 * может не быть — тогда читаем внутренний флаг. Любая ошибка = «не жив».
 */
export function isCyAlive(cy) {
    if (!cy) return false;
    try {
        const destroyed = typeof cy.destroyed === 'function'
            ? cy.destroyed()
            : Boolean(cy._private && cy._private.destroyed);
        if (destroyed) return false;
        const container = typeof cy.container === 'function' ? cy.container() : null;
        return !container || container.isConnected !== false; // headless: контейнера нет
    } catch (e) {
        return false;
    }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function labelScale(zoom = viewState.zoom, min = SCALE_MIN) {
    return clamp(Math.pow(zoom, SCALE_EXP), min, SCALE_MAX);
}

/** HTML-карточка устройства масштабируется ровно вместе с узлом Cytoscape. */
export function deviceLabelScale(zoom = viewState.zoom) {
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

/** Размер в единицах графа, дающий на экране `px` пикселей × labelScale. */
export function screenPx(px, min = SCALE_MIN, maxFactor = 40) {
    const z = viewState.zoom || 1;
    return px * Math.min(labelScale(z, min) / z, maxFactor);
}

/** Толщина линии: минимум minPx на экране, потолок maxUnits в единицах графа. */
export function minScreenWidth(minPx, maxUnits) {
    const z = viewState.zoom || 1;
    return clamp(minPx / z, minPx, maxUnits);
}

let detach = null;

export function initZoomLabelStyles(cy) {
    cleanup();
    viewState.zoom = cy.zoom();
    let raf = 0;
    let active = true;
    let applied = viewState.zoom;
    const apply = () => {
        raf = 0;
        if (!active) return;
        if (!isCyAlive(cy)) { stop(); return; }
        viewState.zoom = cy.zoom();
        if (Math.abs(viewState.zoom - applied) / applied < 0.002) return;
        applied = viewState.zoom;
        cy.batch(() => {
            cy.edges().updateStyle();
            cy.nodes('[isGroup]').updateStyle();
        });
    };
    const onZoom = () => {
        if (!active) return;
        if (!isCyAlive(cy)) { stop(); return; }
        viewState.zoom = cy.zoom();
        if (!raf) raf = requestAnimationFrame(apply);
    };
    function stop() {
        if (!active) return;
        active = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        try { cy.off('zoom', onZoom); cy.off('destroy', stop); } catch (e) { /* граф уже уничтожен */ }
        if (detach === stop) detach = null;
    }
    cy.on('zoom', onZoom);
    cy.on('destroy', stop);
    detach = stop;
    return stop;
}

export function cleanup() {
    if (detach) detach();
}

registerCleanup(cleanup);
