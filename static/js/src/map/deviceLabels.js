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
//     при нажатии мыши подготавливаем слой до первого перемещения.
//   • позиция/содержимое/видимость обновляются только у «грязных» узлов, пачкой
//     в одном requestAnimationFrame; DOM пишется только при реальном изменении;
//   • размеры карточек измеряются (offsetWidth/Height) один раз и кэшируются в
//     координатах графа; кэш сбрасывается при смене названия/IP/шрифта и при
//     загрузке веб-шрифтов. Размер в координатах графа от zoom не зависит;
//   • раскладка при наложении использует размеры из кэша и
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
const LABEL_LAYOUT_DELAY_MS = 120;      // debounce расчёта наложений после изменений
const LABEL_PAD = 3;             // зазор между карточками, ед. графа
const LABEL_CELL = 120;          // ячейка сетки для поиска пересечений, ед. графа

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
        anchorCenter: false, iconWidth: 0, iconHeight: 0,
        x: 0, y: 0, offsetX: 0, offsetY: 0, w: 0, h: 0, sizeStale: true
    };
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
    const edgeLabels = new WeakMap();
    const dirty = new Set();        // id узлов, требующих пересчёта
    let viewportDirty = true;
    let layerTransform = '';
    let rafId = 0;
    let layoutTimer = 0;
    let moveTimer = 0;
    let lastMoveAt = 0;
    let pointerHeld = false;
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
        const status = node.data('acknowledged') === true ? 'acknowledged' : String(node.data('status') || '');
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
            card.el.classList.toggle('is-anchor-center', !iconNode);
            card.anchorCenter = !iconNode;
            // Размер зависит только от названия/IP/шрифта; выделение и статус его не меняют.
            if (card.sizeSig !== `${name}\u0001${ipText}\u0001${fontSize}`) {
                card.sizeSig = `${name}\u0001${ipText}\u0001${fontSize}`;
                card.sizeStale = true;
                changed = true;
            }
        }

        // Координаты и габариты — в единицах графа; масштаб даёт transform слоя.
        const pos = node.position();
        const iconHeight = iconNode ? node.outerHeight() : 0;
        const iconWidth = iconNode ? node.outerWidth() : 0;
        const y = iconNode ? pos.y + iconHeight / 2 + LABEL_GAP : pos.y;
        if (card.x !== pos.x || card.y !== y || card.iconWidth !== iconWidth || card.iconHeight !== iconHeight) {
            card.x = pos.x;
            card.y = y;
            card.iconWidth = iconWidth;
            card.iconHeight = iconHeight;
            changed = true;
        }
        placeCard(card, card.offsetX, card.offsetY);
        return changed;
    }

    function placeCard(card, dx, dy) {
        card.offsetX = dx;
        card.offsetY = dy;
        const transform = `translate(${round(card.x + dx)}px, ${round(card.y + dy)}px)`;
        if (transform !== card.transform) {
            card.transform = transform;
            card.el.style.transform = transform;
        }
    }

    /** pan+zoom одним transform слоя; режим «идёт жест» включает GPU-слой. */
    function applyViewport() {
        const pan = cy.pan();
        const zoom = cy.zoom();
        const transform = `translate(${round(pan.x)}px, ${round(pan.y)}px) scale(${Math.round(zoom * 10000) / 10000})`;
        if (transform !== layerTransform) {
            layerTransform = transform;
            layer.style.transform = transform;
            prepareMovingLayer();
        }
        const off = zoom < ZOOM_OFF;
        if (off !== isOff) {
            isOff = off;
            viewport.classList.toggle('lv-labels--off', off);
        }
    }

    function prepareMovingLayer() {
        lastMoveAt = now();
        if (!viewport.classList.contains('is-moving')) viewport.classList.add('is-moving');
        if (!moveTimer) moveTimer = setTimeout(checkMoveIdle, MOVE_IDLE_MS);
    }

    function checkMoveIdle() {
        moveTimer = 0;
        if (disposed || pointerHeld) return;
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
        if (processDirty()) scheduleLabelLayout();
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

    function scheduleLabelLayout() {
        // debounce: расчёт один раз после того, как изменения улеглись.
        if (disposed) return;
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(layoutLabels, LABEL_LAYOUT_DELAY_MS);
    }

    /** Измеряет только карточки с устаревшим кэшем: сначала записи, потом одно чтение. */
    function measureStale(items) {
        const stale = items.filter(card => card.sizeStale);
        if (!stale.length) return;
        stale.forEach(card => {
            card.w = card.el.offsetWidth;
            card.h = card.el.offsetHeight;
            card.sizeStale = card.w === 0 || card.h === 0;
        });
    }

    function rectFor(card, dx, dy) {
        const left = card.x + dx - card.w / 2;
        const top = card.y + dy - (card.anchorCenter ? card.h / 2 : 0);
        return { l: left, r: left + card.w, t: top, b: top + card.h };
    }

    function layoutLabels() {
        layoutTimer = 0;
        if (!usable()) return;
        processDirty();
        const visible = [...cards.values()].filter(card => !card.hidden);
        measureStale(visible);
        const sized = visible.filter(card => card.w > 0 && card.h > 0);
        sized.sort((a, b) => Number(b.anchorCenter) - Number(a.anchorCenter)
            || a.y - b.y || a.x - b.x);

        const grid = new Map();
        function forEachCell(rect, visit) {
            for (let x = Math.floor(rect.l / LABEL_CELL); x <= Math.floor(rect.r / LABEL_CELL); x++) {
                for (let y = Math.floor(rect.t / LABEL_CELL); y <= Math.floor(rect.b / LABEL_CELL); y++) {
                    visit(x * 100003 + y);
                }
            }
        }
        function occupy(rect, weight = 1) {
            const entry = { rect, weight };
            forEachCell(rect, key => {
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(entry);
            });
        }
        function overlapArea(a, b) {
            const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
            const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            return w > 0 && h > 0 ? w * h : 0;
        }
        function occupiedArea(rect) {
            const nearby = new Set();
            forEachCell(rect, key => {
                grid.get(key)?.forEach(entry => nearby.add(entry));
            });
            let area = 0;
            nearby.forEach(entry => { area += overlapArea(rect, entry.rect) * entry.weight; });
            return area;
        }

        // Mark icons first, including those whose own labels are placed later.
        for (const card of visible) {
            if (card.anchorCenter) continue;
            const bottom = card.y - LABEL_GAP;
            occupy({
                l: card.x - card.iconWidth / 2, r: card.x + card.iconWidth / 2,
                t: bottom - card.iconHeight, b: bottom,
            }, 8);
        }

        const edgeBounds = new Map();
        function connectedLabelRects(card) {
            const node = cy.getElementById(card.el.dataset.nodeId);
            const rectangles = [];
            node.connectedEdges().forEach(edge => {
                if (!edgeBounds.has(edge.id())) {
                    let rect = null;
                    // Only query nearby port labels when a card needs relocation.
                    // Excluding the line body avoids treating an entire diagonal edge as occupied.
                    if (edge.visible() && edge.data('label')) {
                        const box = edge.boundingBox({
                            includeNodes: false, includeEdges: false, includeOverlays: false,
                            includeUnderlays: false, includeOutlines: false, includeLabels: true,
                        });
                        if (box.w > 0 && box.h > 0) {
                            rect = { l: box.x1, r: box.x2, t: box.y1, b: box.y2 };
                        }
                    }
                    edgeBounds.set(edge.id(), rect);
                }
                const rect = edgeBounds.get(edge.id());
                if (rect) rectangles.push(rect);
            });
            return rectangles;
        }

        for (const card of sized) {
            let best = rectFor(card, 0, 0);
            let dx = 0;
            let dy = 0;
            if (!card.anchorCenter && occupiedArea(best) > 0) {
                const portLabels = connectedLabelRects(card);
                const cost = rect => occupiedArea(rect)
                    + 4 * portLabels.reduce((sum, label) => sum + overlapArea(rect, label), 0);
                let bestCost = cost(best);
                const above = -(card.iconHeight + 2 * LABEL_GAP + card.h);
                const side = Math.min(30, Math.max(12, card.w / 4));
                for (const [x, y] of [[0, above], [-side, 0], [side, 0], [-side, above], [side, above]]) {
                    const candidate = rectFor(card, x, y);
                    const candidateCost = cost(candidate);
                    if (candidateCost >= bestCost) continue;
                    best = candidate;
                    bestCost = candidateCost;
                    dx = x;
                    dy = y;
                    if (bestCost === 0) break;
                }
            }
            // Even when every candidate overlaps, keep the same card and both fields.
            occupy({ ...best, r: best.r + LABEL_PAD, b: best.b + LABEL_PAD });
            placeCard(card, dx, dy);
        }
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

    // Viewport notifications can arrive inside the wheel's animation frame.
    // Move the layer now so it reaches the same paint as the canvas.
    const onViewport = () => { if (usable()) applyViewport(); };
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
        if (node.isNode && node.isNode() && cards.has(node.id())) {
            dropCard(node.id());
            scheduleLabelLayout();
        }
    };
    const onNodeChange = evt => {
        if (disposed) return;
        const node = evt.target;
        if (cards.has(node.id())) markDirty(node);
    };
    const onEdgeChange = ({ type, target }) => {
        if (!target.isEdge?.()) return;
        if (type === 'data') {
            const label = target.data('label');
            if (edgeLabels.get(target) === label) return;
            edgeLabels.set(target, label);
        }
        scheduleLabelLayout();
    };
    const onElementsLoaded = () => fullSync();
    const onFontsLoaded = () => {
        if (disposed) return;
        cards.forEach(card => { card.sizeStale = true; });
        scheduleLabelLayout();
    };
    const onDestroy = () => { destroying = true; dispose(); };
    const onPointerDown = event => {
        if (event.button !== 0 || event.pointerType !== 'mouse' || !usable() || isOff) return;
        pointerHeld = true;
        prepareMovingLayer();
    };
    const onPointerEnd = () => {
        if (!pointerHeld) return;
        pointerHeld = false;
        prepareMovingLayer();
    };

    const nodeEvents = 'position data move select unselect class';
    cy.on('viewport', onViewport);
    cy.on('add', 'node', onAdd);
    cy.on('remove', 'node', onRemove);
    cy.on(nodeEvents, 'node', onNodeChange);
    cy.on('add remove data', 'edge', onEdgeChange);
    cy.on('destroy', onDestroy);
    container.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('blur', onPointerEnd);
    window.addEventListener('elements:loaded', onElementsLoaded);
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts && typeof fonts.addEventListener === 'function') fonts.addEventListener('loadingdone', onFontsLoaded);

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        clearTimeout(layoutTimer);
        clearTimeout(moveTimer);
        layoutTimer = 0;
        moveTimer = 0;
        window.removeEventListener('elements:loaded', onElementsLoaded);
        container.removeEventListener('pointerdown', onPointerDown, true);
        window.removeEventListener('pointerup', onPointerEnd, true);
        window.removeEventListener('pointercancel', onPointerEnd, true);
        window.removeEventListener('blur', onPointerEnd);
        if (fonts && typeof fonts.removeEventListener === 'function') fonts.removeEventListener('loadingdone', onFontsLoaded);
        // Обработчики снимаем всегда (на уничтоженном графе off безвреден).
        try {
            cy.off('viewport', onViewport);
            cy.off('add', 'node', onAdd);
            cy.off('remove', 'node', onRemove);
            cy.off(nodeEvents, 'node', onNodeChange);
            cy.off('add remove data', 'edge', onEdgeChange);
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
