// zoomEmphasis.js – усиление видимости статуса down/partial, деградации
// ICMP-качества (quality_status=bad/degraded при status=up) и результатов
// поиска при отдалении карты. Здоровые устройства получают только тонкую
// зелёную рамку без ауры — иначе статус UP на общем плане выглядит серым.
//
// Проблема: border-width/overlay-padding в styles.js заданы в единицах графа,
// а не в экранных пикселях — при zoom "вписать всю карту" на 200+ устройствах
// (zoom ~0.1–0.2) 3-единичная рамка превращается в доли пикселя на экране и
// физически неразличима. Этот модуль на каждое изменение zoom пересчитывает
// border-width/overlay-padding/overlay-opacity для трёх независимых групп
// узлов — авария (status down/partial), деградация качества и подсветка
// поиска (.cy-node-highlight) — так, чтобы на экране они не становились
// тоньше заданного минимума в px, независимо от того, насколько отдалена
// карта. Здоровые/неподсвеченные узлы не трогаем — их не обязательно
// "видеть" издалека.
import { getCy } from './core.js';
import { registerCleanup } from './moduleRegistry.js';
import { isViewportGesture } from './labelScale.js';

const ZOOM_THRESHOLD = 0.5;   // выше этого зума компенсация не нужна — рамка и так видна
const DARK_DOWN_AURA = '#c85d6d';

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function isDarkTheme() {
    return document.documentElement?.dataset?.theme === 'dark';
}

// Устройство с ВЫКЛЮЧЕННЫМ мониторингом (серое) не подсвечиваем, даже если у
// него status="down": оно "выключено", а не "упало". monitoring_enabled может
// прийти строкой 'false' или булевым false — учитываем оба (как в elements.js).
function isMonitoringOff(n) {
    const m = n.data('monitoring_enabled');
    return m === 'false' || m === false;
}

function isStatusTarget(n) {
    const s = n.data('status');
    return (s === 'down' || s === 'partial') && !isMonitoringOff(n) && n.data('acknowledged') !== true;
}

function isHealthyUpTarget(n) {
    const quality = n.data('quality_status');
    return n.data('status') === 'up' && !isMonitoringOff(n) && quality !== 'bad' && quality !== 'degraded';
}

function isSearchTarget(n) {
    return n.hasClass('cy-node-highlight');
}

// Плохое/сниженное ICMP-качество при status="up" (styles.js:
// node[quality_status="bad"/"degraded"][status="up"]) — устройство отвечает
// на пинг, поэтому status у него не down/partial, но качество (потери,
// задержка, джиттер) деградировало. У этих правил в styles.js тоже
// border-width и overlay-padding в единицах графа — та же
// проблема отдаления, что и у status-аварий.
function isQualityTarget(n) {
    const q = n.data('quality_status');
    return (q === 'bad' || q === 'degraded') && n.data('status') === 'up' && !isMonitoringOff(n);
}

// Независимые группы усиления — свой data-флаг на группу, чтобы
// status-авария, quality-деградация и подсветка поиска не затирали
// состояние друг друга на одном и том же узле (узел вполне может быть
// одновременно, например, quality=bad и найден поиском).
const EMPHASIS_GROUPS = [
    {
        // UP не получает ауру: ему нужна лишь тонкая различимая зелёная
        // рамка, чтобы устройства без иконки не выглядели серыми.
        dataKey: '_zoomEmphasisUp',
        isTarget: isHealthyUpTarget,
        quantizeZoom: true,
        minBorderPx: 1.75,
        baseBorder: 3,
        maxBorderGraphUnits: 10,
        minOverlayPaddingPx: 0,
        baseOverlayPadding: 0,
        maxOverlayPaddingGraphUnits: 0,
        minOverlayOpacity: 0,
        maxOverlayOpacity: 0,
    },
    {
        dataKey: '_zoomEmphasisStatus',
        isTarget: isStatusTarget,
        minBorderPx: 2.5,
        baseBorder: 3,
        maxBorderGraphUnits: 14,
        minOverlayPaddingPx: 3.5,
        baseOverlayPadding: 3,
        maxOverlayPaddingGraphUnits: 22,
        minOverlayOpacity: 0.14,
        maxOverlayOpacity: 0.24,
    },
    {
        // Подсветка результатов поиска (.cy-node-highlight в styles.js) — та же
        // идея, что и для аварий: на сильном отдалении фиксированные border-width:4
        // /overlay-padding:6px из styles.js тоже вырождаются в доли пикселя, и
        // найденное поиском устройство физически не видно на большой карте.
        dataKey: '_zoomEmphasisSearch',
        isTarget: isSearchTarget,
        minBorderPx: 5,
        baseBorder: 4,
        maxBorderGraphUnits: 18,
        minOverlayPaddingPx: 12,
        baseOverlayPadding: 6,
        maxOverlayPaddingGraphUnits: 44,
        minOverlayOpacity: 0.3,
        maxOverlayOpacity: 0.6,
    },
    {
        dataKey: '_zoomEmphasisQuality',
        isTarget: isQualityTarget,
        minBorderPx: 2,
        baseBorder: 3,           // ориентируемся на degraded (3 в styles.js); bad (4) чуть плотнее, но это тот же минимум группы
        maxBorderGraphUnits: 12,
        minOverlayPaddingPx: 2.5,
        baseOverlayPadding: 2,
        maxOverlayPaddingGraphUnits: 18,
        minOverlayOpacity: 0.1,
        maxOverlayOpacity: 0.18,
    },
];

// ── Состояние ────────────────────────────────────────────────────────────────
// Узлы, к которым сейчас применено усиление: id -> { node, groups, style }.
// Нужно, чтобы при зуме обходить только их, а не все узлы карты. Новые цели
// появляются при смене статуса/результатов поиска — тогда вызывается
// refreshZoomEmphasis() (полный проход).
const emphasized = new Map();
let wasEmphasizing = false;
let appliedZoom = NaN;
let activeCy = null;
let zoomHandler = null;
let runTimer = 0;
let zoomFrame = null;
let zoomInterrupted = false;
let destroyHandler = null;
let themeObserver = null;
let elementsLoadedHandler = null;
let viewportReadyHandler = null;

const ZOOM_IDLE_MS = 500;      // короткие паузы между сериями колеса — ещё навигация
const GESTURE_RECHECK_MS = 100;
const HEALTHY_ZOOM_STEP = Math.log(1.2);
const ZOOM_EPSILON = 0.02;      // изменение масштаба меньше 2% — стили те же
const NODES_PER_FRAME = 48;

function groupStyles(zoom) {
    const t = clamp(1 - zoom / ZOOM_THRESHOLD, 0, 1);
    // UP-рамка есть почти у каждого устройства. Фиксируем её ширину в
    // диапазоне масштабов, чтобы небольшие шаги зума не инвалидировали рёбра.
    const healthyZoom = Math.exp(Math.round(Math.log(zoom) / HEALTHY_ZOOM_STEP) * HEALTHY_ZOOM_STEP);
    return EMPHASIS_GROUPS.map(group => ({
        borderWidth: clamp(group.minBorderPx / (group.quantizeZoom ? healthyZoom : zoom), group.baseBorder, group.maxBorderGraphUnits),
        overlayPadding: clamp(group.minOverlayPaddingPx / zoom, group.baseOverlayPadding, group.maxOverlayPaddingGraphUnits),
        // Чем дальше отдалились от порога — тем плотнее гало.
        overlayOpacity: group.minOverlayOpacity + t * (group.maxOverlayOpacity - group.minOverlayOpacity)
    }));
}

// Несколько видов подсветки одного узла объединяются (берём максимум), чтобы они
// не снимали друг друга. Стиль пишем только если значения изменились: каждая
// запись n.style() — событие 'style' для всех подписчиков и перерисовка.
function applyToNode(n, entry, styles, dark, restoreOverlay = false) {
    const active = entry.groups.map(i => styles[i]);
    const borderWidth = Math.max(...active.map(s => s.borderWidth));
    const overlayPadding = Math.max(...active.map(s => s.overlayPadding));
    const overlayOpacity = Math.max(...active.map(s => s.overlayOpacity));
    // На графите обычный #dc3545 даёт слишком жёсткие красные пятна при
    // overview-zoom. Меняем только down-ауру, не жёлтый partial и не
    // рабочий контур устройства на обычном масштабе.
    const overlayColor = dark && n.data('status') === 'down' ? DARK_DOWN_AURA : null;
    const next = {
        'border-width': Number(borderWidth.toFixed(2)),
        'overlay-padding': `${overlayPadding.toFixed(2)}px`,
        'overlay-opacity': Number(overlayOpacity.toFixed(3)),
        'overlay-color': overlayColor
    };
    const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
        value !== entry.style?.[key] || (restoreOverlay && (key === 'overlay-color' || key === 'overlay-opacity'))
    ));
    if (!Object.keys(changed).length) return;
    entry.style = next;
    n.style(changed);
}

function clearNode(n) {
    n.removeStyle('border-width overlay-padding overlay-opacity overlay-color');
}

function syncNode(node, styles, dark, restoreOverlay = false) {
    const id = node.id();
    const previous = emphasized.get(id);
    const groups = [];
    EMPHASIS_GROUPS.forEach((group, i) => { if (group.isTarget(node)) groups.push(i); });
    if (!groups.length) {
        if (previous?.node === node) clearNode(node);
        emphasized.delete(id);
        return;
    }
    const entry = previous?.node === node ? previous : { node };
    entry.groups = groups;
    // A status transition may have removed a pulse bypass from this node.
    emphasized.set(id, entry);
    applyToNode(node, entry, styles, dark, restoreOverlay);
}

/**
 * full=true — полный проход по узлам (смена статусов/поиска, порог зума,
 * загрузка карты). full=false — только пересчёт значений у уже усиленных узлов.
 */
function cancelZoomFrame() {
    if (zoomFrame === null) return;
    cancelAnimationFrame(zoomFrame);
    zoomFrame = null;
    zoomInterrupted = true;
}

function recompute(full = true, spread = false) {
    const cy = activeCy || getCy();
    if (!cy || (cy.destroyed && cy.destroyed())) return;
    cancelZoomFrame();

    const zoom = cy.zoom();
    const shouldEmphasize = zoom < ZOOM_THRESHOLD;

    // Переход через порог меняет набор целей, а быстрый путь знает только прежних.
    const needFull = full || zoomInterrupted || shouldEmphasize !== wasEmphasizing;
    zoomInterrupted = false;
    if (!needFull) {
        if (!shouldEmphasize || !emphasized.size) { appliedZoom = zoom; return; }
        if (Math.abs(zoom - appliedZoom) / appliedZoom < ZOOM_EPSILON) return;
    }
    appliedZoom = zoom;
    wasEmphasizing = shouldEmphasize;
    const styles = shouldEmphasize ? groupStyles(zoom) : null;
    const dark = isDarkTheme();

    const nodes = [];
    emphasized.forEach(({ node }, id) => {
        if (cy.getElementById(id) !== node) emphasized.delete(id);
        else if (!shouldEmphasize || !needFull) nodes.push(node);
    });
    if (shouldEmphasize && needFull) cy.nodes().forEach(node => nodes.push(node));

    let index = 0;
    const applyBatch = () => {
        zoomFrame = null;
        if (cy.destroyed?.()) return;
        if (spread && isViewportGesture(cy)) {
            zoomFrame = requestAnimationFrame(applyBatch);
            return;
        }
        const end = spread ? Math.min(index + NODES_PER_FRAME, nodes.length) : nodes.length;
        cy.batch(() => {
            for (; index < end; index++) {
                const node = nodes[index];
                const id = node.id();
                if (cy.getElementById(id) !== node) continue;
                const entry = emphasized.get(id);
                if (!shouldEmphasize) {
                    if (entry) clearNode(node);
                    emphasized.delete(id);
                } else if (needFull) {
                    syncNode(node, styles, dark);
                } else if (entry) {
                    applyToNode(node, entry, styles, dark);
                }
            }
        });
        if (index < nodes.length) zoomFrame = requestAnimationFrame(applyBatch);
    };
    applyBatch();
}

export function initZoomEmphasis(cy) {
    cleanup();
    activeCy = cy;
    zoomHandler = () => {
        cancelZoomFrame();
        clearTimeout(runTimer);
        const run = () => {
            runTimer = 0;
            // Не пишем стили узлов посреди жеста — дождёмся его конца.
            if (activeCy && isViewportGesture(activeCy)) { runTimer = setTimeout(run, GESTURE_RECHECK_MS); return; }
            recompute(false, true);
        };
        runTimer = setTimeout(run, ZOOM_IDLE_MS);
    };
    destroyHandler = () => cleanup(true);
    cy.on('zoom', zoomHandler);
    cy.on('destroy', destroyHandler);
    // loadElements() сначала заполняет пустой граф, а затем может выполнить
    // автоматический fit. Первый recompute в init в этот момент не видит
    // устройств или видит старый zoom; два кадра после elements:loaded дают
    // Cytoscape завершить fit и сразу рисуют ауры без ручного wheel-zoom.
    elementsLoadedHandler = () => recompute(true);
    window.addEventListener('elements:loaded', elementsLoadedHandler);
    // Для карт с фоновой подложкой final fit может состояться после
    // elements:loaded. background.js сообщает об этом отдельным событием.
    viewportReadyHandler = () => recompute(false);
    window.addEventListener('linkvision:viewport-ready', viewportReadyHandler);
    // Theme is a DOM attribute, so Cytoscape does not emit a zoom/data event
    // when it changes. Reapply the overview aura without touching viewport.
    if (document.documentElement && typeof MutationObserver !== 'undefined') {
        themeObserver = new MutationObserver(records => {
            if (records.some(record => record.attributeName === 'data-theme')) recompute(true);
        });
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }
    recompute(true);
}

/**
 * Вызывать сразу при смене статуса устройства (device_status/device_status_batch),
 * при первичной загрузке карты и при каждом обновлении подсветки поиска —
 * чтобы новый "красный"/"жёлтый"/найденный узел получил усиление немедленно,
 * не дожидаясь следующего события zoom.
 */
export function refreshZoomEmphasis() {
    recompute(true);
}

export function refreshNodeZoomEmphasis(nodes) {
    const cy = activeCy;
    if (!cy || (nodes.size ?? nodes.length) === 0) return;
    // Keep untouched nodes at the last applied zoom until the zoom handler
    // settles the viewport. Status changes on these nodes are immediate.
    if (!wasEmphasizing) {
        // A zoom toward the map may still be clearing old bypass styles.
        cy.batch(() => nodes.forEach(node => {
            if (emphasized.get(node.id())?.node !== node) return;
            if (cy.getElementById(node.id()) === node) clearNode(node);
            emphasized.delete(node.id());
        }));
        if (cy.zoom() < ZOOM_THRESHOLD) recompute(true);
        return;
    }
    const styles = groupStyles(appliedZoom);
    const dark = isDarkTheme();
    cy.batch(() => {
        nodes.forEach(node => {
            if (cy.getElementById(node.id()) === node) syncNode(node, styles, dark, true);
        });
    });
}

/**
 * Снимает обработчики, таймер и ВСЁ временное состояние усиления. Если граф ещё
 * жив (повторный initZoomEmphasis на том же cy), заодно убирает bypass-стили с
 * подсвеченных узлов — иначе после потери Map они остались бы навсегда.
 * destroying=true — граф уничтожается, его узлы не трогаем.
 */
export function cleanup(destroying = false) {
    cancelZoomFrame();
    zoomInterrupted = false;
    clearTimeout(runTimer);
    runTimer = 0;
    const cy = activeCy;
    if (cy) {
        try {
            if (zoomHandler) cy.off('zoom', zoomHandler);
            if (destroyHandler) cy.off('destroy', destroyHandler);
        } catch (e) { /* граф уже уничтожен */ }
        if (!destroying && !(cy.destroyed && cy.destroyed())) {
            cy.batch(() => {
                emphasized.forEach((_, id) => {
                    const n = cy.getElementById(id);
                    if (n.length) clearNode(n);
                });
            });
        }
    }
    if (elementsLoadedHandler) window.removeEventListener('elements:loaded', elementsLoadedHandler);
    if (viewportReadyHandler) window.removeEventListener('linkvision:viewport-ready', viewportReadyHandler);
    zoomHandler = null;
    destroyHandler = null;
    elementsLoadedHandler = null;
    viewportReadyHandler = null;
    themeObserver?.disconnect();
    themeObserver = null;
    activeCy = null;
    emphasized.clear();
    wasEmphasizing = false;
    appliedZoom = NaN;
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
