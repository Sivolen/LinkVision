// minimap.js — мини-карта (обзор) с фоном-планом, элементами и рамкой вьюпорта
import { getCy } from './core.js';
import { getBgDimensions } from './background.js';

let cy = null;
let panel = null, inner = null, bgEl = null, imgEl = null, rectEl = null;
let visible = true;
let refreshTimer = null;
let world = null;  // {x, y, w, h} — «мир» превью в модельных координатах
let scale = 1;     // px мини-карты на единицу модели
const KEY = 'minimapVisible';

// Минимальный «мир», когда фона нет — чтобы одиночный элемент не занимал всё
const MIN_WORLD_W = 1000;
const MIN_WORLD_H = 700;

export function initMinimap(instance) {
    cy = instance;
    panel = document.getElementById('minimap');
    if (!panel) return;
    inner = panel.querySelector('.minimap-inner');
    bgEl = panel.querySelector('.minimap-bg');
    imgEl = panel.querySelector('.minimap-img');
    rectEl = panel.querySelector('.minimap-viewport');
    if (!inner || !imgEl || !rectEl) return;

    const saved = localStorage.getItem(KEY);
    visible = saved === null ? true : saved === 'true';
    applyVisibility();

    cy.on('pan zoom', updateViewportRect);
    cy.on('add remove position', scheduleRefresh);
    window.addEventListener('elements:loaded', scheduleRefresh);

    // Навигация: клик/перетаскивание по мини-карте центрирует карту
    let dragging = false;
    const navTo = (clientX, clientY) => {
        if (!world) return;
        const r = inner.getBoundingClientRect();
        const mx = world.x + (clientX - r.left) / scale;
        const my = world.y + (clientY - r.top) / scale;
        const z = cy.zoom();
        cy.pan({ x: cy.width() / 2 - mx * z, y: cy.height() / 2 - my * z });
    };
    inner.addEventListener('pointerdown', (e) => {
        dragging = true;
        inner.setPointerCapture(e.pointerId);
        navTo(e.clientX, e.clientY);
        e.preventDefault();
    });
    inner.addEventListener('pointermove', (e) => {
        if (dragging) navTo(e.clientX, e.clientY);
    });
    inner.addEventListener('pointerup', () => { dragging = false; });

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

// URL фонового плана из #cy-background (если есть)
function getBgUrl() {
    const el = document.getElementById('cy-background');
    if (!el) return null;
    const bi = getComputedStyle(el).backgroundImage;
    if (!bi || bi === 'none') return null;
    const m = bi.match(/url\(["']?(.*?)["']?\)/);
    return m ? m[1] : null;
}

// «Мир» превью: приоритет — размеры фона-плана; иначе габариты элементов,
// но не меньше минимального мира (чтобы один элемент не занимал всё)
function computeWorld() {
    const { width: bgW, height: bgH } = getBgDimensions();
    if (bgW && bgH) return { x: 0, y: 0, w: bgW, h: bgH };
    const els = cy.elements();
    if (els.length === 0) return null;
    const bb = els.boundingBox();
    const w = Math.max(bb.w, MIN_WORLD_W);
    const h = Math.max(bb.h, MIN_WORLD_H);
    const cx = (bb.x1 + bb.x2) / 2, cyc = (bb.y1 + bb.y2) / 2;
    return { x: cx - w / 2, y: cyc - h / 2, w, h };
}

function refresh() {
    if (!cy || !visible || !panel) return;
    world = computeWorld();
    const bgUrl = getBgUrl();
    if (!world) { // ни фона, ни элементов
        inner.style.width = inner.style.height = '0px';
        return;
    }

    const pw = panel.clientWidth, ph = panel.clientHeight;
    scale = Math.min(pw / world.w, ph / world.h);
    const iw = Math.max(1, Math.round(world.w * scale));
    const ih = Math.max(1, Math.round(world.h * scale));
    inner.style.width = iw + 'px';
    inner.style.height = ih + 'px';

    // Слой фона-плана
    if (bgEl) {
        if (bgUrl) { bgEl.src = bgUrl; bgEl.style.display = 'block'; }
        else { bgEl.removeAttribute('src'); bgEl.style.display = 'none'; }
    }

    // Слой элементов (снимок cy.png) — позиционируем по мировым координатам
    const els = cy.elements();
    if (els.length) {
        const eb = els.boundingBox();
        try {
            imgEl.src = cy.png({ full: true, bg: 'transparent', maxWidth: iw * 2, maxHeight: ih * 2 });
        } catch (e) { /* ignore */ }
        imgEl.style.display = 'block';
        imgEl.style.left = ((eb.x1 - world.x) * scale) + 'px';
        imgEl.style.top = ((eb.y1 - world.y) * scale) + 'px';
        imgEl.style.width = (eb.w * scale) + 'px';
        imgEl.style.height = (eb.h * scale) + 'px';
    } else {
        imgEl.removeAttribute('src');
        imgEl.style.display = 'none';
    }

    rectEl.style.display = 'block';
    updateViewportRect();
}

function updateViewportRect() {
    if (!cy || !visible || !world || !rectEl) return;
    const ext = cy.extent();
    const iw = inner.clientWidth, ih = inner.clientHeight;
    const rawL = (ext.x1 - world.x) * scale;
    const rawT = (ext.y1 - world.y) * scale;
    const rawR = (ext.x2 - world.x) * scale;
    const rawB = (ext.y2 - world.y) * scale;
    // Обрезаем каждую границу независимо — рамка корректно сжимается с любой стороны
    const l = Math.max(0, Math.min(rawL, iw));
    const t = Math.max(0, Math.min(rawT, ih));
    const r = Math.max(0, Math.min(rawR, iw));
    const b = Math.max(0, Math.min(rawB, ih));
    rectEl.style.left = l + 'px';
    rectEl.style.top = t + 'px';
    rectEl.style.width = Math.max(0, r - l) + 'px';
    rectEl.style.height = Math.max(0, b - t) + 'px';
}
