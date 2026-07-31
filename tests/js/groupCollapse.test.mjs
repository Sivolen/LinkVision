/**
 * Тесты сворачивания групп (в т.ч. вложенных) — static/js/src/map/groupCollapse.js
 *
 * Запуск: npm run test:js
 *
 * Тестируем на НАСТОЯЩЕМ headless-экземпляре Cytoscape (без DOM): модуль
 * получает граф из самого узла (node.cy()), поэтому глобальный инстанс и
 * браузерное окружение не нужны — хватает заглушек window/localStorage.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Заглушки браузерного окружения — модули карты вешают хелперы на window.
globalThis.window = globalThis.window || { currentMapId: 7 };
globalThis.window.currentMapId = 7;
const memoryStore = new Map();
globalThis.localStorage = {
    getItem: k => (memoryStore.has(k) ? memoryStore.get(k) : null),
    setItem: (k, v) => memoryStore.set(k, String(v)),
    removeItem: k => memoryStore.delete(k),
    clear: () => memoryStore.clear(),
};
globalThis.document = globalThis.document || { documentElement: { getAttribute: () => 'light' } };

const cytoscape = require('../../static/js/cytoscape.min.js');
const {
    collapseGroup,
    expandGroup,
    toggleGroupCollapse,
    saveCollapseState,
    restoreCollapseState,
    aggregateGroupStatus,
} = await import('../../static/js/src/map/groupCollapse.js');

// ─── Хелперы ─────────────────────────────────────────────────────────────

/**
 * Граф: родительская группа P { устройство d1, дочерняя группа C { d2 } },
 * снаружи — d3. Связи: d1↔d2 (внутри P, между уровнями) и d2↔d3 (наружу).
 */
function buildNestedGraph() {
    return cytoscape({
        headless: true,
        elements: [
            { data: { id: 'group_P', isGroup: true, name: 'Parent' } },
            { data: { id: 'group_C', isGroup: true, name: 'Child', parent: 'group_P' } },
            { data: { id: 'd1', parent: 'group_P', status: 'up', monitoring_enabled: 'true' } },
            { data: { id: 'd2', parent: 'group_C', status: 'up', monitoring_enabled: 'true' } },
            { data: { id: 'd3', status: 'up', monitoring_enabled: 'true' } },
            { data: { id: 'e_d1_d2', source: 'd1', target: 'd2', label: 'eth0↔eth0' } },
            { data: { id: 'e_d2_d3', source: 'd2', target: 'd3', label: 'eth1↔eth1' } },
        ],
    });
}

const proxies = cy => cy.edges().filter(e => e.data('isCollapseProxy'));
const proxiesTouching = (cy, id) =>
    proxies(cy).filter(e => e.source().id() === id || e.target().id() === id);
/** Прокси между конкретной парой концов (порядок не важен). */
const proxiesBetween = (cy, a, b) =>
    proxies(cy).filter(e => {
        const ends = [e.source().id(), e.target().id()].sort();
        return ends[0] === [a, b].sort()[0] && ends[1] === [a, b].sort()[1];
    });
/**
 * В headless-Cytoscape нет рендерера: visible() всегда true, а стили не
 * вычисляются. Поэтому «скрытость» проверяем по флагу, который проставляет сам
 * модуль вместе с вызовом hide().
 */
const isHidden = el => el.data('_hiddenByCollapse') === true;

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        console.error(`  ✗ ${name}\n    ${err.message}`);
        process.exitCode = 1;
    }
}

console.log('groupCollapse');

// ─── Базовое сворачивание ────────────────────────────────────────────────

test('сворачивание скрывает потомков и помечает группу', () => {
    const cy = buildNestedGraph();
    collapseGroup(cy.$id('group_C'));

    assert.equal(cy.$id('group_C').data('collapsed'), true);
    assert.equal(isHidden(cy.$id('d2')), true, 'устройство внутри свёрнутой группы должно скрыться');
    assert.equal(isHidden(cy.$id('d1')), false, 'соседнее устройство скрываться не должно');
});

test('разворачивание УБИРАЕТ атрибут collapsed (иначе подпись залипает по центру)', () => {
    const cy = buildNestedGraph();
    const group = cy.$id('group_C');

    collapseGroup(group);
    expandGroup(group);

    // Селекторы стилей используют [?collapsed]; если оставить collapsed:false,
    // Cytoscape всё равно матчит «атрибут определён» и стиль пузырька
    // (text-valign: center) не спадает.
    assert.equal(group.data('collapsed'), undefined);
    assert.equal(isHidden(cy.$id('d2')), false);
});

test('toggle переключает состояние в обе стороны', () => {
    const cy = buildNestedGraph();
    const group = cy.$id('group_C');

    toggleGroupCollapse(group);
    assert.equal(group.data('collapsed'), true);
    toggleGroupCollapse(group);
    assert.equal(group.data('collapsed'), undefined);
});

// ─── Прокси-рёбра ────────────────────────────────────────────────────────

test('связь наружу заменяется одним прокси-ребром', () => {
    const cy = buildNestedGraph();
    collapseGroup(cy.$id('group_C'));

    // d2 связан и с d1 (внутри родителя), и с d3 (снаружи) — значит у пузырька
    // C ровно две связи, по одной на каждого соседа, и ни одного дубля.
    assert.equal(proxiesBetween(cy, 'group_C', 'd3').length, 1);
    assert.equal(proxiesBetween(cy, 'group_C', 'd1').length, 1);
    assert.equal(proxiesTouching(cy, 'group_C').length, 2);
    assert.equal(isHidden(cy.$id('e_d2_d3')), true, 'исходное ребро должно скрыться');
});

test('РЕГРЕСС: вложенное сворачивание не плодит дублирующие связи', () => {
    // Сценарий из отчёта: свернуть дочернюю группу, затем родительскую, затем
    // развернуть родительскую. Раньше прокси создавались двумя разными кусками
    // кода с разными схемами ID (proxy_<edge> и proxy_<edge>_<group>), поэтому
    // к дочерней группе приходило ДВА ребра вместо одного.
    const cy = buildNestedGraph();

    collapseGroup(cy.$id('group_C'));
    collapseGroup(cy.$id('group_P'));
    expandGroup(cy.$id('group_P'));

    assert.equal(cy.$id('group_C').data('collapsed'), true, 'дочерняя должна остаться свёрнутой');

    // Ключевая проверка: связь d1↔d2 после сворачивания C должна дать РОВНО
    // одно ребро d1↔пузырёк C. Именно здесь раньше появлялся дубль.
    const dup = proxiesBetween(cy, 'group_C', 'd1');
    assert.equal(dup.length, 1, `d1 ↔ свёрнутая C: ожидалась 1 связь, получено ${dup.length}`);

    // И в целом ни одной пары концов не должно повторяться.
    const pairs = proxies(cy).map(e => [e.source().id(), e.target().id()].sort().join('|'));
    assert.equal(new Set(pairs).size, pairs.length, 'дублирующихся связей между одними и теми же концами быть не должно');
});

test('свёрнутый родитель представляет всю ветку (связь ведёт к нему, не к потомку)', () => {
    const cy = buildNestedGraph();

    collapseGroup(cy.$id('group_C'));
    collapseGroup(cy.$id('group_P'));

    const list = proxies(cy);
    assert.equal(list.length, 1, `ожидалось 1 прокси, получено ${list.length}`);
    const ends = [list[0].source().id(), list[0].target().id()].sort();
    assert.deepEqual(ends, ['d3', 'group_P'], 'связь должна вести к внешней границе — свёрнутому родителю');
    assert.equal(proxiesTouching(cy, 'group_C').length, 0, 'к скрытой дочерней группе связей быть не должно');
});

test('связь целиком внутри свёрнутой группы прячется без прокси', () => {
    const cy = buildNestedGraph();
    collapseGroup(cy.$id('group_P'));

    assert.equal(isHidden(cy.$id('e_d1_d2')), true);
    const internal = proxies(cy).filter(e => {
        const ends = [e.source().id(), e.target().id()];
        return ends.includes('d1') || ends.includes('d2');
    });
    assert.equal(internal.length, 0);
});

test('полное разворачивание возвращает граф в исходное состояние', () => {
    const cy = buildNestedGraph();

    collapseGroup(cy.$id('group_C'));
    collapseGroup(cy.$id('group_P'));
    expandGroup(cy.$id('group_P'));
    expandGroup(cy.$id('group_C'));

    assert.equal(proxies(cy).length, 0, 'прокси-рёбра должны исчезнуть');
    ['d1', 'd2', 'd3'].forEach(id => assert.equal(isHidden(cy.$id(id)), false, `${id} должен быть виден`));
    ['e_d1_d2', 'e_d2_d3'].forEach(id => assert.equal(isHidden(cy.$id(id)), false, `${id} должен быть виден`));
});

test('несколько связей в одну пару схлопываются в одно ребро', () => {
    const cy = buildNestedGraph();
    cy.add({ data: { id: 'e_d2_d3_b', source: 'd2', target: 'd3', label: 'eth2↔eth2' } });

    collapseGroup(cy.$id('group_C'));

    const toD3 = proxiesBetween(cy, 'group_C', 'd3');
    assert.equal(toD3.length, 1, 'две связи к одному соседу должны дать одно прокси-ребро');
    assert.equal(toD3[0].data('label'), '× 2', 'подпись должна отражать количество схлопнутых связей');
});

// ─── Сохранение состояния ────────────────────────────────────────────────

test('РЕГРЕСС: состояние переживает перезагрузку страницы', () => {
    // Ошибка была в тайминге: restoreCollapseState() звался сразу после
    // loadElements(), т.е. по ещё пустому графу — после F5 все группы
    // оказывались развёрнутыми.
    memoryStore.clear();
    const before = buildNestedGraph();
    collapseGroup(before.$id('group_C'));

    // «Перезагрузка»: новый граф, состояние восстанавливаем из localStorage.
    const after = buildNestedGraph();
    restoreCollapseState(after);

    assert.equal(after.$id('group_C').data('collapsed'), true);
    assert.equal(isHidden(after.$id('d2')), true);
    assert.equal(proxiesBetween(after, 'group_C', 'd1').length, 1, 'после восстановления связь должна быть одна');
});

test('состояние хранится отдельно для каждой карты', () => {
    memoryStore.clear();
    window.currentMapId = 7;
    const first = buildNestedGraph();
    collapseGroup(first.$id('group_C'));

    window.currentMapId = 99; // другая карта — её группы не должны сворачиваться
    const other = buildNestedGraph();
    restoreCollapseState(other);
    assert.equal(other.$id('group_C').data('collapsed'), undefined);

    window.currentMapId = 7;
    const same = buildNestedGraph();
    restoreCollapseState(same);
    assert.equal(same.$id('group_C').data('collapsed'), true);
});

test('развёрнутые группы не попадают в сохранённое состояние', () => {
    memoryStore.clear();
    window.currentMapId = 7;
    const cy = buildNestedGraph();

    collapseGroup(cy.$id('group_C'));
    expandGroup(cy.$id('group_C'));
    saveCollapseState(cy);

    assert.deepEqual(JSON.parse(memoryStore.get('groupCollapseState:7')), []);
});

// ─── Агрегированный статус ───────────────────────────────────────────────

test('статус группы — худший среди устройств с мониторингом', () => {
    const cy = buildNestedGraph();
    assert.equal(aggregateGroupStatus(cy.$id('group_P')), 'up');

    cy.$id('d2').data('status', 'partial');
    assert.equal(aggregateGroupStatus(cy.$id('group_P')), 'partial', 'учитываются и вложенные группы');

    cy.$id('d1').data('status', 'down');
    assert.equal(aggregateGroupStatus(cy.$id('group_P')), 'down', 'down важнее partial');
});

test('устройства с выключенным мониторингом не влияют на статус группы', () => {
    const cy = buildNestedGraph();
    cy.$id('d2').data('status', 'down');
    cy.$id('d2').data('monitoring_enabled', 'false');

    assert.equal(aggregateGroupStatus(cy.$id('group_P')), 'up');
});

console.log(`\n${passed} passed${process.exitCode ? ' (есть падения)' : ''}`);
