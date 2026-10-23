// fullscreen.js – полноэкранный режим
import { fitImageToView } from './background.js';
import { registerCleanup } from './moduleRegistry.js';
import { getCy } from './core.js';

let exitButton = null;

function handleFullscreenChange() {
    const active = Boolean(document.fullscreenElement);
    setFullscreenLayout(active);
    resizeMap(active);
}

function setFullscreenLayout(active) {
    document.getElementById('sidebar')?.classList.toggle('fullscreen-hidden', active);
    document.querySelector('.toolbar-shell')?.classList.toggle('fullscreen-hidden', active);
    document.querySelector('.mobile-menu-toggle')?.classList.toggle('fullscreen-hidden', active);
    document.querySelector('.map-container')?.classList.toggle('fullscreen-map', active);

    const exitBtn = document.getElementById('exitFullscreenBtn');
    if (exitBtn) exitBtn.style.display = active ? 'flex' : 'none';
    const fullBtn = document.getElementById('fullscreenBtn');
    if (fullBtn) fullBtn.innerHTML = `<i class="fas fa-${active ? 'compress' : 'expand'}"></i>`;
}

function resizeMap(fit = false) {
    // Fullscreen changes the map container's dimensions after the browser's
    // fullscreen transition. Cytoscape must recalculate its renderer size first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const cy = getCy();
        if (!cy) return;
        cy.resize();
        if (fit) fitImageToView();
    }));
}

export function initFullscreen() {
    cleanup();
    // Не навешиваем слушатель на fullscreenBtn, так как используется onclick в HTML
    exitButton = document.getElementById('exitFullscreenBtn');
    if (exitButton) exitButton.addEventListener('click', exitFullscreen);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
}

export function cleanup() {
    if (exitButton) {
        exitButton.removeEventListener('click', exitFullscreen);
        exitButton = null;
    }
    document.removeEventListener('fullscreenchange', handleFullscreenChange);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        enterFullscreen();
    } else {
        exitFullscreen();
    }
}

function enterFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
        elem.requestFullscreen().catch(err => {
            console.warn(`Fullscreen error: ${err.message}`);
        });
    }
    setFullscreenLayout(true);
    resizeMap(true);
}

function exitFullscreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(err => {
            console.warn(`Exit fullscreen error: ${err.message}`);
        });
    }
    setFullscreenLayout(false);
    resizeMap();
}

// Глобальные функции для вызова из HTML
window.toggleFullscreen = toggleFullscreen;
window.exitFullscreen = exitFullscreen;

registerCleanup(cleanup);
