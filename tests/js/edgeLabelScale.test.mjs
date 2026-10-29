/**
 * Тесты масштаба подписей — static/js/src/map/labelScale.js
 *
 * Проверяют только чистые функции пересчёта (корзины зума, прозрачность подписей
 * рёбер, размеры в единицах графа). Поведение initZoomLabelStyles (троттлинг,
 * видимые рёбра, destroy) покрыто в tests/js/deviceLabels.test.mjs.
 *
 * Запуск: npm run test:js
 */
import assert from 'node:assert/strict';

const scale = await import('../../static/js/src/map/labelScale.js');
const {
    SCALE_MIN, SCALE_MAX, EDGE_SCALE_MIN, EDGE_LABEL_MIN_ZOOM, EDGE_LABEL_FULL_ZOOM,
    ZOOM_BUCKET, viewState, labelScale, deviceLabelScale, edgeLabelOpacity,
    screenPx, minScreenWidth, bucketZoom,
} = scale;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };

const withZoom = (zoom, fn) => {
    const saved = viewState.zoom;
    viewState.zoom = zoom;
    try { return fn(); } finally { viewState.zoom = saved; }
};

test('labelScale растёт плавно и упирается в потолок SCALE_MAX', () => {
    assert.equal(labelScale(1), 1, 'на масштабе 1 коэффициент равен 1');
    assert.ok(labelScale(0.2) >= SCALE_MIN, 'ниже минимума не проваливается');
    assert.ok(labelScale(4) <= SCALE_MAX, 'выше потолка не растёт');
    assert.ok(labelScale(0.5) < labelScale(1) && labelScale(1) < labelScale(2));
    assert.ok(labelScale(0.9) < labelScale(1), 'в рабочей зоне коэффициент растёт с зумом');
    assert.equal(labelScale(0.9) >= SCALE_MIN, true);
    assert.equal(labelScale(2, EDGE_SCALE_MIN) >= EDGE_SCALE_MIN, true);
});

test('deviceLabelScale повторяет зум ровно (карточка масштабируется с узлом)', () => {
    assert.equal(deviceLabelScale(1.7), 1.7);
    assert.equal(deviceLabelScale(0.3), 0.3);
    assert.equal(deviceLabelScale(0), 1, 'некорректный зум → 1');
    assert.equal(deviceLabelScale(NaN), 1);
    assert.equal(deviceLabelScale(), viewState.zoom || 1, 'по умолчанию берёт viewState.zoom');
});

test('подписи рёбер плавно появляются в диапазоне обзора', () => {
    assert.equal(edgeLabelOpacity(EDGE_LABEL_MIN_ZOOM - 0.1), 0, 'до порога скрыты');
    assert.equal(edgeLabelOpacity(EDGE_LABEL_MIN_ZOOM), 0);
    assert.equal(edgeLabelOpacity(EDGE_LABEL_FULL_ZOOM), 1, 'после порога полностью видны');
    assert.equal(edgeLabelOpacity(EDGE_LABEL_FULL_ZOOM + 1), 1, 'выше потолка не растут');
    const mid = (EDGE_LABEL_MIN_ZOOM + EDGE_LABEL_FULL_ZOOM) / 2;
    assert.ok(Math.abs(edgeLabelOpacity(mid) - 0.5) < 1e-9, 'в середине диапазона ~0.5');
    assert.equal(edgeLabelOpacity(NaN), 0);
    assert.equal(edgeLabelOpacity(), edgeLabelOpacity(viewState.zoom), 'по умолчанию берёт viewState.zoom');
});

test('screenPx: экранные пиксели переводятся в единицы графа с ограничениями', () => {
    withZoom(1, () => assert.ok(Math.abs(screenPx(10) - 10 * labelScale(1)) < 1e-9));
    withZoom(2, () => {
        // Приближение: размер в единицах графа уменьшается быстрее, чем растёт зум.
        const units = screenPx(10);
        assert.ok(units < 10 && units > 0);
        assert.ok(Math.abs(units - 10 * labelScale(2) / 2) < 1e-9);
    });
    withZoom(0.01, () => {
        assert.ok(screenPx(10) <= 10 * 40, 'есть потолок в единицах графа');
    });
});

test('minScreenWidth: минимум в экранных пикселях, но не меньше базовой толщины', () => {
    withZoom(1, () => assert.equal(minScreenWidth(2, 12), 2));
    withZoom(0.5, () => assert.equal(minScreenWidth(2, 12), 4, '2px на экране при зуме 0.5'));
    withZoom(0.01, () => assert.equal(minScreenWidth(2, 12), 12, 'потолок в единицах графа'));
    withZoom(4, () => assert.equal(minScreenWidth(2, 12), 2, 'не тоньше базовой толщины'));
});

test('bucketZoom: логарифмические корзины, стабильные в обе стороны', () => {
    assert.equal(bucketZoom(1), 1);
    assert.equal(bucketZoom(1.02), 1, 'мелкий шаг зума не меняет корзину');
    assert.notEqual(bucketZoom(1.2), 1, 'шаг ~10% — новая корзина');
    // Корзина не зависит от направления подхода к ней.
    assert.equal(bucketZoom(1 * ZOOM_BUCKET), bucketZoom(1 * ZOOM_BUCKET * 1.02));
    assert.equal(bucketZoom(0.5), bucketZoom(0.51));
    assert.ok(Math.abs(bucketZoom(0.31) / 0.3 - 1) < 0.12, 'корзина близка к исходному зуму');
    // Шаг между соседними корзинами равен ZOOM_BUCKET.
    const a = bucketZoom(1);
    const b = bucketZoom(a * ZOOM_BUCKET);
    assert.ok(Math.abs(b / a - ZOOM_BUCKET) < 1e-9);
    for (const bad of [0, -1, NaN, Infinity]) {
        assert.equal(bucketZoom(bad), 1, 'некорректный зум → корзина 1');
    }
});

console.log(`${passed} edgeLabelScale tests passed`);
