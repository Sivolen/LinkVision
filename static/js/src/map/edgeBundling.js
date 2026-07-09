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

let updateTimeout = null;
const UPDATE_DELAY = 150; // задержка для пакетного обновления (как в edgeLabels.js)

const ANGLE_BUCKET_DEG = 12; // рёбра с разницей курса меньше этого считаются "почти параллельными"
const CURVE_SPACING = 28;    // px между соседними изогнутыми рёбрами в пучке

function angleBucket(dx, dy) {
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    // Направление "туда" и "обратно" по факту одна и та же визуальная линия — нормализуем в [0, 180)
    const norm = ((deg % 180) + 180) % 180;
    return Math.round(norm / ANGLE_BUCKET_DEG);
}

function recompute(cy) {
    cy.batch(() => {
        const assigned = new Set(); // id рёбер, которым уже назначили изгиб на этом проходе

        // Сбрасываем прошлый ручной изгиб — при каждом пересчёте решаем заново,
        // т.к. узлы могли переместиться и расклад "кто с кем параллелен" изменился.
        cy.edges().forEach(edge => {
            if (edge.data('_manualCurve')) {
                edge.removeStyle('curve-style control-point-distances control-point-weights');
                edge.removeData('_manualCurve');
            }
        });

        cy.nodes().forEach(node => {
            if (node.data('isGroup')) return;
            const edges = node.connectedEdges();
            if (edges.length < 2) return;

            // Группируем рёбра этого узла по "курсу" (направлению ко второму концу)
            const groups = {};
            edges.forEach(edge => {
                // Настоящие мульти-рёбра между одной и той же парой узлов Cytoscape
                // уже красиво разводит сам (см. styles.js) — не вмешиваемся.
                if (edge.parallelEdges().length > 1) return;

                const other = edge.source().id() === node.id() ? edge.target() : edge.source();
                if (!other.length) return;

                const dx = other.position().x - node.position().x;
                const dy = other.position().y - node.position().y;
                const bucket = angleBucket(dx, dy);
                (groups[bucket] = groups[bucket] || []).push(edge);
            });

            Object.values(groups).forEach(group => {
                if (group.length < 2) return;

                group.forEach((edge, i) => {
                    if (assigned.has(edge.id())) return; // уже развели с другого конца этого ребра
                    assigned.add(edge.id());

                    const offsetIndex = i - (group.length - 1) / 2;
                    const distance = Math.round(offsetIndex * CURVE_SPACING);

                    edge.data('_manualCurve', true);
                    edge.style({
                        'curve-style': 'unbundled-bezier',
                        'control-point-distances': String(distance),
                        'control-point-weights': '0.5',
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
