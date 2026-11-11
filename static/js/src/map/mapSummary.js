// Compact map status and zoom readout in the bottom edge of the canvas.
export function initMapSummary(cy) {
    const summary = document.getElementById('mapDeviceSummary');
    const zoomValue = document.getElementById('mapZoomValue');
    if (!summary || !zoomValue) return () => {};

    let scheduled = false;
    let frame = 0;
    let filtered = false;
    const { totalLabel, filteredLabel, upLabel, partialLabel, downLabel, disabledLabel, acknowledgedLabel } = summary.dataset;
    const makeStat = (label, status) => {
        const item = document.createElement('span');
        item.className = `map-summary-stat map-summary-${status}`;
        if (status !== 'total') {
            const dot = document.createElement('i');
            dot.setAttribute('aria-hidden', 'true');
            item.appendChild(dot);
            item.tabIndex = 0;
        }
        const number = document.createElement('span');
        const caption = document.createElement('span');
        caption.className = 'map-summary-label';
        caption.textContent = ` ${label}`;
        item.append(number, caption);
        return { item, number, caption };
    };
    const stats = [
        makeStat(totalLabel, 'total'),
        makeStat(upLabel, 'up'),
        makeStat(partialLabel, 'partial'),
        makeStat(downLabel, 'down'),
        makeStat(acknowledgedLabel, 'acknowledged'),
        makeStat(disabledLabel, 'disabled'),
    ];
    summary.replaceChildren(...stats.map(stat => stat.item));

    const render = () => {
        scheduled = false;
        const devices = cy.nodes().filter(node => !node.data('isGroup') && !node.data('isShape') && (!filtered || node.visible()));
        let up = 0;
        let partial = 0;
        let down = 0;
        let disabled = 0;
        let acknowledged = 0;
        devices.forEach(node => {
            const monitoring = node.data('monitoring_enabled');
            if (monitoring === false || monitoring === 'false') {
                disabled++;
                return;
            }
            const status = node.data('status');
            if (node.data('acknowledged') === true) acknowledged++;
            else if (status === 'up') up++;
            else if (status === 'partial') partial++;
            else if (status === 'down') down++;
        });
        [devices.length, up, partial, down, acknowledged, disabled].forEach((count, index) => {
            const number = stats[index].number;
            if (number.textContent !== String(count)) number.textContent = count;
        });
        const caption = ` ${filtered ? filteredLabel : totalLabel}`;
        if (stats[0].caption.textContent !== caption) stats[0].caption.textContent = caption;
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
