// Run as a Firefox DevTools snippet on an open LinkVision map.
// After the gesture, run stopMapGeometryTrace() to get a JSON report.
(() => {
    const cy = globalThis.cy;
    const renderer = cy?.renderer();
    globalThis.stopMapGeometryTrace?.();
    const original = renderer?.recalculateEdgeProjections;
    if (typeof original !== 'function') throw new Error('Open a LinkVision map first.');

    const events = 'bounds dirty style background position add remove viewport';
    const maxRows = 120;
    const rows = [];
    let emptyCalls = 0;
    let dropped = 0;
    let pending = Object.create(null);
    const started = performance.now();

    function onChange(event) {
        const target = event.target;
        const kind = target === cy ? 'viewport' : target.isNode() ? 'node' : 'edge';
        const key = `${kind}.${event.type}`;
        const previous = pending[key];
        if (previous) {
            previous.count++;
            return;
        }
        pending[key] = {
            count: 1,
            // Keep one call site per category between projection runs.
            stack: new Error().stack?.split('\n').slice(1, 14).join('\n')
        };
    }

    function traceProjection(edges, ...args) {
        // The renderer calls this method even when its edge queue is empty.
        // Keep the event context for the next actual projection.
        if (!edges.length) {
            emptyCalls++;
            return original.call(this, edges, ...args);
        }
        const precedingEvents = pending;
        pending = Object.create(null);
        const start = performance.now();
        try {
            return original.call(this, edges, ...args);
        } finally {
            if (rows.length < maxRows) {
                rows.push({
                    atMs: Math.round(start - started),
                    durationMs: +(performance.now() - start).toFixed(2),
                    edges: edges.length,
                    zoom: cy.zoom(),
                    precedingEvents
                });
            } else {
                dropped++;
            }
        }
    }

    function stop() {
        cy.off(events, onChange);
        cy.off('destroy', stop);
        if (renderer.recalculateEdgeProjections === traceProjection) {
            renderer.recalculateEdgeProjections = original;
        }
        if (globalThis.stopMapGeometryTrace === stop) delete globalThis.stopMapGeometryTrace;
        return { elapsedMs: Math.round(performance.now() - started), emptyCalls, dropped, rows, pending };
    }

    renderer.recalculateEdgeProjections = traceProjection;
    cy.on(events, onChange);
    cy.on('destroy', stop);
    globalThis.stopMapGeometryTrace = stop;
})();
