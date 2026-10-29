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
// Подписи портов на рёбрах постепенно появляются после общего обзора карты.
export const EDGE_LABEL_MIN_ZOOM = 0.3;
export const EDGE_LABEL_FULL_ZOOM = 0.5;

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

/** Плавно показывает подписи рёбер в диапазоне масштабов обзора. */
export function edgeLabelOpacity(zoom = viewState.zoom) {
    if (!Number.isFinite(zoom)) return 0;
    return clamp(
        (zoom - EDGE_LABEL_MIN_ZOOM) / (EDGE_LABEL_FULL_ZOOM - EDGE_LABEL_MIN_ZOOM),
        0,
        1
    );
}

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

/**
 * Идёт ли жест (колесо/щипок/перетаскивание карты) или анимация вида. Дорогие
 * пересчёты стилей на это время откладываются: без textureOnViewport каждый кадр
 * жеста — полная перерисовка, и restyle рёбер посреди неё давал рывки по 200+ мс.
 */
export function isViewportGesture(cy) {
    try {
        const r = cy.renderer();
        return Boolean(r && (r.pinching || r.swipePanning || (r.hoverData && r.hoverData.dragging)
            || (r.data && r.data.wheelZooming))) || Boolean(cy.animated && cy.animated());
    } catch (e) {
        return false;
    }
}

let detach = null;

// Пересчёт стилей Cytoscape (подписи рёбер, заголовки и границы групп) — самая
// дорогая операция при зуме: после updateStyle() Cytoscape заново считает стиль и
// размеры подписей КАЖДОГО затронутого ребра (порядка 0.8 мс на ребро), поэтому
// restyle всех рёбер на каждый шаг зума давал секунды работы на сотнях рёбер.
// Что сделано:
//   • масштаб квантуется шагами ZOOM_BUCKET (≈10%): стили зависят от «корзины»,
//     пока масштаб остаётся в ней — ничего не пересчитывается (ошибка размера
//     подписи не больше ~5%, на глаз незаметна);
//   • смена корзины обрабатывается не чаще раза в STYLE_INTERVAL_MS, последняя —
//     после остановки жеста, поэтому итоговый размер всегда точный;
//   • обновляются только рёбра в видимой области (+ запас); остальные помечаются
//     устаревшими (WeakMap) и подтягиваются, когда попадают в кадр (после pan);
//   • пока подписи рёбер скрыты (ниже EDGE_LABEL_MIN_ZOOM) рёбра не трогаем.
export const STYLE_INTERVAL_MS = 140;
const GESTURE_RECHECK_MS = 100;        // период опроса «жест закончился?»
export const ZOOM_BUCKET = 1.1;          // множитель между соседними корзинами
const PAN_SWEEP_MS = 150;                // пауза после pan перед подтягиванием рёбер
const VIEW_MARGIN = 0.15;                // запас вокруг видимой области
// Корзина, для которой ребро стилизовано. Не cy scratch/data: запись scratch в
// Cytoscape инвалидирует стиль элемента (мы измерили ~11 тысяч лишних
// updateStyle за один жест зума), поэтому состояние хранится в WeakMap.
const edgeStamp = new WeakMap();

/** Масштаб, округлённый до ближайшей корзины (логарифмическая шкала). */
export function bucketZoom(zoom) {
    if (!Number.isFinite(zoom) || zoom <= 0) return 1;
    const step = Math.log(ZOOM_BUCKET);
    return Math.exp(Math.round(Math.log(zoom) / step) * step);
}

/** Рёбра в видимой области (с запасом), чей стиль устарел относительно текущей корзины. */
function staleVisibleEdges(cy) {
    const ext = cy.extent();
    const mx = (ext.x2 - ext.x1) * VIEW_MARGIN;
    const my = (ext.y2 - ext.y1) * VIEW_MARGIN;
    const x1 = ext.x1 - mx, x2 = ext.x2 + mx, y1 = ext.y1 - my, y2 = ext.y2 + my;
    const bucket = viewState.zoom;
    return cy.edges().filter(edge => {
        if (edgeStamp.get(edge) === bucket) return false;
        const s = edge.source().position();
        const t = edge.target().position();
        return Math.max(s.x, t.x) >= x1 && Math.min(s.x, t.x) <= x2
            && Math.max(s.y, t.y) >= y1 && Math.min(s.y, t.y) <= y2;
    });
}

export function initZoomLabelStyles(cy) {
    cleanup();
    viewState.zoom = bucketZoom(cy.zoom());
    let timer = 0;
    let sweepTimer = 0;
    let active = true;
    let applied = viewState.zoom;

    const sweep = () => {
        sweepTimer = 0;
        if (!active) return;
        if (!isCyAlive(cy)) { stop(); return; }
        if (isViewportGesture(cy)) { sweepTimer = setTimeout(sweep, GESTURE_RECHECK_MS); return; }
        if (viewState.zoom < EDGE_LABEL_MIN_ZOOM && applied < EDGE_LABEL_MIN_ZOOM) return;
        const stale = staleVisibleEdges(cy);
        if (!stale.length) return;
        stale.forEach(edge => edgeStamp.set(edge, viewState.zoom));
        cy.batch(() => stale.updateStyle());
    };
    const apply = () => {
        timer = 0;
        if (!active) return;
        if (!isCyAlive(cy)) { stop(); return; }
        // Жест ещё идёт — ждём его конца, а не рестайлим рёбра посреди перерисовки.
        if (isViewportGesture(cy)) { timer = setTimeout(apply, GESTURE_RECHECK_MS); return; }
        const bucket = bucketZoom(cy.zoom());
        if (bucket === applied) return;
        const edgesMatter = Math.max(applied, bucket) >= EDGE_LABEL_MIN_ZOOM;
        viewState.zoom = bucket;
        applied = bucket;
        cy.batch(() => { cy.nodes('[isGroup]').updateStyle(); });   // групп мало
        if (edgesMatter) sweep();
    };
    const onZoom = () => {
        if (!active) return;
        if (!isCyAlive(cy)) { stop(); return; }
        if (timer) return;
        // Корзина не изменилась — ничего не планируем (основной случай при зуме).
        if (bucketZoom(cy.zoom()) === applied) return;
        timer = setTimeout(apply, STYLE_INTERVAL_MS);
    };
    const onPan = () => {
        if (!active) return;
        clearTimeout(sweepTimer);
        sweepTimer = setTimeout(sweep, PAN_SWEEP_MS);
    };
    let stampNew = null;
    function stop() {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        clearTimeout(sweepTimer);
        timer = 0;
        sweepTimer = 0;
        try { if (stampNew) cy.off('add', 'edge', stampNew); cy.off('zoom', onZoom); cy.off('pan', onPan); cy.off('destroy', stop); } catch (e) { /* граф уже уничтожен */ }
        if (detach === stop) detach = null;
    }
    // Рёбра получают стиль лениво уже для текущей корзины — помечаем их свежими,
    // иначе первый pan зря перестилизовал бы все рёбра в кадре.
    stampNew = evt => { edgeStamp.set(evt.target, viewState.zoom); };
    cy.edges().forEach(edge => edgeStamp.set(edge, viewState.zoom));
    cy.on('add', 'edge', stampNew);
    cy.on('zoom', onZoom);
    cy.on('pan', onPan);
    cy.on('destroy', stop);
    detach = stop;
    return stop;
}

export function cleanup() {
    if (detach) detach();
}

registerCleanup(cleanup);
