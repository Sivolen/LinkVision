// groupCollapse.js – сворачивание групп (в т.ч. вложенных) в «пузырёк».
//
// Модель состояния предельно простая: единственный источник истины —
// data('collapsed') на узлах-группах. Всё остальное (видимость потомков,
// прокси-рёбра, размер/подпись пузырька, агрегированный статус) — ПРОИЗВОДНОЕ
// и каждый раз пересчитывается из этого состояния функцией syncCollapseView().
//
// Так сделано намеренно: прежняя версия хранила ещё и снимок состояния детей
// (_childGroupsState) и создавала прокси-рёбра ДВУМЯ разными кусками кода с
// разными схемами ID (proxy_<edge> и proxy_<edge>_<group>). При сворачивании
// вложенных групп это давало дубли — к дочерней группе шли две связи вместо
// одной. Идемпотентный пересчёт «с нуля» такие рассинхроны исключает по
// построению.
import { getCy } from './core.js';
import { updateAllGroups } from './groupResize.js';
import { refreshZoomEmphasis } from './zoomEmphasis.js';

const STORAGE_PREFIX = 'groupCollapseState';

// ─── Состояние ───────────────────────────────────────────────────────────

/** Ключ localStorage привязан к карте: у разных карт свои свёрнутые группы. */
function storageKey() {
    const mapId = window.currentMapId;
    return mapId ? `${STORAGE_PREFIX}:${mapId}` : STORAGE_PREFIX;
}

function isCollapsed(node) {
    return !!(node && node.length && node.data('collapsed'));
}

export function saveCollapseState(cyArg) {
    const cy = cyArg || getCy();
    if (!cy) return;
    // ВАЖНО: селектор '[?collapsed]' (truthy), а не '[collapsed]' — последний в
    // Cytoscape означает «атрибут определён», т.е. матчит и collapsed:false.
    const collapsed = cy.nodes('[?isGroup][?collapsed]').map(n => n.id());
    try {
        localStorage.setItem(storageKey(), JSON.stringify(collapsed));
    } catch (e) { /* приватный режим / переполнение — не критично */ }
}

/**
 * Восстановить состояние сворачивания. Вызывать ПОСЛЕ того, как элементы карты
 * добавлены в граф (событие 'elements:loaded'), иначе восстанавливать нечего:
 * loadElements() ходит на сервер асинхронно, и на момент initMap() граф пуст.
 */
export function restoreCollapseState(cyArg) {
    const cy = cyArg || getCy();
    if (!cy) return;

    let collapsedIds = [];
    try {
        const raw = localStorage.getItem(storageKey());
        if (raw) collapsedIds = JSON.parse(raw) || [];
    } catch (e) {
        collapsedIds = [];
    }
    if (!Array.isArray(collapsedIds) || !collapsedIds.length) return;

    let applied = false;
    collapsedIds.forEach(id => {
        const node = cy.getElementById(id);
        if (node.length && node.data('isGroup') && !isCollapsed(node)) {
            node.data('collapsed', true);
            applied = true;
        }
    });
    if (applied) syncCollapseView(cy);
}

// ─── Пересчёт представления ──────────────────────────────────────────────

/**
 * Ближайший к КОРНЮ свёрнутый предок-группа — то, чем узел «представлен» на
 * экране. Если таких нет, узел представляет сам себя.
 */
function representativeOf(node) {
    const ancestors = node.ancestors('[?isGroup]');
    if (!ancestors.length) return node;

    let rep = null;
    let repDepth = Infinity;
    ancestors.forEach(anc => {
        if (!isCollapsed(anc)) return;
        const depth = anc.ancestors().length;
        if (depth < repDepth) {
            repDepth = depth;
            rep = anc;
        }
    });
    return rep || node;
}

function insideCollapsed(node) {
    let found = false;
    node.ancestors('[?isGroup]').forEach(anc => {
        if (isCollapsed(anc)) found = true;
    });
    return found;
}

/**
 * Видимость потомков свёрнутых групп. Скрываем только своими руками и помечаем
 * флагом — чтобы не конфликтовать с поиском/фильтром (search.js тоже
 * использует hide()/show()) и не «оживлять» отфильтрованные узлы.
 */
function syncVisibility(cy) {
    cy.nodes('[?isGroup]').forEach(group => {
        if (!isCollapsed(group)) return;
        group.descendants().forEach(d => {
            if (!d.data('_hiddenByCollapse')) {
                d.data('_hiddenByCollapse', true);
                d.hide();
            }
        });
    });

    // Показываем обратно всё, что скрывали мы, но что больше не внутри
    // свёрнутой группы.
    cy.nodes('[?_hiddenByCollapse]').forEach(node => {
        if (!insideCollapsed(node)) {
            node.removeData('_hiddenByCollapse');
            node.show();
        }
    });
}

/**
 * Пересобрать прокси-рёбра. Полностью идемпотентно: старые прокси удаляются,
 * новые строятся из текущего состояния. Несколько реальных связей, которые
 * после сворачивания ведут в одну и ту же пару «представителей», схлопываются
 * в ОДНО прокси-ребро (иначе на пузырьке рисовался бы пучок дублей).
 */
function syncProxyEdges(cy) {
    cy.edges('[?isCollapseProxy]').remove();

    const byPair = new Map();

    cy.edges().forEach(edge => {
        if (edge.data('isCollapseProxy')) return;

        const source = edge.source();
        const target = edge.target();
        if (!source.length || !target.length) return;

        const repSource = representativeOf(source);
        const repTarget = representativeOf(target);

        // Оба конца видны как есть — обычное ребро.
        if (repSource === source && repTarget === target) {
            if (edge.data('_hiddenByCollapse')) {
                edge.removeData('_hiddenByCollapse');
                edge.show();
            }
            return;
        }

        // Хотя бы один конец «спрятан» в свёрнутую группу — само ребро прячем.
        edge.data('_hiddenByCollapse', true);
        edge.hide();

        // Связь целиком внутри одной свёрнутой группы — прокси не нужен.
        if (repSource.id() === repTarget.id()) return;

        const key = `${repSource.id()}|${repTarget.id()}`;
        const bucket = byPair.get(key);
        if (bucket) bucket.edges.push(edge);
        else byPair.set(key, { source: repSource, target: repTarget, edges: [edge] });
    });

    byPair.forEach((bucket, key) => {
        const first = bucket.edges[0];
        const count = bucket.edges.length;
        cy.add({
            group: 'edges',
            data: {
                id: `collapseProxy_${key}`,
                source: bucket.source.id(),
                target: bucket.target.id(),
                isCollapseProxy: true,
                // Одна связь — показываем её подпись; несколько схлопнутых —
                // показываем их количество, иначе подпись врёт.
                label: count === 1 ? first.data('label') : `× ${count}`,
                font_size: first.data('font_size'),
                color: first.data('color'),
                width: first.data('width'),
                style: 'dashed',
            },
        });
    });
}

/** Агрегированный статус группы: худший среди её устройств с мониторингом. */
export function aggregateGroupStatus(groupNode) {
    if (!groupNode || !groupNode.length) return 'up';

    let worst = 'up';
    groupNode.descendants().forEach(node => {
        if (node.data('isGroup') || node.data('isShape')) return;
        const raw = node.data('monitoring_enabled');
        if (raw === false || raw === 'false') return;

        const status = node.data('status');
        if (status === 'down') worst = 'down';
        else if (status === 'partial' && worst !== 'down') worst = 'partial';
    });
    return worst;
}

/**
 * Статус пузырька кладём В ДАННЫЕ, а раскраску отдаём таблице стилей
 * (селекторы node[?collapsed][bubbleStatus=...] в styles.js). Инлайновые
 * стили тут не нужны — раньше они «залипали» после разворачивания.
 */
function syncBubbleStatus(cy) {
    cy.nodes('[?isGroup]').forEach(group => {
        if (isCollapsed(group)) {
            group.data('bubbleStatus', aggregateGroupStatus(group));
        } else if (group.data('bubbleStatus') !== undefined) {
            group.removeData('bubbleStatus');
        }
    });
}

/**
 * Привести всё представление в соответствие с data('collapsed').
 * cyArg позволяет работать без глобального инстанса (операции над узлом берут
 * граф из самого узла — node.cy()), что заодно делает модуль тестируемым.
 */
export function syncCollapseView(cyArg) {
    const cy = cyArg || getCy();
    if (!cy) return;

    cy.batch(() => {
        syncVisibility(cy);
        syncProxyEdges(cy);
        syncBubbleStatus(cy);
    });

    updateAllGroups();
    refreshZoomEmphasis();
}

// ─── Публичные операции ──────────────────────────────────────────────────

export function collapseGroup(groupNode) {
    if (!groupNode || !groupNode.length || isCollapsed(groupNode)) return;
    if (!groupNode.data('isGroup')) return;

    groupNode.data('collapsed', true);
    syncCollapseView(groupNode.cy());
    saveCollapseState(groupNode.cy());
}

export function expandGroup(groupNode) {
    if (!groupNode || !groupNode.length || !isCollapsed(groupNode)) return;

    // removeData, а не data(..., false): селекторы вида node[?collapsed]
    // опираются на truthy-значение, и так узел не тащит мусорный атрибут,
    // из-за которого подпись группы «залипала» по центру пузырька.
    groupNode.removeData('collapsed');
    syncCollapseView(groupNode.cy());
    saveCollapseState(groupNode.cy());
}

export function toggleGroupCollapse(groupNode) {
    if (!groupNode || !groupNode.length) return;
    if (isCollapsed(groupNode)) expandGroup(groupNode);
    else collapseGroup(groupNode);
}

/** Пересчитать статусы пузырьков (после device_status / device_status_batch). */
export function refreshAllCollapsedStatuses(cyArg) {
    const cy = cyArg || getCy();
    if (!cy) return;
    cy.batch(() => syncBubbleStatus(cy));
}

export function isGroupCollapsed(groupNode) {
    return isCollapsed(groupNode);
}

export function cleanup() {
    // Состояние живёт в localStorage и в данных узлов; таймеров модуль не держит.
}

// ─── Глобальный доступ (шаблоны/инлайновые обработчики) ───────────────────

window.collapseGroup = collapseGroup;
window.expandGroup = expandGroup;
window.toggleGroupCollapse = toggleGroupCollapse;
window.refreshAllCollapsedStatuses = refreshAllCollapsedStatuses;
