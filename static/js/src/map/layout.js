// layout.js – авто‑раскладка (grid, circle, cose и т.д.)
import { getCy } from './core.js';
import { boundNodePosition, getBgDimensions } from './background.js';

let layoutRunning = false;

export function initLayout(cy) {
    window.applyLayout = (layoutName) => {
        if (layoutRunning) return;
        layoutRunning = true;
        const layoutOptions = {
            name: layoutName,
            animate: true,
            animationDuration: 500,
            fit: true,
            padding: 30
        };
        if (layoutName === 'cose') {
            Object.assign(layoutOptions, {
                idealEdgeLength: 100,
                nodeOverlap: 20,
                refresh: 20,
                componentSpacing: 100,
                nodeRepulsion: 400000,
                edgeElasticity: 100,
                nestingFactor: 5,
                gravity: 80,
                numIter: 1000,
                initialTemp: 200,
                coolingFactor: 0.95,
                minTemp: 1.0
            });
        } else if (layoutName === 'breadthfirst') {
            layoutOptions.directed = true;
            layoutOptions.spacingFactor = 1.5;
        }
        const layout = cy.layout(layoutOptions);
        layout.on('layoutstop', () => {
            saveAllPositions();
            layoutRunning = false;
        });
        layout.run();
    };
    window.confirmLayout = (layoutName) => {
        const names = { grid:'Сетка', circle:'Круг', concentric:'Концентрический', breadthfirst:'Дерево', cose:'Силовой' };
        if (confirm(`Применить раскладку "${names[layoutName] || layoutName}"?`)) {
            window.applyLayout(layoutName);
        }
    };
}

async function saveAllPositions() {
    const cy = getCy();
    if (!cy) return;
    const devices = cy.nodes().filter(n => !n.data('isGroup') && !n.data('isShape'));
    const updates = devices.map(device => {
        let pos = device.position();
        const { width, height } = getBgDimensions();
        if (width && height) {
            const bounded = boundNodePosition(pos);
            if (bounded.x !== pos.x || bounded.y !== pos.y) device.position(bounded);
            pos = device.position();
        }
        return { id: device.id(), x: Math.round(pos.x), y: Math.round(pos.y) };
    });
    if (!updates.length) return;
    const toast = showToast('Сохранение', 'Сохранение позиций...', 'info', { autoHide: false });
    try {
        const res = await fetch('/api/devices/positions', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error(await getErrorMessage(res));
        const data = await res.json();
        showToast('Успешно', `Сохранены позиции ${data.updated} устройств`, 'success');
        if (typeof window.saveState === 'function') window.saveState('Авто-раскладка');
    } catch (err) {
        console.error(err);
        showToast('Ошибка', err.message, 'error');
    } finally {
        if (toast && toast.hide) toast.hide();
    }
}