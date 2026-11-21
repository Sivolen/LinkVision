const REFRESH_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 8_000;
const SHAPE_SELECTOR = 'node[isShape]';

export function initPortalStatuses(cy, mapId, socket) {
    const markers = new Map();
    let timer;
    let request;

    function applyStatuses(statuses) {
        cy.batch(() => {
            for (const [node, targetId] of markers) {
                const state = statuses[targetId];
                node.toggleClass('portal-down', state === 'down');
                node.toggleClass('portal-clear', state === 'clear');
            }
        });
    }

    function schedule(delay = 100) {
        clearTimeout(timer);
        request?.abort();
        request = null;
        if (!document.hidden && markers.size) {
            timer = setTimeout(refresh, delay);
        }
    }

    async function refresh() {
        const controller = new AbortController();
        request = controller;
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch('/api/map/' + mapId + '/portal-statuses', {
                signal: controller.signal,
            });
            if (!response.ok && response.status !== 403 && response.status !== 401) return;
            const statuses = response.ok && !response.redirected ? (await response.json()).statuses : {};
            if (request === controller) applyStatuses(statuses);
        } catch {
            // Keep the last known status through a temporary connection failure.
        } finally {
            clearTimeout(timeout);
            if (request === controller) {
                request = null;
                schedule(REFRESH_INTERVAL_MS);
            }
        }
    }

    function trackMarker(event) {
        const node = event.target;
        const targetId = event.type !== 'remove' && node.data('shape_type') === 'map_link'
            ? node.data('target_map_id')
            : null;
        if (targetId ? markers.get(node) === targetId : !markers.has(node)) return;

        if (targetId) markers.set(node, targetId);
        else markers.delete(node);
        if (!node.removed()) node.removeClass('portal-down portal-clear');
        schedule();
    }

    cy.on('add remove data', SHAPE_SELECTOR, trackMarker);
    cy.nodes(SHAPE_SELECTOR).forEach(node => trackMarker({ target: node }));
    const refreshWhenVisible = () => schedule();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    socket?.on('connect', refreshWhenVisible);

    return () => {
        cy.off('add remove data', SHAPE_SELECTOR, trackMarker);
        document.removeEventListener('visibilitychange', refreshWhenVisible);
        socket?.off('connect', refreshWhenVisible);
        markers.clear();
        schedule();
    };
}