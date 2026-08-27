// zoomEmphasis.js – усиление видимости статуса down/partial, а также
// результатов поиска, при отдалении карты.
//
// Проблема: border-width/overlay-padding в styles.js заданы в единицах графа,
// а не в экранных пикселях — при zoom "вписать всю карту" на 200+ устройствах
// (zoom ~0.1–0.2) 3-единичная рамка превращается в доли пикселя на экране и
// физически неразличима. Этот модуль на каждое изменение zoom пересчитывает
// border-width/overlay-padding/overlay-opacity для двух независимых групп
// узлов — авария (status down/partial) и подсветка поиска (.cy-node-highlight) —
// так, чтобы на экране они не становились тоньше заданного минимума в px,
// независимо от того, насколько отдалена карта. Здоровые/неподсвеченные узлы
// не трогаем — их не обязательно "видеть" издалека.
import { getCy } from './core.js';
import { registerCleanup } from './moduleRegistry.js';

const ZOOM_THRESHOLD = 0.5;   // выше этого зума компенсация не нужна — рамка и так видна

let debounceTimer = null;

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

// Две независимые группы усиления — свой data-флаг на группу, чтобы статус-
// авария и подсветка поиска не затирали состояние друг друга на одном и том
// же узле (узел вполне может быть одновременно "down" и найден поиском).
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
];

function clearEmphasis(n, group) {
    n.removeStyle('border-width overlay-padding overlay-opacity');
    n.removeData(group.dataKey);
}

function recompute() {
    const cy = getCy();
    if (!cy) return;

    const zoom = cy.zoom();

    EMPHASIS_GROUPS.forEach((group) => {
        const targetNodes = cy.nodes().filter(group.isTarget);

        // Снимаем усиление с узлов, которым оно больше НЕ полагается: zoom вырос
        // выше порога, или узел вышел из целевой группы (статус стал up,
        // мониторинг выключили, узел больше не совпадает с поиском). Иначе
        // inline-стиль "залипает" на узле, переставшем быть аварийным/найденным.
        cy.nodes().forEach(n => {
            if (n.data(group.dataKey) && (zoom >= ZOOM_THRESHOLD || !targetNodes.contains(n))) {
                clearEmphasis(n, group);
            }
        });

        if (zoom >= ZOOM_THRESHOLD || !targetNodes.length) return;

        const borderWidth = clamp(group.minBorderPx / zoom, group.baseBorder, group.maxBorderGraphUnits);
        const overlayPadding = clamp(group.minOverlayPaddingPx / zoom, group.baseOverlayPadding, group.maxOverlayPaddingGraphUnits);
        // Чем дальше отдалились от порога — тем плотнее гало (линейно от min до max)
        const t = clamp(1 - zoom / ZOOM_THRESHOLD, 0, 1);
        const overlayOpacity = group.minOverlayOpacity + t * (group.maxOverlayOpacity - group.minOverlayOpacity);

        cy.batch(() => {
            targetNodes.forEach(n => {
                n.data(group.dataKey, true);
                n.style({
                    'border-width': borderWidth,
                    'overlay-padding': `${overlayPadding}px`,
                    'overlay-opacity': overlayOpacity,
                });
            });
        });
    });
}

export function initZoomEmphasis(cy) {
    cy.on('zoom', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(recompute, 60);
    });
    recompute();
}

/**
 * Вызывать сразу при смене статуса устройства (device_status/device_status_batch),
 * при первичной загрузке карты и при каждом обновлении подсветки поиска —
 * чтобы новый "красный"/"жёлтый"/найденный узел получил усиление немедленно,
 * не дожидаясь следующего события zoom.
 */
export function refreshZoomEmphasis() {
    recompute();
}

export function cleanup() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
