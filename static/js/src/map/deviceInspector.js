// Quick device overview, drawn over the map without resizing Cytoscape.
import { isLinkMode } from './modes.js';
import { renderQualityPreview } from '../modal/quality.js';
import { t, getLocale } from '../i18n/i18n.js';

export function initDeviceInspector(cy) {
    const panel = document.getElementById('mapDeviceInspector');
    if (!panel) return () => {};
    const field = id => document.getElementById(id);
    const close = field('inspectorClose');
    const open = field('inspectorOpen');
    const copyIp = field('inspectorCopyIp');
    const tabs = [...panel.querySelectorAll('[data-inspector-tab]')];
    const selectTab = name => {
        panel.dataset.inspectorTab = name;
        tabs.forEach(tab => {
            const active = tab.dataset.inspectorTab === name;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
        });
    };
    const onTabClick = event => selectTab(event.currentTarget.dataset.inspectorTab);
    tabs.forEach(tab => tab.addEventListener('click', onTabClick));
    let currentNode = null;
    let request = null;
    let requestId = 0;
    let copyFeedbackTimer = null;
    const copyLabel = copyIp.getAttribute('aria-label') || copyIp.getAttribute('title') || '';

    const showCopySuccess = () => {
        clearTimeout(copyFeedbackTimer);
        copyIp.classList.add('is-copied');
        copyIp.title = t('contextMenu.copied');
        copyIp.setAttribute('aria-label', t('contextMenu.copied'));
        const icon = copyIp.querySelector('i');
        if (icon) icon.className = 'fas fa-check';
        copyFeedbackTimer = setTimeout(() => {
            copyIp.classList.remove('is-copied');
            copyIp.title = copyLabel;
            copyIp.setAttribute('aria-label', copyLabel);
            if (icon) icon.className = 'fas fa-copy';
        }, 1500);
    };

    const formatMetric = (value, unit) => {
        const number = Number(value);
        if (value == null || value === '' || !Number.isFinite(number)) return '—';
        return `${new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(number)}${unit === '%' ? '' : ' '}${unit}`;
    };
    const timeUnit = () => getLocale().startsWith('en') ? 'ms' : 'мс';
    const renderNode = node => {
        field('inspectorName').textContent = node.data('name') || node.id();
        field('inspectorIp').textContent = node.data('ip') || '';
        const status = node.data('status');
        const monitoringOff = node.data('monitoring_enabled') === false || node.data('monitoring_enabled') === 'false';
        const displayedStatus = monitoringOff ? 'monitoring-off' : (status || 'unknown');
        field('inspectorStatus').textContent = monitoringOff ? panel.dataset.monitoringOffLabel : status === 'up' ? panel.dataset.upLabel : status === 'down' ? panel.dataset.downLabel : status === 'partial' ? panel.dataset.partialLabel : panel.dataset.unknownLabel;
        field('inspectorStatus').dataset.status = displayedStatus;
        field('inspectorLatency').textContent = formatMetric(node.data('quality_latency_ms'), timeUnit());
        field('inspectorLoss').textContent = formatMetric(node.data('quality_loss_percent'), '%');
        field('inspectorJitter').textContent = formatMetric(node.data('quality_jitter_ms'), timeUnit());
        panel.hidden = false;
    };
    const loadDetails = async node => {
        request?.abort();
        request = new AbortController();
        const id = ++requestId;
        const chart = field('inspectorQualityChart');
        chart.textContent = '…';
        field('inspectorType').textContent = '—';
        field('inspectorGroupRow').hidden = true;
        field('inspectorLastCheck').textContent = '—';
        field('inspectorNeighbors').textContent = '…';
        field('inspectorNeighborCount').textContent = '';
        field('inspectorEventsSection').hidden = true;
        try {
            const response = await fetch(`/api/device/${encodeURIComponent(node.id())}/details`, { signal: request.signal });
            if (!response.ok) throw new Error(`Device details: ${response.status}`);
            const details = await response.json();
            if (id !== requestId || currentNode !== node || panel.hidden) return;
            if (Object.prototype.hasOwnProperty.call(details, 'monitoring_enabled')) {
                node.data('monitoring_enabled', details.monitoring_enabled ? 'true' : 'false');
            }
            field('inspectorType').textContent = details.type_name || '—';
            field('inspectorGroupRow').hidden = !details.group_name;
            field('inspectorGroup').textContent = details.group_name || '—';
            const checkedAt = details.last_check ? new Date(details.last_check) : null;
            field('inspectorLastCheck').textContent = checkedAt && !Number.isNaN(checkedAt.getTime())
                ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(checkedAt) : '—';
            if (Array.isArray(details.ips)) field('inspectorIp').textContent = details.ips.join(', ');
            field('inspectorLatency').textContent = formatMetric(details.quality_latency_ms, timeUnit());
            field('inspectorLoss').textContent = formatMetric(details.quality_loss_percent, '%');
            field('inspectorJitter').textContent = formatMetric(details.quality_jitter_ms, timeUnit());
            renderQualityPreview(chart, details.quality_history, details);
            const events = field('inspectorEvents');
            events.replaceChildren();
            const history = Array.isArray(details.history?.items) ? details.history.items.slice(0, 3) : [];
            field('inspectorEventsSection').hidden = history.length === 0;
            history.forEach(item => {
                const row = document.createElement('div');
                const status = document.createElement('span');
                status.className = 'map-inspector-event-status';
                status.dataset.status = item.new_status || 'unknown';
                status.textContent = item.new_status === 'up' ? panel.dataset.upLabel : item.new_status === 'down' ? panel.dataset.downLabel : item.new_status === 'partial' ? panel.dataset.partialLabel : panel.dataset.unknownLabel;
                const time = document.createElement('time');
                const date = new Date(item.timestamp);
                time.textContent = Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(date);
                row.append(status, time);
                events.appendChild(row);
            });
            const neighbors = field('inspectorNeighbors');
            neighbors.replaceChildren();
            const links = Array.isArray(details.neighbors) ? details.neighbors : [];
            field('inspectorNeighborCount').textContent = `(${links.length})`;
            if (!links.length) neighbors.textContent = t('modal.device.noLinks');
            links.forEach(link => {
                const row = document.createElement('button');
                row.type = 'button';
                const name = document.createElement('strong');
                const ports = document.createElement('span');
                name.textContent = link.device_name || String(link.device_id);
                ports.textContent = [link.interface, link.neighbor_interface].filter(Boolean).join(' ↔ ');
                row.append(name, ports);
                row.addEventListener('click', () => {
                    const neighbor = cy.getElementById(String(link.device_id));
                    if (neighbor.nonempty()) show({ target: neighbor });
                });
                neighbors.appendChild(row);
            });
        } catch (error) {
            if (error.name === 'AbortError' || id !== requestId) return;
            chart.textContent = t('common.loadError');
            field('inspectorNeighbors').textContent = t('common.loadError');
        }
    };
    const show = event => {
        const node = event.target;
        if (window.currentMode !== 'pan' || isLinkMode() || node.data('isGroup') || node.data('isShape')) return;
        currentNode = node;
        selectTab('overview');
        renderNode(node);
        loadDetails(node);
    };
    const hide = () => {
        requestId++;
        request?.abort();
        panel.hidden = true;
        currentNode = null;
    };
    const showCard = () => {
        if (currentNode && typeof window.openDeviceModal === 'function') window.openDeviceModal(currentNode);
    };
    const copyAddress = async () => {
        // The details response may contain several IPs while the graph node has
        // only its short label. Copy exactly what the operator sees in the pane.
        const ip = field('inspectorIp').textContent.trim() || String(currentNode?.data('ip') || '').trim();
        if (!ip) return;

        const fallbackCopy = () => {
            const textarea = document.createElement('textarea');
            textarea.value = ip;
            textarea.setAttribute('readonly', '');
            textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none;';
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand('copy');
            textarea.remove();
            return copied;
        };

        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(ip);
            else if (!fallbackCopy()) throw new Error('Clipboard unavailable');
            showCopySuccess();
        } catch (error) {
            if (fallbackCopy()) {
                showCopySuccess();
            } else {
                console.warn('Unable to copy device IP:', error);
            }
        }
    };
    const onKey = event => {
        if (event.key === 'Escape' && !panel.hidden && !document.querySelector('.modal.show, .dropdown-menu.show')) hide();
    };
    const onRemove = event => { if (currentNode === event.target) hide(); };
    const onData = event => { if (currentNode === event.target) renderNode(currentNode); };
    const onModeChange = event => { if (event.detail.mode !== 'pan') hide(); };
    const onCanvasTap = event => {
        if (event.target === cy && !panel.hidden && window.currentMode === 'pan' && !isLinkMode()) hide();
    };
    cy.on('tap', 'node', show);
    cy.on('dbltap', 'node', hide);
    cy.on('tap', onCanvasTap);
    cy.on('data', 'node', onData);
    cy.on('remove', 'node', onRemove);
    close.addEventListener('click', hide);
    open.addEventListener('click', showCard);
    copyIp.addEventListener('click', copyAddress);
    document.addEventListener('keydown', onKey);
    window.addEventListener('linkvision:mode-changed', onModeChange);
    return () => {
        cy.off('tap', 'node', show);
        cy.off('dbltap', 'node', hide);
        cy.off('tap', onCanvasTap);
        cy.off('data', 'node', onData);
        cy.off('remove', 'node', onRemove);
        close.removeEventListener('click', hide);
        open.removeEventListener('click', showCard);
        copyIp.removeEventListener('click', copyAddress);
        tabs.forEach(tab => tab.removeEventListener('click', onTabClick));
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('linkvision:mode-changed', onModeChange);
        clearTimeout(copyFeedbackTimer);
        hide();
    };
}
