// minimap.js — мини-карта (обзор всего графа) с рамкой текущего вьюпорта
import { getCy } from './core.js';

let cy = null;
let panel = null, inner = null, imgEl = null, rectEl = null;
let visible = true;
let refreshTimer = null;
let bbox = null;   // boundingBox всего графа в модельных координатах
let scale = 1;     // px мини-карты на единицу модели
const KEY = 'minimapVisible';

export function initMinimap(instance) {
    cy = instance;
    panel = document.getElementById('minimap');
    if (!panel) return;
    inner = panel.querySelector('.minimap-inner');
    imgEl = panel.querySelector('.minimap-img');
    rectEl = panel.querySelector('.minimap-viewport');
    if (!inner || !imgEl || !rectEl) return;

    // Состояние видимости (по умолчанию — показана)
    const saved = localStorage.getItem(KEY);
    visible = saved === null ? true : saved === 'true';
    applyVisibility();

    // Рамка вьюпорта — дёшево, на каждый пан/зум
    cy.on('pan zoom', updateViewportRect);
    // Снимок графа — при изменении элементов/позиций (с дебаунсом)
    cy.on('add remove position', scheduleRefresh);
    window.addEventListener('elements:loaded', scheduleRefresh);

    // Навигация: клик/перетаскивание по мини-карте центрирует карту
    let dragging = false;
    const navTo = (clientX, clientY) => {
        if (!bbox) return;
        const r = inner.getBoundingClientRect();
        const mx = bbox.x1 + (clientX - r.left) / scale;
        const my = bbox.y1 + (clientY - r.top) / scale;
        const z = cy.zoom();
        cy.pan({ x: cy.width() / 2 - mx * z, y: cy.height() / 2 - my * z });
    };
    inner.addEventListener('mousedown', (e) => { dragging = true; navTo(e.clientX, e.clientY); e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (dragging) navTo(e.clientX, e.clientY); });
    window.addEventListener('mouseup', () => { dragging = false; });

    // Кнопка тулбара
    window.toggleMinimap = () => {
        visible = !visible;
        localStorage.setItem(KEY, visible);
        applyVisibility();
        if (visible) refresh();
    };

    scheduleRefresh();
}

function applyVisibility() {
    if (panel) panel.style.display = visible ? 'flex' : 'none';
    const btn = document.getElementById('minimapToggle');
    if (btn) btn.classList.toggle('active', visible);
}

function scheduleRefresh() {
    if (!visible) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
}

// Полный снимок графа + пересчёт масштаба
function refresh() {
    if (!cy || !visible || !panel) return;
    const els = cy.elements();
    if (els.length === 0) {
        imgEl.removeAttribute('src');
        rectEl.style.display = 'none';
        return;
    }
    bbox = els.boundingBox();
    if (!bbox.w || !bbox.h) return;

    const pw = panel.clientWidth, ph = panel.clientHeight;
    scale = Math.min(pw / bbox.w, ph / bbox.h);
    const iw = Math.max(1, Math.round(bbox.w * scale));
    const ih = Math.max(1, Math.round(bbox.h * scale));
    inner.style.width = iw + 'px';
    inner.style.height = ih + 'px';

    try {
        imgEl.src = cy.png({ full: true, bg: 'transparent', maxWidth: iw * 2, maxHeight: ih * 2 });
    } catch (e) { /* png может кинуть на пустом графе */ }
    rectEl.style.display = 'block';
    updateViewportRect();
}

// Рамка текущего вьюпорта поверх снимка
function updateViewportRect() {
    if (!cy || !visible || !bbox || !rectEl) return;
    const ext = cy.extent(); // видимая область в модельных координатах
    const iw = inner.clientWidth, ih = inner.clientHeight;
    // Сырые границы рамки в координатах мини-карты
    const rawL = (ext.x1 - bbox.x1) * scale;
    const rawT = (ext.y1 - bbox.y1) * scale;
    const rawR = (ext.x2 - bbox.x1) * scale;
    const rawB = (ext.y2 - bbox.y1) * scale;
    // Обрезаем КАЖДУЮ границу к [0, размер] независимо — тогда рамка корректно
    // сжимается с любой стороны при выходе за пределы (в т.ч. вверх/влево, где
    // координаты уходят в минус).
    const l = Math.max(0, Math.min(rawL, iw));
    const t = Math.max(0, Math.min(rawT, ih));
    const r = Math.max(0, Math.min(rawR, iw));
    const b = Math.max(0, Math.min(rawB, ih));
    rectEl.style.left = l + 'px';
    rectEl.style.top = t + 'px';
    rectEl.style.width = Math.max(0, r - l) + 'px';
    rectEl.style.height = Math.max(0, b - t) + 'px';
}
