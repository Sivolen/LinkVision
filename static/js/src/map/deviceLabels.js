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
// Синхронизация с графом:
//   • слой один на карту; pan — одним CSS-transform на контейнер (O(1));
//   • ПОЗИЦИЯ и РАЗМЕР карточки следуют за zoom узла; transform scale задаётся
//     каждой карточке отдельно, общий слой масштабируется только для pan;
//   • при перегруженном обзоре карточки, мешающие друг другу, сворачиваются до
//     названия, а затем скрываются (приоритет у проблемных/выбранных);
//   • позиция/содержимое/видимость обновляются только у «грязных» узлов,
//     пачкой в одном requestAnimationFrame;
//   • слушатели вешаются на конкретный экземпляр cy и снимаются в cleanup()
//     (реестр moduleRegistry) и по событию destroy — повторный initMap()
//     не плодит слои и обработчики;
//   • тема переключается чистым CSS (переменные в style.css), граф не трогаем.
import { registerCleanup } from './moduleRegistry.js';
import { deviceLabelScale, isCyAlive } from './labelScale.js';

export const NATIVE_LABEL_OFF_CLASS = 'lv-html-label';

const DEVICE_SELECTOR = 'node[!isGroup][!isShape]';
const LABEL_GAP_PX = 4;         // зазор в координатах графа между узлом и карточкой
const MIN_NAME_FONT = 12;       // базовый размер имени до масштабирования карты
const FONT_BOOST = 1.1;         // относительно font_size устройства
const DEFAULT_FONT = 11;
const ZOOM_OFF = 0.04;          // ниже — карта слишком мелкая, подписи не рисуем
const CULL_DELAY_MS = 100;      // пауза после последнего изменения перед расчётом наложений
const CULL_PAD_PX = 3;          // минимальный зазор между карточками
const CULL_TOLERANCE = 0.12;    // допустимая доля наложения краёв
const CULL_CELL_PX = 96;        // ячейка сетки для поиска пересечений

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

function createCard() {
    const el = document.createElement('div');
    el.className = 'lv-dev-label';
    const nameEl = document.createElement('div');
    nameEl.className = 'lv-dev-label__name';
    el.appendChild(nameEl);
    return { el, nameEl, ipEl: null, sig: '', transform: '', hidden: null, culled: false, compact: false, anchorCenter: false };
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
    let lastZoom = NaN;
    let rafId = 0;
    let cullTimer = 0;
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

    function updateCard(node, card) {
        if (node.removed()) {
            dropCard(node.id());
            return;
        }
        const visible = node.visible();
        if (card.hidden !== !visible) {
            card.hidden = !visible;
            card.el.hidden = !visible;
        }
        if (!visible) return;

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
            card.sizeStale = true;
        }

        // Позиция, габариты и зазор следуют за масштабом графа, чтобы карточка
        // сохраняла один и тот же размер относительно устройства.
        const zoom = cy.zoom();
        const scale = deviceLabelScale(zoom);
        const pos = node.position();
        const x = pos.x * zoom;
        const y = iconNode
            ? (pos.y + node.outerHeight() / 2) * zoom + LABEL_GAP_PX * zoom
            : pos.y * zoom;
        card.x = x;
        card.y = y;
        card.scale = scale;
        const transform = `translate(${round(x)}px, ${round(y)}px) scale(${round(scale * 1000) / 1000})`;
        if (transform !== card.transform) {
            card.transform = transform;
            card.el.style.transform = transform;
        }
    }

    function applyViewport() {
        const pan = cy.pan();
        const zoom = cy.zoom();
        layer.style.transform = `translate(${round(pan.x)}px, ${round(pan.y)}px)`;
        viewport.classList.toggle('lv-labels--off', zoom < ZOOM_OFF);
        if (zoom !== lastZoom) {
            // Масштаб изменился: позиции и размеры всех карточек пересчитываются.
            lastZoom = zoom;
            cards.forEach((_, id) => dirty.add(id));
            scheduleCull();
        }
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
        ids.forEach(id => {
            const node = cy.getElementById(id);
            if (!node.length || node.removed()) {
                dropCard(id);
                return;
            }
            const card = cards.get(id);
            if (card) updateCard(node, card);
        });
        return true;
    }

    function scheduleCull() {
        // Не сбрасываем таймер при каждом изменении (иначе непрерывный drag/zoom
        // откладывал бы расчёт бесконечно): расчёт идёт не чаще раза в CULL_DELAY_MS.
        if (disposed || cullTimer) return;
        cullTimer = setTimeout(cull, CULL_DELAY_MS);
    }

    /**
     * Разгрузка обзора: карточки в порядке приоритета (проблемные/выбранные,
     * затем остальные сверху вниз) занимают экранные прямоугольники. Если полная
     * карточка пересекается с уже занятым местом — пробуем компактную (только
     * название), если и она мешает — скрываем. Результат зависит только от
     * геометрии и приоритета, поэтому не «мигает» между вызовами.
     */
    function cull() {
        cullTimer = 0;
        if (!usable()) return;
        if (viewportDirty) { viewportDirty = false; applyViewport(); }
        processDirty();
        const items = [];
        cards.forEach(card => { if (!card.hidden) items.push(card); });
        // Сначала снимаем компактность, потом читаем размеры — один layout на всех.
        items.forEach(card => card.el.classList.remove('is-compact'));
        const sizes = items.map(card => ({
            card,
            w: card.el.offsetWidth,
            h: card.el.offsetHeight,
            ipH: card.ipEl ? card.ipEl.offsetHeight + 2 : 0
        }));
        sizes.sort((a, b) =>
            (b.card.priority - a.card.priority) || (a.card.y - b.card.y) || (a.card.x - b.card.x));

        const grid = new Map();
        // Касание/небольшое наложение краёв (до 12% площади меньшей карточки) не считаем помехой.
        const hits = (a, b) => {
            const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
            const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
            if (w <= 0 || h <= 0) return false;
            const smaller = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t));
            return w * h > smaller * CULL_TOLERANCE;
        };
        const overlaps = rect => {
            for (let cx = Math.floor(rect.l / CULL_CELL_PX); cx <= Math.floor(rect.r / CULL_CELL_PX); cx++) {
                for (let cy2 = Math.floor(rect.t / CULL_CELL_PX); cy2 <= Math.floor(rect.b / CULL_CELL_PX); cy2++) {
                    const bucket = grid.get(cx * 100003 + cy2);
                    if (bucket && bucket.some(o => hits(rect, o))) return true;
                }
            }
            return false;
        };
        const occupy = rect => {
            for (let cx = Math.floor(rect.l / CULL_CELL_PX); cx <= Math.floor(rect.r / CULL_CELL_PX); cx++) {
                for (let cy2 = Math.floor(rect.t / CULL_CELL_PX); cy2 <= Math.floor(rect.b / CULL_CELL_PX); cy2++) {
                    const key = cx * 100003 + cy2;
                    if (!grid.has(key)) grid.set(key, []);
                    grid.get(key).push(rect);
                }
            }
        };
        const rectFor = (card, w, h) => {
            const sw = w * card.scale + CULL_PAD_PX;
            const sh = h * card.scale + CULL_PAD_PX;
            const top = card.anchorCenter ? card.y - sh / 2 : card.y;
            return { l: card.x - sw / 2, r: card.x + sw / 2, t: top, b: top + sh };
        };

        sizes.forEach(({ card, w, h, ipH }) => {
            let culled = false;
            let compact = false;
            let rect = rectFor(card, w, h);
            if (overlaps(rect)) {
                if (card.ipEl) {
                    compact = true;
                    rect = rectFor(card, w, h - ipH);
                }
                if (!card.ipEl || overlaps(rect)) {
                    // Выбранные и проблемные никогда не скрываем полностью.
                    if (card.priority >= 2) compact = true; else culled = true;
                }
            }
            if (!culled) occupy(rect);
            card.compact = compact;
            card.culled = culled;
            card.el.classList.toggle('is-compact', compact);
            card.el.classList.toggle('is-culled', culled);
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
    const onDestroy = () => { destroying = true; dispose(); };

    const nodeEvents = 'position data style move select unselect class';
    cy.on('viewport', onViewport);
    cy.on('add', 'node', onAdd);
    cy.on('remove', 'node', onRemove);
    cy.on(nodeEvents, 'node', onNodeChange);
    cy.on('destroy', onDestroy);
    window.addEventListener('elements:loaded', onElementsLoaded);

    function dispose() {
        if (disposed) return;
        disposed = true;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        clearTimeout(cullTimer);
        window.removeEventListener('elements:loaded', onElementsLoaded);
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

    current = { viewport, dispose, cards };
    fullSync();
    flush();
    return dispose;
}

export function cleanup() {
    if (current) current.dispose();
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);
