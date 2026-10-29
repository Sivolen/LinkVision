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
        x: 0, y: 0, w: 0, h: 0, ipH: 0, sizeStale: true
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
            card.el.classList.toggle('is-anchor-center', !iconNode);
            card.anchorCenter = !iconNode;
            card.priority = (selected || highlighted) ? 3 : (status === 'down' || status === 'partial') && !monitoringOff ? 2 : 1;
            // Размер зависит только от названия/IP/шрифта; выделение и статус его не меняют.
            if (card.sizeSig !== `${name}\u0001${ipText}\u0001${fontSize}`) {
                card.sizeSig = `${name}\u0001${ipText}\u0001${fontSize}`;
                card.sizeStale = true;
            }
            changed = true;
        }

        // Координаты и габариты — в единицах графа; масштаб даёт transform слоя.
        const pos = node.position();
        const x = pos.x;
        const y = iconNode ? pos.y + node.outerHeight() / 2 + LABEL_GAP : pos.y;
        const transform = `translate(${round(x)}px, ${round(y)}px)`;
        if (transform !== card.transform) {
            card.x = x;
            card.y = y;
            card.transform = transform;
            card.el.style.transform = transform;
            changed = true;
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
     * Разгрузка обзора: карточки в порядке приоритета (проблемные/выбранные,
     * затем остальные сверху вниз) занимают прямоугольники В КООРДИНАТАХ ГРАФА.
     * Если полная карточка пересекается с уже занятым местом — пробуем компактную
     * (только название), если и она мешает — скрываем. Карточка масштабируется
     * вместе с узлом, поэтому результат не зависит от zoom и не «мигает».
     * Размеры берутся из кэша; DOM читается только для устаревших карточек.
     */
    function cull() {
        cullTimer = 0;
        if (!usable()) return;
        processDirty();
        const items = [];
        cards.forEach(card => { if (!card.hidden) items.push(card); });
        measureStale(items);
        const sized = items.filter(card => card.w > 0 && card.h > 0);
        sized.sort((a, b) => (b.priority - a.priority) || (a.y - b.y) || (a.x - b.x));

        const grid = new Map();
        // Касание/небольшое наложение краёв (до 12% площади меньшей карточки) не считаем помехой.
        const hits = (a, b) => {
            const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
            const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            if (w <= 0 || h <= 0) return false;
            const smaller = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
            return w * h > smaller * CULL_TOLERANCE;
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
        const overlaps = rect => cells(rect).some(key => {
            const bucket = grid.get(key);
            return bucket && bucket.some(o => hits(rect, o));
        });
        const occupy = rect => cells(rect).forEach(key => {
            if (!grid.has(key)) grid.set(key, []);
            grid.get(key).push(rect);
        });
        const rectFor = (card, h) => {
            const sw = card.w + CULL_PAD;
            const sh = h + CULL_PAD;
            const top = card.anchorCenter ? card.y - sh / 2 : card.y;
            return { l: card.x - sw / 2, r: card.x + sw / 2, t: top, b: top + sh };
        };

        sized.forEach(card => {
            let culled = false;
            let compact = false;
            let rect = rectFor(card, card.h);
            if (overlaps(rect)) {
                if (card.ipEl) {
                    compact = true;
                    rect = rectFor(card, card.h - card.ipH);
                }
                if (!card.ipEl || overlaps(rect)) {
                    // Выбранные и проблемные никогда не скрываем полностью.
                    if (card.priority >= 2) compact = true; else culled = true;
                }
            }
            if (!culled) occupy(rect);
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
