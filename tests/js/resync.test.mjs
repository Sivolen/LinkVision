/**
 * Тесты отложенной перезагрузки карты после реконнекта — static/js/src/map/resync.js
 *
 * Запуск: npm run test:js
 */
import assert from 'node:assert/strict';

// Заглушки браузерного окружения.
const listeners = new Map();
let modalOpen = false;
globalThis.window = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
};
globalThis.document = { querySelector: () => (modalOpen ? {} : null) };

const { initResync, scheduleResync, isMapBusy } = await import('../../static/js/src/map/resync.js');
const { beginSelfUpdate, endSelfUpdate } = await import('../../static/js/src/utils/state.js');

// Минимальный cy: события grab/free, выделение, поиск по id.
function makeCy(selectedIds = []) {
    const handlers = {};
    const selected = new Set(selectedIds);
    const restored = [];
    return {
        restored,
        on: (ev, _sel, fn) => { handlers[ev] = fn; },
        off: (ev) => { delete handlers[ev]; },
        emit: (ev) => handlers[ev] && handlers[ev](),
        $: () => ({ map: fn => [...selected].map(id => fn({ id: () => id })) }),
        batch: fn => fn(),
        getElementById: id => ({ length: id === 'gone' ? 0 : 1, select: () => restored.push(id) }),
    };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

await test('свободный пользователь: перезагрузка выполняется сразу', () => {
    const cy = makeCy();
    const cleanup = initResync(cy);
    let runs = 0;
    scheduleResync(() => { runs++; });
    assert.equal(runs, 1);
    cleanup();
});

await test('перетаскивание откладывает перезагрузку до паузы после free', async () => {
    const cy = makeCy();
    const cleanup = initResync(cy);
    let runs = 0;
    cy.emit('grab');
    scheduleResync(() => { runs++; });
    assert.equal(runs, 0, 'во время drag reload запрещён');
    assert.equal(isMapBusy(), true);
    cy.emit('free');
    assert.equal(runs, 0, 'сразу после free действует grace-период');
    await sleep(3200); // grace 1.5 с + тик опроса 1 с
    assert.equal(runs, 1);
    cleanup();
});

await test('открытая модалка и self-update блокируют, затем отпускают', async () => {
    const cy = makeCy();
    const cleanup = initResync(cy);
    let runs = 0;
    modalOpen = true;
    beginSelfUpdate();
    scheduleResync(() => { runs++; });
    assert.equal(runs, 0);
    modalOpen = false;
    await sleep(1200);
    assert.equal(runs, 0, 'self-update ещё не завершён');
    endSelfUpdate();
    await sleep(1200);
    assert.equal(runs, 1);
    cleanup();
});

await test('несколько запросов подряд схлопываются в один reload', async () => {
    const cy = makeCy();
    const cleanup = initResync(cy, { isExtraBusy: () => modalOpen });
    modalOpen = true;
    let runs = 0;
    scheduleResync(() => { runs += 10; });
    scheduleResync(() => { runs += 1; });
    modalOpen = false;
    await sleep(1200);
    assert.equal(runs, 1, 'выполняется только последний запрос');
    cleanup();
});

await test('выделение восстанавливается после elements:loaded, пропавшие id игнорируются', () => {
    const cy = makeCy(['d1', 'gone', 'group_2']);
    const cleanup = initResync(cy);
    scheduleResync(() => {});
    listeners.get('elements:loaded')();
    assert.deepEqual(cy.restored, ['d1', 'group_2']);
    cleanup();
});

await test('cleanup отменяет отложенную перезагрузку и снимает слушатели', async () => {
    const cy = makeCy();
    const cleanup = initResync(cy, { isExtraBusy: () => modalOpen });
    modalOpen = true;
    let runs = 0;
    scheduleResync(() => { runs++; });
    cleanup();
    modalOpen = false;
    await sleep(1200);
    assert.equal(runs, 0);
    assert.equal(listeners.has('elements:loaded'), false);
});

console.log(`\n${passed} tests passed`);
