// zoomEmphasis.js – усиление видимости статуса down/partial, деградации
// ICMP-качества (quality_status=bad/degraded при status=up) и результатов
// поиска при отдалении карты.
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

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
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
    return (s === 'down' || s === 'partial') && !isMonitoringOff(n);
}

function isSearchTarget(n) {
    return n.hasClass('cy-node-highlight');
}

// Плохое/сниженное ICMP-качество при status="up" (styles.js:
// node[quality_status="bad"/"degraded"][status="up"]) — устройство отвечает
// на пинг, поэтому status у него не down/partial, но качество (потери,
// задержка, джиттер) деградировало. У этих правил в styles.js тоже
// border-width:4/3 и overlay-padding:4px/3px в единицах графа — та же
// проблема отдаления, что и у status-аварий.
function isQualityTarget(n) {
    const q = n.data('quality_status');
    return (q === 'bad' || q === 'degraded') && n.data('status') === 'up' && !isMonitoringOff(n);
}

// Три независимые группы усиления — свой data-флаг на группу, чтобы
// status-авария, quality-деградация и подсветка поиска не затирали
// состояние друг друга на одном и том же узле (узел вполне может быть
// одновременно, например, quality=bad и найден поиском).
const EMPHASIS_GROUPS = [
    {
        dataKey: '_zoomEmphasisStatus',
        isTarget: isStatusTarget,
        minBorderPx: 5,          // минимальная толщина рамки НА ЭКРАНЕ, px
        baseBorder: 3,           // базовое значение из styles.js (единицы графа)
        maxBorderGraphUnits: 16, // потолок в единицах графа — чтобы рамка не "взрывалась" на экстремальном отдалении
        minOverlayPaddingPx: 10, // минимальная толщина гало НА ЭКРАНЕ, px
        baseOverlayPadding: 4,   // базовое значение из styles.js (единицы графа)
        maxOverlayPaddingGraphUnits: 40,
        minOverlayOpacity: 0.2,
        maxOverlayOpacity: 0.55, // насколько плотным становится гало на максимальном отдалении
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
        minBorderPx: 5,
        baseBorder: 3,           // ориентируемся на degraded (3 в styles.js); bad (4) чуть плотнее, но это тот же минимум группы
        maxBorderGraphUnits: 16,
        minOverlayPaddingPx: 9,
        baseOverlayPadding: 3,
        maxOverlayPaddingGraphUnits: 36,
        minOverlayOpacity: 0.12, // деградация — менее критично, чем down/partial, поэтому гало заметно бледнее
        maxOverlayOpacity: 0.4,
    },
];

// ── Состояние ────────────────────────────────────────────────────────────────
// Узлы, к которым сейчас применено усиление: id -> { groups: [индексы групп], sig }.
// Нужно, чтобы при зуме обходить только их, а не все узлы карты. Новые цели
// появляются при смене статуса/результатов поиска — тогда вызывается
// refreshZoomEmphasis() (полный проход).
const emphasized = new Map();
let wasEmphasizing = false;
let appliedZoom = NaN;
let activeCy = null;
let zoomHandler = null;
let runTimer = 0;
let destroyHandler = null;

const RUN_INTERVAL_MS = 100;    // не чаще раза в 100 мс во время жеста зума
const ZOOM_EPSILON = 0.02;      // изменение масштаба меньше 2% — стили те же

function groupStyles(zoom) {
    const t = clamp(1 - zoom / ZOOM_THRESHOLD, 0, 1);
    return EMPHASIS_GROUPS.map(group => ({
        borderWidth: clamp(group.minBorderPx / zoom, group.baseBorder, group.maxBorderGraphUnits),
        overlayPadding: clamp(group.minOverlayPaddingPx / zoom, group.baseOverlayPadding, group.maxOverlayPaddingGraphUnits),
        // Чем дальше отдалились от порога — тем плотнее гало.
        overlayOpacity: group.minOverlayOpacity + t * (group.maxOverlayOpacity - group.minOverlayOpacity)
    }));
}

// Несколько видов подсветки одного узла объединяются (берём максимум), чтобы они
// не снимали друг друга. Стиль пишем только если значения изменились: каждая
// запись n.style() — событие 'style' для всех подписчиков и перерисовка.
function applyToNode(n, entry, styles) {
    const active = entry.groups.map(i => styles[i]);
    const borderWidth = Math.max(...active.map(s => s.borderWidth));
    const overlayPadding = Math.max(...active.map(s => s.overlayPadding));
    const overlayOpacity = Math.max(...active.map(s => s.overlayOpacity));
    const sig = `${borderWidth.toFixed(2)}|${overlayPadding.toFixed(2)}|${overlayOpacity.toFixed(3)}`;
    if (entry.sig === sig) return;
    entry.sig = sig;
    n.style({
        'border-width': borderWidth,
        'overlay-padding': `${overlayPadding}px`,
        'overlay-opacity': overlayOpacity
    });
}

function clearNode(n) {
    n.removeStyle('border-width overlay-padding overlay-opacity');
}

/**
 * full=true — полный проход по узлам (смена статусов/поиска, порог зума,
 * загрузка карты). full=false — только пересчёт значений у уже усиленных узлов.
 */
function recompute(full = true) {
    const cy = activeCy || getCy();
    if (!cy || (cy.destroyed && cy.destroyed())) return;

    const zoom = cy.zoom();
    const shouldEmphasize = zoom < ZOOM_THRESHOLD;

    // Переход через порог меняет набор целей, а быстрый путь знает только прежних.
    const needFull = full || shouldEmphasize !== wasEmphasizing;
    if (!needFull) {
        if (!shouldEmphasize || !emphasized.size) { appliedZoom = zoom; return; }
        if (Math.abs(zoom - appliedZoom) / appliedZoom < ZOOM_EPSILON) return;
    }
    appliedZoom = zoom;
    wasEmphasizing = shouldEmphasize;
    const styles = shouldEmphasize ? groupStyles(zoom) : null;

    cy.batch(() => {
        if (!needFull) {
            emphasized.forEach((entry, id) => {
                const n = cy.getElementById(id);
                if (!n.length) { emphasized.delete(id); return; }
                applyToNode(n, entry, styles);
            });
            return;
        }

        // Один проход вместо отдельного полного прохода для каждой группы.
        // Флаги состояния хранятся в Map, а не в data узла: запись data даёт
        // событие 'data' (его слушают мини-карта и подписи) на каждом узле.
        const seen = new Set();
        if (shouldEmphasize) {
            cy.nodes().forEach(n => {
                const groups = [];
                EMPHASIS_GROUPS.forEach((group, i) => { if (group.isTarget(n)) groups.push(i); });
                if (!groups.length) return;
                const id = n.id();
                seen.add(id);
                let entry = emphasized.get(id);
                if (!entry) { entry = { groups, sig: '' }; emphasized.set(id, entry); }
                else if (entry.groups.join() !== groups.join()) { entry.groups = groups; entry.sig = ''; }
                applyToNode(n, entry, styles);
            });
        }
        emphasized.forEach((entry, id) => {
            if (seen.has(id)) return;
            const n = cy.getElementById(id);
            if (n.length) clearNode(n);
            emphasized.delete(id);
        });
    });
}

export function initZoomEmphasis(cy) {
    cleanup();
    activeCy = cy;
    zoomHandler = () => {
        // Первый вызов — сразу, дальше не чаще RUN_INTERVAL_MS, последний — после остановки.
        if (runTimer) return;
        const run = () => {
            runTimer = 0;
            // Не пишем стили узлов посреди жеста — дождёмся его конца.
            if (activeCy && isViewportGesture(activeCy)) { runTimer = setTimeout(run, RUN_INTERVAL_MS); return; }
            recompute(false);
        };
        runTimer = setTimeout(run, RUN_INTERVAL_MS);
    };
    destroyHandler = () => cleanup(true);
    cy.on('zoom', zoomHandler);
    cy.on('destroy', destroyHandler);
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

/**
 * Снимает обработчики, таймер и ВСЁ временное состояние усиления. Если граф ещё
 * жив (повторный initZoomEmphasis на том же cy), заодно убирает bypass-стили с
 * подсвеченных узлов — иначе после потери Map они остались бы навсегда.
 * destroying=true — граф уничтожается, его узлы не трогаем.
 */
export function cleanup(destroying = false) {
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
    zoomHandler = null;
    destroyHandler = null;
    activeCy = null;
    emphasized.clear();
    wasEmphasizing = false;
    appliedZoom = NaN;
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
