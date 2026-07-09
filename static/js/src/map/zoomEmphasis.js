// zoomEmphasis.js – усиление видимости статуса down/partial при отдалении карты.
//
// Проблема: border-width/overlay-padding в styles.js заданы в единицах графа,
// а не в экранных пикселях — при zoom "вписать всю карту" на 200+ устройствах
// (zoom ~0.1–0.2) 3-единичная рамка превращается в доли пикселя на экране и
// физически неразличима. Этот модуль на каждое изменение zoom пересчитывает
// border-width/overlay-padding/overlay-opacity ТОЛЬКО для узлов со статусом
// down/partial так, чтобы на экране они не становились тоньше заданного
// минимума в px, независимо от того, насколько отдалена карта. Здоровые (up)
// узлы не трогаем — их не обязательно "видеть" издалека.
import { getCy } from './core.js';

const ZOOM_THRESHOLD = 0.5;   // выше этого зума компенсация не нужна — рамка и так видна

const MIN_BORDER_PX = 5;             // минимальная толщина рамки НА ЭКРАНЕ, px
const BASE_BORDER = 3;               // базовое значение из styles.js (единицы графа)
const MAX_BORDER_GRAPH_UNITS = 16;   // потолок в единицах графа — чтобы рамка не "взрывалась" на экстремальном отдалении

const MIN_OVERLAY_PADDING_PX = 10;   // минимальная толщина гало НА ЭКРАНЕ, px
const BASE_OVERLAY_PADDING = 4;      // базовое значение из styles.js (единицы графа)
const MAX_OVERLAY_PADDING_GRAPH_UNITS = 40;

const MAX_OVERLAY_OPACITY = 0.55;    // насколько плотным становится гало на максимальном отдалении

let debounceTimer = null;

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function recompute() {
    const cy = getCy();
    if (!cy) return;

    const zoom = cy.zoom();
    const problemNodes = cy.nodes('[status="down"], [status="partial"]');
    if (!problemNodes.length) return;

    if (zoom >= ZOOM_THRESHOLD) {
        // Достаточно крупно и так — снимаем компенсацию там, где она была применена
        problemNodes.forEach(n => {
            if (n.data('_zoomEmphasis')) {
                n.removeStyle('border-width overlay-padding overlay-opacity');
                n.removeData('_zoomEmphasis');
            }
        });
        return;
    }

    const borderWidth = clamp(MIN_BORDER_PX / zoom, BASE_BORDER, MAX_BORDER_GRAPH_UNITS);
    const overlayPadding = clamp(MIN_OVERLAY_PADDING_PX / zoom, BASE_OVERLAY_PADDING, MAX_OVERLAY_PADDING_GRAPH_UNITS);
    // Чем дальше отдалились от порога — тем плотнее гало (линейно от 0.2 до MAX_OVERLAY_OPACITY)
    const t = clamp(1 - zoom / ZOOM_THRESHOLD, 0, 1);
    const overlayOpacity = 0.2 + t * (MAX_OVERLAY_OPACITY - 0.2);

    cy.batch(() => {
        problemNodes.forEach(n => {
            n.data('_zoomEmphasis', true);
            n.style({
                'border-width': borderWidth,
                'overlay-padding': `${overlayPadding}px`,
                'overlay-opacity': overlayOpacity,
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
 * Вызывать сразу при смене статуса устройства (device_status/device_status_batch)
 * и при первичной загрузке карты — чтобы новый "красный"/"жёлтый" узел получил
 * усиление немедленно, не дожидаясь следующего события zoom.
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
