// edgeBundling.js – разведение визуально пересекающихся связей между
// РАЗНЫМИ парами узлов (A1↔A3 и A2↔A3, идущие почти в одном направлении).
//
// Cytoscape.js из коробки красиво разводит дубликаты ОДНОЙ пары узлов
// (curve-style: bezier в styles.js уже это делает и трогать не нужно —
// это тот случай, который у вас и так "удобно" разводится).
// Но если A1, A2 расположены рядом и оба соединены с A3 — это две РАЗНЫЕ
// пары узлов, чисто геометрически идущие почти параллельно. Cytoscape
// про такие случаи ничего не знает, поэтому линии накладываются друг
// на друга. Этот модуль сам находит такие "пучки" рёбер у каждого узла
// (по общему узлу + близкому направлению) и веерно разводит их вручную
// через unbundled-bezier.
import { getCy } from './core.js';
import { registerCleanup } from './moduleRegistry.js';

let updateTimeout = null;
const UPDATE_DELAY = 150; // задержка для пакетного обновления (как в edgeLabels.js)

const ANGLE_BUCKET_DEG = 10; // рёбра с разницей курса меньше этого считаем "почти параллельными"
const CURVE_SPACING = 26;    // перпендикулярный шаг между соседними рёбрами пучка, px
// Две контрольные точки на одном перпендикулярном смещении: ребро идёт не одним
// "горбом" в середине, а смещённой почти параллельной дугой — так пучок читается
// как набор параллельных линий, а не как пересекающиеся мешки.
const CP_WEIGHTS = '0.2 0.8';

function recompute(cy) {
    cy.batch(() => {
        // Сбрасываем прошлый ручной изгиб — при каждом пересчёте решаем заново,
        // т.к. узлы могли переместиться и расклад "кто с кем параллелен" изменился.
        cy.edges().forEach(edge => {
            if (edge.data('_manualCurve')) {
                edge.removeStyle('curve-style control-point-distances control-point-weights');
                edge.removeData('_manualCurve');
            }
        });

        const assigned = new Set(); // id рёбер, которым уже назначили изгиб на этом проходе

        cy.nodes().forEach(node => {
            if (node.data('isGroup')) return;
            const nid = node.id();

            // Настоящие мульти-рёбра одной пары Cytoscape разводит сам (bezier в
            // styles.js) — их не трогаем.
            const edges = node.connectedEdges().filter(e => e.parallelEdges().length <= 1);
            if (edges.length < 2) return;

            // Группируем по НАПРАВЛЕННОМУ курсу [0, 360). Это ключевое отличие от
            // прежней версии: раньше курс нормализовался в [0,180), из-за чего
            // "сквозной" узел цепи (ребро слева + ребро справа образуют прямую)
            // считался пучком и его рёбра изгибались — цепь "волнилась". С
            // направленным курсом такие рёбра попадают в РАЗНЫЕ корзины и цепь
            // остаётся прямой; разводятся только рёбра, реально идущие в одну сторону.
            const groups = {};
            edges.forEach(edge => {
                const other = edge.source().id() === nid ? edge.target() : edge.source();
                if (!other.length) return;
                const dx = other.position().x - node.position().x;
                const dy = other.position().y - node.position().y;
                const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
                const bucket = Math.round(deg / ANGLE_BUCKET_DEG);
                (groups[bucket] = groups[bucket] || []).push({ edge, deg });
            });

            Object.values(groups).forEach(group => {
                // Нужно ≥2 ещё не разведённых ребра, иначе разводить нечего.
                if (group.filter(g => !assigned.has(g.edge.id())).length < 2) return;

                // Порядок по точному курсу — веер раскрывается без самопересечений.
                group.sort((a, b) => a.deg - b.deg);
                const m = group.length;

                group.forEach((g, i) => {
                    if (assigned.has(g.edge.id())) return; // уже развели с другого конца
                    assigned.add(g.edge.id());

                    const offset = (i - (m - 1) / 2) * CURVE_SPACING;
                    // control-point-distances отсчитывается перпендикулярно вектору
                    // source→target. Если наш узел — источник ребра, знак прямой;
                    // если цель — инвертируем, иначе половина пучка изогнётся в
                    // другую сторону (та самая "кривизна").
                    const sign = g.edge.source().id() === nid ? 1 : -1;
                    const distance = Math.round(offset * sign);

                    g.edge.data('_manualCurve', true);
                    g.edge.style({
                        'curve-style': 'unbundled-bezier',
                        'control-point-distances': `${distance} ${distance}`,
                        'control-point-weights': CP_WEIGHTS,
                    });
                });
            });
        });
    });
}

/**
 * Пересчитать разведение визуально пересекающихся рёбер. Троттлится —
 * безопасно вызывать часто (после drag, после loadElements и т.д.).
 */
export function updateEdgeCurves() {
    if (updateTimeout) return;
    updateTimeout = setTimeout(() => {
        const cy = getCy();
        updateTimeout = null;
        if (!cy) return;
        recompute(cy);
    }, UPDATE_DELAY);
}

/**
 * Очистка таймера при перезагрузке карты (тот же паттерн, что в
 * edgeLabels.js/groupResize.js).
 */
export function cleanup() {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
    }
}

// Саморегистрация в общем реестре очистки (см. moduleRegistry.js)
registerCleanup(cleanup);

