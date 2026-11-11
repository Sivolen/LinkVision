// Compact map status and zoom readout in the bottom edge of the canvas.
export function initMapSummary(cy) {
    const summary = document.getElementById('mapDeviceSummary');
    const zoomValue = document.getElementById('mapZoomValue');
    if (!summary || !zoomValue) return () => {};

    let scheduled = false;
    let frame = 0;
    let filtered = false;
    const render = () => {
        scheduled = false;
        const devices = cy.nodes().filter(node => !node.data('isGroup') && !node.data('isShape') && (!filtered || node.visible()));
        let up = 0;
        let partial = 0;
        let down = 0;
        let disabled = 0;
        devices.forEach(node => {
            const monitoring = node.data('monitoring_enabled');
            if (monitoring === false || monitoring === 'false') {
                disabled++;
                return;
            }
            const status = node.data('status');
            if (status === 'up') up++;
            else if (status === 'partial') partial++;
            else if (status === 'down') down++;
        });
        const { totalLabel, filteredLabel, upLabel, partialLabel, downLabel, disabledLabel } = summary.dataset;
        const makeStat = (count, label, status) => {
            const item = document.createElement('span');
            item.className = `map-summary-stat map-summary-${status}`;
            if (status !== 'total') {
                const dot = document.createElement('i');
                dot.setAttribute('aria-hidden', 'true');
                item.appendChild(dot);
            }
            item.appendChild(document.createTextNode(`${count} ${label}`));
            return item;
        };
        summary.replaceChildren(
            makeStat(devices.length, filtered ? filteredLabel : totalLabel, 'total'),
            makeStat(up, upLabel, 'up'),
            makeStat(partial, partialLabel, 'partial'),
            makeStat(down, downLabel, 'down'),
            makeStat(disabled, disabledLabel, 'disabled')
        );
    };
    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        frame = requestAnimationFrame(render);
    };
    const updateZoom = () => { zoomValue.textContent = `${Math.round(cy.zoom() * 100)}%`; };
    cy.on('add remove data', schedule);
    cy.on('zoom', updateZoom);
    updateZoom();
    const onFilterChange = event => { filtered = Boolean(event.detail?.filtered); schedule(); };
    window.addEventListener('linkvision:map-filter-changed', onFilterChange);
    schedule();
    return () => {
        cy.off('add remove data', schedule);
        cy.off('zoom', updateZoom);
        window.removeEventListener('linkvision:map-filter-changed', onFilterChange);
        cancelAnimationFrame(frame);
    };
}
