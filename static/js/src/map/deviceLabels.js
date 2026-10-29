// deviceLabels.js – подписи устройств в виде HTML-карточек поверх холста Cytoscape.
//
// Почему не нативная подпись Cytoscape: label узла — одна текстовая строка с
// единым стилем. Название и IP нельзя оформить по-разному (жирное название +
// приглушённый IP), а text-background даёт только плоский прямоугольник без
// внутренних отступов по строкам и без тени. Поэтому подписи устройств рисуются
// HTML-слоем, а нативная подпись этих узлов гасится классом `lv-html-label`
// (правило в styles.js). Если слой по какой-то причине не создан — класс не
// ставится и работает нативная подпись как запасной вариант.
//
// Производительность (карта на сотни устройств):
//   • карточка масштабируется РОВНО вместе с узлом, поэтому карточки лежат в
//     координатах графа, а pan+zoom — ОДИН CSS-transform на слое (O(1) на кадр,
//     независимо от числа карточек). На zoom/pan карточки не пересчитываются;
//   • на время жеста слою включается will-change (GPU-композитинг), после паузы
//     снимается — текст перерисовывается чётко в итоговом масштабе;
//   • позиция/содержимое/видимость обновляются только у «грязных» узлов, пачкой
//     в одном requestAnimationFrame; DOM пишется только при реальном изменении;
//   • размеры карточек измеряются (offsetWidth/Height) один раз и кэшируются в
//     координатах графа; кэш сбрасывается при смене названия/IP/шрифта и при
//     загрузке веб-шрифтов. Размер в координатах графа от zoom не зависит;
//   • разгрузка наложений (cull) — чистая математика по кэшу, без чтения DOM, и
//     запускается с debounce только после изменения позиций/содержимого, а не
//     при zoom/pan (наложение в координатах графа от масштаба не зависит);
//   • видимость узла (hide/show) в Cytoscape событий не порождает, а подписка на
//     'style' заставляла движок пересчитывать стили внутри обработчика, поэтому
//     слушателя 'style' нет: свёртка групп приходит событием 'data' (флаг
//     _hiddenByCollapse), фильтр статусов и свёртка явно вызывают
//     syncDeviceLabelVisibility() после своих hide()/show();
//   • слушатели вешаются на конкретный экземпляр cy и снимаются в cleanup()
//     (реестр moduleRegistry) и по событию destroy — повторный initMap()
//     не плодит слои, таймеры и обработчики;
//   • тема переключается чистым CSS (переменные в style.css), граф не трогаем.
import { registerCleanup } from './moduleRegistry.js';
import { isCyAlive } from './labelScale.js';

export const NATIVE_LABEL_OFF_CLASS = 'lv-html-label';

const DEVICE_SELECTOR = 'node[!isGroup][!isShape]';
const LABEL_GAP = 4;            // зазор между иконкой и карточкой, ед. графа
const MIN_NAME_FONT = 12;       // базовый размер имени (ед. графа; масштабируется картой)
const FONT_BOOST = 1.1;         // относительно font_size устройства
const DEFAULT_FONT = 11;
const ZOOM_OFF = 0.2;           // ниже — название < ~2.5px, подписи не рисуем
const MOVE_IDLE_MS = 140;       // пауза без pan/zoom, после которой слой «успокаивается»
const CULL_DELAY_MS = 120;      // debounce расчёта наложений после изменений
const CULL_PAD = 3;             // зазор между карточками, ед. графа
const CULL_TOLERANCE = 0.12;    // допустимая доля наложения краёв
const CULL_CELL = 120;          // ячейка сетки для поиска пересечений, ед. графа
const GROUP_EDGE_INSET = 8;     // не прижимаем карточки к рамке группы
const GROUP_HEADER_INSET = 30;  // оставляем заголовку группы свободную полосу сверху

let current = null;

function hasIcon(node) {
    const url = node.data('iconUrl');
    return typeof url === 'string' && url !== '';
}

function parseIps(raw) {
    return String(raw == null ? '' : raw)
        .split(/\s*,\s*/)
        .map(s => s.trim())
        .filter(Boolean);
}

function round(value) {
    return Math.round(value * 10) / 10;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function createCard() {
    const el = document.createElement('div');
    el.className = 'lv-dev-label';
    const nameEl = document.createElement('div');
    nameEl.className = 'lv-dev-label__name';
    el.appendChild(nameEl);
    return {
        el, nameEl, ipEl: null, sig: '', transform: '', hidden: null,
        culled: false, compact: false, anchorCenter: false, priority: 1,
        x: 0, y: 0, w: 0, h: 0, ipH: 0, sizeStale: true,
        node: null, nodeRect: null, iconNode: false, placement: null, groupIds: []
    };
}

function setCardPosition(card, x, y, anchorCenter) {
    const transform = `translate(${round(x)}px, ${round(y)}px)`;
    if (transform !== card.transform) {
        card.transform = transform;
        card.el.style.transform = transform;
    }
    if (card.anchorCenter !== anchorCenter) {
        card.anchorCenter = anchorCenter;
        card.el.classList.toggle('is-anchor-center', anchorCenter);
    }
    card.x = x;
    card.y = y;
}

function groupAncestorsFor(node) {
    if (!node || typeof node.ancestors !== 'function') return [];
    try {
        const ancestors = node.ancestors();
        return ancestors && typeof ancestors.filter === 'function'
            ? ancestors.filter('node[isGroup]')
            : [];
    } catch (e) { return []; }
}

function groupIdsFor(node) {
    const ids = [];
    groupAncestorsFor(node).forEach(group => ids.push(group.id()));
    return ids;
}

function groupBoundsFor(node, cache = null) {
    const groups = groupAncestorsFor(node);
    if (!groups || typeof groups.forEach !== 'function') return [];
    const bounds = [];
    groups.forEach(group => {
        const id = group.id();
        if (cache && cache.has(id)) {
            bounds.push(cache.get(id));
            return;
        }
        const pos = group.position();
        const width = Number(group.outerWidth && group.outerWidth()) || 0;
        const height = Number(group.outerHeight && group.outerHeight()) || 0;
        if (!pos || width <= 0 || height <= 0) return;
        const rect = {
            l: pos.x - width / 2 + GROUP_EDGE_INSET,
            r: pos.x + width / 2 - GROUP_EDGE_INSET,
            t: pos.y - height / 2 + GROUP_HEADER_INSET,
            b: pos.y + height / 2 - GROUP_EDGE_INSET
        };
        if (cache) cache.set(id, rect);
        bounds.push(rect);
    });
    return bounds;
}

/** Создаёт слой подписей для экземпляра cy. Возвращает dispose-функцию. */
export function initDeviceLabels(cy) {
    if (current) current.dispose();
    const container = cy && typeof cy.container === 'function' ? cy.container() : null;
    if (!container) return () => {};

    const viewport = document.createElement('div');
    viewport.className = 'lv-device-labels';
    viewport.setAttribute('aria-hidden', 'true');
    const layer = document.createElement('div');
    layer.className = 'lv-device-labels__layer';
    viewport.appendChild(layer);
    container.appendChild(viewport);

    const cards = new Map();        // id узла -> card
    const dirty = new Set();        // id узлов, требующих пересчёта
    let viewportDirty = true;
    let layerTransform = '';
    let rafId = 0;
    let cullTimer = 0;
    let moveTimer = 0;
    let lastMoveAt = 0;
    let isOff = false;
    let disposed = false;
    let destroying = false; // пришло событие destroy: граф умирает, его узлы не трогаем

    /** true — можно работать; иначе слой сам сворачивается (граф мёртв/отвязан). */
    function usable() {
        if (disposed) return false;
        if (isCyAlive(cy)) return true;
        dispose();
        return false;
    }

    function ensureCard(node) {
        const id = node.id();
        let card = cards.get(id);
        if (!card) {
            card = createCard();
            card.el.dataset.nodeId = id;
            layer.appendChild(card.el);
            cards.set(id, card);
        }
        if (!node.hasClass(NATIVE_LABEL_OFF_CLASS)) node.addClass(NATIVE_LABEL_OFF_CLASS);
        return card;
    }

    function dropCard(id) {
        const card = cards.get(id);
        if (!card) return;
        card.el.remove();
        cards.delete(id);
        dirty.delete(id);
    }

    /** Обновляет карточку по данным узла. Возвращает true, если изменилась геометрия/видимость/размер. */
    function updateCard(node, card) {
        if (node.removed()) {
            dropCard(node.id());
            return false;
        }
        let changed = false;
        const visible = node.visible();
        if (card.hidden !== !visible) {
            card.hidden = !visible;
            card.el.hidden = !visible;
            card.sizeStale = true; // скрытую карточку измерить нельзя
            changed = true;
        }
        if (!visible) return changed;

        const iconNode = hasIcon(node);
        const baseFont = Number(node.data('fontSize')) || DEFAULT_FONT;
        const fontSize = Math.max(MIN_NAME_FONT, Math.round(baseFont * FONT_BOOST * 10) / 10);
        const name = String(node.data('name') ?? '');
        const ips = parseIps(node.data('ip'));
        const status = String(node.data('status') || '');
        const monitoringOff = ['false', false].includes(node.data('monitoring_enabled'));
        const selected = node.selected() || Boolean(node.data('selected'));
        const highlighted = node.hasClass('cy-node-highlight');
        const ipText = ips.join(', ');
        const sig = [name, ipText, fontSize, status, monitoringOff, selected, highlighted, iconNode].join('\u0001');

        // Содержимое трогаем только если данные устройства действительно изменились.
        if (sig !== card.sig) {
            card.sig = sig;
            card.el.style.setProperty('--lv-fs', `${fontSize}px`);
            card.nameEl.textContent = name;
            card.nameEl.hidden = name === '';
            if (ipText) {
                if (!card.ipEl) {
                    card.ipEl = document.createElement('div');
                    card.ipEl.className = 'lv-dev-label__ip';
                    card.el.appendChild(card.ipEl);
                }
                card.ipEl.textContent = ipText;
            } else if (card.ipEl) {
                // Нет IP — строки нет совсем (без пустого места под названием).
                card.ipEl.remove();
                card.ipEl = null;
            }
            card.el.dataset.status = status;
            card.el.classList.toggle('is-monitoring-off', monitoringOff);
            card.el.classList.toggle('is-selected', selected);
            card.el.classList.toggle('is-highlight', highlighted);
            card.priority = (selected || highlighted) ? 3 : (status === 'down' || status === 'partial') && !monitoringOff ? 2 : 1;
            // Размер зависит только от названия/IP/шрифта; выделение и статус его не меняют.
            if (card.sizeSig !== `${name}\u0001${ipText}\u0001${fontSize}`) {
                card.sizeSig = `${name}\u0001${ipText}\u0001${fontSize}`;
                card.sizeStale = true;
                card.placement = null;
            }
            if (card.iconNode !== iconNode) card.placement = null;
            card.iconNode = iconNode;
            changed = true;
        }

        // Координаты и габариты — в единицах графа; масштаб даёт transform слоя.
        // Запоминаем прямоугольник узла как препятствие для карточек соседей.
        const pos = node.position();
        const width = Number(node.outerWidth && node.outerWidth()) || 0;
        const height = Number(node.outerHeight && node.outerHeight()) || 0;
        const nodeRect = {
            l: pos.x - width / 2,
            r: pos.x + width / 2,
            t: pos.y - height / 2,
            b: pos.y + height / 2
        };
        if (!card.nodeRect || nodeRect.l !== card.nodeRect.l || nodeRect.r !== card.nodeRect.r
            || nodeRect.t !== card.nodeRect.t || nodeRect.b !== card.nodeRect.b) {
            card.nodeRect = nodeRect;
            card.placement = null;
            changed = true;
        }
        card.node = node;
        const groupIds = groupIdsFor(node);
        if (groupIds.length !== card.groupIds.length || groupIds.some((id, i) => id !== card.groupIds[i])) {
            card.groupIds = groupIds;
            card.placement = null;
            changed = true;
        }

        // На первом кадре показываем карточку в привычном месте; cull при
        // необходимости переставит её, учитывая соседние узлы и группы.
        if (!card.placement) {
            const x = pos.x;
            const y = iconNode ? nodeRect.b + LABEL_GAP : pos.y;
            card.placement = { x, y, anchorCenter: !iconNode };
            setCardPosition(card, x, y, !iconNode);
        }
        return changed;
    }

    /** pan+zoom одним transform слоя; режим «идёт жест» включает GPU-слой. */
    function applyViewport() {
        const pan = cy.pan();
        const zoom = cy.zoom();
        const transform = `translate(${round(pan.x)}px, ${round(pan.y)}px) scale(${Math.round(zoom * 10000) / 10000})`;
        if (transform !== layerTransform) {
            layerTransform = transform;
            layer.style.transform = transform;
            lastMoveAt = now();
            if (!viewport.classList.contains('is-moving')) viewport.classList.add('is-moving');
            if (!moveTimer) moveTimer = setTimeout(checkMoveIdle, MOVE_IDLE_MS);
        }
        const off = zoom < ZOOM_OFF;
        if (off !== isOff) {
            isOff = off;
            viewport.classList.toggle('lv-labels--off', off);
            if (!off) scheduleCull(); // карточки могли смениться, пока были скрыты
        }
    }

    function checkMoveIdle() {
        moveTimer = 0;
        if (disposed) return;
        const left = MOVE_IDLE_MS - (now() - lastMoveAt);
        if (left > 5) {
            moveTimer = setTimeout(checkMoveIdle, left);
            return;
        }
        viewport.classList.remove('is-moving');
    }

    function flush() {
        rafId = 0;
        if (!usable()) return;
        if (viewportDirty) {
            viewportDirty = false;
            applyViewport();
        }
        if (processDirty()) scheduleCull();
    }

    function processDirty() {
        if (!dirty.size) return false;
        const ids = [...dirty];
        dirty.clear();
        let changed = false;
        ids.forEach(id => {
            const node = cy.getElementById(id);
            if (!node.length || node.removed()) {
                dropCard(id);
                changed = true;
                return;
            }
            const card = cards.get(id);
            if (card && updateCard(node, card)) changed = true;
        });
        return changed;
    }

    function scheduleCull() {
        // debounce: расчёт один раз после того, как изменения улеглись.
        if (disposed) return;
        clearTimeout(cullTimer);
        cullTimer = setTimeout(cull, CULL_DELAY_MS);
    }

    /** Измеряет только карточки с устаревшим кэшем: сначала записи, потом одно чтение. */
    function measureStale(items) {
        const stale = items.filter(card => card.sizeStale);
        if (!stale.length) return;
        stale.forEach(card => card.el.classList.remove('is-compact'));
        stale.forEach(card => {
            card.w = card.el.offsetWidth;
            card.h = card.el.offsetHeight;
            card.ipH = card.ipEl ? card.ipEl.offsetHeight + 2 : 0;
            card.sizeStale = false;
            card.compact = false;
        });
    }

    /**
     * Раскладывает карточки по геометрии графа: сначала резервирует прямоугольники
     * видимых устройств, затем для каждой карточки ищет свободную позицию вокруг
     * её узла. Позиции проверяются относительно всех предков-групп, чтобы карточки
     * оставались внутри рамок. Измерения берутся из кэша; DOM не читается на pan/zoom.
     */
    function cull() {
        cullTimer = 0;
        if (!usable()) return;
        processDirty();
        const items = [];
        cards.forEach(card => { if (!card.hidden) items.push(card); });
        measureStale(items);
        const sized = items.filter(card => card.w > 0 && card.h > 0);
        sized.sort((a, b) =>
            (b.priority - a.priority)
            || (a.nodeRect.t - b.nodeRect.t)
            || (a.nodeRect.l - b.nodeRect.l)
        );

        const grid = new Map();
        const intersects = (a, b) => {
            const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
            const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            return w > 0 && h > 0 ? { w, h } : null;
        };
        const cells = rect => {
            const out = [];
            for (let cx = Math.floor(rect.l / CULL_CELL); cx <= Math.floor(rect.r / CULL_CELL); cx++) {
                for (let cy2 = Math.floor(rect.t / CULL_CELL); cy2 <= Math.floor(rect.b / CULL_CELL); cy2++) {
                    out.push(cx * 100003 + cy2);
                }
            }
            return out;
        };
        const expand = (rect, pad) => ({
            l: rect.l - pad, r: rect.r + pad, t: rect.t - pad, b: rect.b + pad
        });
        const occupy = (rect, ownerId, kind) => cells(rect).forEach(key => {
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push({ rect, ownerId, kind });
        });
        const conflictsFor = (rect, ownerId) => {
            const result = { node: false, labels: 0, overlapArea: 0 };
            const seen = new Set();
            cells(rect).forEach(key => {
                const bucket = grid.get(key);
                if (!bucket) return;
                bucket.forEach(item => {
                    if (item.ownerId === ownerId && item.kind === 'node') return;
                    const dedupe = `${item.kind}:${item.ownerId}`;
                    if (seen.has(dedupe)) return;
                    seen.add(dedupe);
                    const overlap = intersects(rect, item.rect);
                    if (!overlap) return;
                    if (item.kind === 'node') {
                        result.node = true;
                        return;
                    }
                    const intersectionArea = overlap.w * overlap.h;
                    const smallerArea = Math.min(
                        (rect.r - rect.l) * (rect.b - rect.t),
                        (item.rect.r - item.rect.l) * (item.rect.b - item.rect.t)
                    );
                    if (intersectionArea > smallerArea * CULL_TOLERANCE) {
                        result.labels++;
                        result.overlapArea += intersectionArea;
                    }
                });
            });
            return result;
        };

        // Все узлы становятся препятствиями до раскладки карточек. Благодаря
        // этому результат не зависит от того, какая карточка обрабатывается первой.
        sized.forEach(card => {
            if (card.nodeRect) occupy(expand(card.nodeRect, CULL_PAD / 2), card.node.id(), 'node');
        });

        const rectFor = (card, placement, height) => {
            const top = placement.anchorCenter ? placement.y - height / 2 : placement.y;
            return {
                l: placement.x - card.w / 2,
                r: placement.x + card.w / 2,
                t: top,
                b: top + height
            };
        };
        const fitsGroups = (rect, bounds) => bounds.every(group =>
            rect.l >= group.l && rect.r <= group.r && rect.t >= group.t && rect.b <= group.b
        );
        const candidatesFor = (card, height) => {
            const node = card.nodeRect;
            const cx = (node.l + node.r) / 2;
            const cy = (node.t + node.b) / 2;
            if (!card.iconNode) return [{ x: cx, y: cy, anchorCenter: true }];

            const gap = LABEL_GAP + CULL_PAD;
            const candidates = [];
            const add = (x, y) => candidates.push({ x, y, anchorCenter: false });
            // Сначала привычное положение снизу, затем противоположная сторона.
            add(cx, node.b + LABEL_GAP);
            add(cx, node.t - LABEL_GAP - height);
            add(node.r + gap + card.w / 2, cy - height / 2);
            add(node.l - gap - card.w / 2, cy - height / 2);

            // Если соседний узел перекрыл основное место, пробуем сдвинуть карточку
            // вдоль стороны, сохраняя её близко к исходному устройству.
            const dx = card.w / 2 + gap;
            const dy = height / 2 + gap;
            for (const offset of [-dx, dx, -2 * dx, 2 * dx]) {
                add(cx + offset, node.b + LABEL_GAP);
                add(cx + offset, node.t - LABEL_GAP - height);
            }
            for (const offset of [-dy, dy, -2 * dy, 2 * dy]) {
                add(node.r + gap + card.w / 2, cy + offset - height / 2);
                add(node.l - gap - card.w / 2, cy + offset - height / 2);
            }
            return candidates;
        };
        const uniqueCandidates = candidates => {
            const seen = new Set();
            return candidates.filter(candidate => {
                const key = `${round(candidate.x)}:${round(candidate.y)}:${candidate.anchorCenter}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };
        const choosePlacement = (card, height, groupBounds, allowLabelOverlap = false) => {
            const options = [];
            if (card.placement) options.push(card.placement);
            options.push(...candidatesFor(card, height));
            let best = null;
            let bestConflict = Infinity;
            for (const placement of uniqueCandidates(options)) {
                const rect = rectFor(card, placement, height);
                if (!fitsGroups(rect, groupBounds)) continue;
                const conflict = conflictsFor(expand(rect, CULL_PAD / 2), card.node.id());
                if (conflict.node) continue;
                if (conflict.labels === 0) return { placement, rect };
                if (allowLabelOverlap && conflict.overlapArea < bestConflict) {
                    best = { placement, rect };
                    bestConflict = conflict.overlapArea;
                }
            }
            return best;
        };

        const groupBoundsCache = new Map();
        sized.forEach(card => {
            const groupBounds = groupBoundsFor(card.node, groupBoundsCache);
            let compact = false;
            let result = choosePlacement(card, card.h, groupBounds);
            if (!result && card.ipEl) {
                compact = true;
                result = choosePlacement(card, card.h - card.ipH, groupBounds);
            }
            // Выбранные/аварийные карточки получают приоритет и могут слегка
            // пересечься с другой карточкой; узлы и границы группы остаются запретом.
            if (!result && card.priority >= 2) {
                compact = Boolean(card.ipEl);
                const height = compact ? card.h - card.ipH : card.h;
                result = choosePlacement(card, height, groupBounds, true);
            }
            const culled = !result;
            if (result) {
                card.placement = result.placement;
                setCardPosition(card, result.placement.x, result.placement.y, result.placement.anchorCenter);
                occupy(expand(result.rect, CULL_PAD / 2), card.node.id(), 'label');
            }
            // DOM пишем только при реальной смене состояния.
            if (card.compact !== compact) {
                card.compact = compact;
                card.el.classList.toggle('is-compact', compact);
            }
            if (card.culled !== culled) {
                card.culled = culled;
                card.el.classList.toggle('is-culled', culled);
            }
        });
    }

    function schedule() {
        if (rafId || disposed) return;
        rafId = requestAnimationFrame(flush);
    }

    function markDirty(node) {
        if (!node || !node.length) return;
        dirty.add(node.id());
        schedule();
    }

    /** Полная сверка: создаёт недостающие карточки и удаляет «осиротевшие». */
    function fullSync() {
        if (!usable()) return;
        const live = new Set();
        cy.nodes(DEVICE_SELECTOR).forEach(node => {
            live.add(node.id());
            ensureCard(node);
            dirty.add(node.id());
        });
        [...cards.keys()].forEach(id => { if (!live.has(id)) dropCard(id); });
        viewportDirty = true;
        schedule();
    }

    const onViewport = () => { if (disposed) return; viewportDirty = true; schedule(); };
    const onAdd = evt => {
        if (disposed) return;
        const node = evt.target;
        if (!node.isNode() || node.data('isGroup') || node.data('isShape')) return;
        ensureCard(node);
        markDirty(node);
    };
    const onRemove = evt => {
        if (disposed) return;
        const node = evt.target;
        if (node.isNode && node.isNode()) dropCard(node.id());
    };
    const onNodeChange = evt => {
        if (disposed) return;
        const node = evt.target;
        if (cards.has(node.id())) markDirty(node);
    };
    const onElementsLoaded = () => fullSync();
    const onFontsLoaded = () => {
        if (disposed) return;
        cards.forEach(card => { card.sizeStale = true; });
        scheduleCull();
    };
    const onDestroy = () => { destroying = true; dispose(); };

    const nodeEvents = 'position data move select unselect class';
    cy.on('viewport', onViewport);
    cy.on('add', 'node', onAdd);
    cy.on('remove', 'node', onRemove);
    cy.on(nodeEvents, 'node', onNodeChange);
    cy.on('destroy', onDestroy);
    window.addEventListener('elements:loaded', onElementsLoaded);
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts && typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', onFontsLoaded);

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        clearTimeout(cullTimer);
        clearTimeout(moveTimer);
        cullTimer = 0;
        moveTimer = 0;
        window.removeEventListener('elements:loaded', onElementsLoaded);
        if (fonts && typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', onFontsLoaded);
        // Обработчики снимаем всегда (на уничтоженном графе off безвреден).
        try {
            cy.off('viewport', onViewport);
            cy.off('add', 'node', onAdd);
            cy.off('remove', 'node', onRemove);
            cy.off(nodeEvents, 'node', onNodeChange);
            cy.off('destroy', onDestroy);
        } catch (e) { /* граф уже уничтожен */ }
        // Нативные подписи возвращаем только живому графу: иначе узлы остались бы
        // без текста; на умирающем графе стили не трогаем.
        if (!destroying && isCyAlive(cy)) {
            cy.nodes(`.${NATIVE_LABEL_OFF_CLASS}`).removeClass(NATIVE_LABEL_OFF_CLASS);
        }
        cards.clear();
        dirty.clear();
        viewport.remove();
        if (current && current.viewport === viewport) current = null;
    }

    /** Пометить все карточки для проверки видимости (одна пачка в ближайшем кадре). */
    function syncVisibility() {
        if (disposed) return;
        cards.forEach((_, id) => dirty.add(id));
        schedule();
    }

    current = { viewport, dispose, cards, syncVisibility };
    fullSync();
    flush();
    return dispose;
}

/**
 * Вызывать после массового hide()/show() узлов (фильтр статусов, сворачивание
 * групп). Видимость читается в requestAnimationFrame один раз на пачку, а не в
 * обработчике события стиля. Без активного слоя — no-op.
 */
export function syncDeviceLabelVisibility() {
    if (current) current.syncVisibility();
}

export function cleanup() {
    if (current) current.dispose();
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
