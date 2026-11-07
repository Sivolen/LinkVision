// Quick device overview, drawn over the map without resizing Cytoscape.
import { isLinkMode } from './modes.js';
import { renderQualityPreview } from '../modal/quality.js';
import { t, getLocale } from '../i18n/i18n.js';
import { http } from '../utils/http.js';
import { showToast } from '../utils/toast.js';

export function initDeviceInspector(cy) {
    const panel = document.getElementById('mapDeviceInspector');
    if (!panel) return () => {};
    const field = id => document.getElementById(id);
    const close = field('inspectorClose');
    const copyIp = field('inspectorCopyIp');
    const settingsForm = field('inspectorSettingsForm');
    const ipFields = field('inspectorEditIps');
    const addIp = field('inspectorAddIp');
    const historyBox = field('inspectorHistory');
    const historyPagination = field('inspectorHistoryPagination');
    const historyPrevious = field('inspectorHistoryPrev');
    const historyNext = field('inspectorHistoryNext');
    const historyPage = field('inspectorHistoryPage');
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
    let historyState = { page: 1, pages: 1 };
    const copyLabel = copyIp.getAttribute('aria-label') || copyIp.getAttribute('title') || '';
    const setSettingsEnabled = canEdit => {
        settingsForm?.querySelectorAll('input, textarea, select, button').forEach(control => {
            control.disabled = !canEdit;
        });
    };

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
    const statusLabel = status => status === 'up' ? panel.dataset.upLabel : status === 'down' ? panel.dataset.downLabel : status === 'partial' ? panel.dataset.partialLabel : panel.dataset.unknownLabel;
    const formatDate = value => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(date);
    };
    const setOptions = (select, items, selected, placeholder, skipDefault = false) => {
        if (!select) return;
        select.replaceChildren();
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = placeholder;
        select.append(empty);
        items.filter(item => !(skipDefault && item.is_default === true)).forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name;
            select.append(option);
        });
        select.value = selected == null ? '' : String(selected);
    };
    const addIpField = (value = '') => {
        if (!ipFields) return;
        const row = document.createElement('div');
        row.className = 'map-inspector-ip-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inspector-edit-ip';
        input.value = value;
        input.placeholder = t('modal.ip.placeholder');
        input.autocomplete = 'off';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'map-inspector-remove-ip';
        remove.setAttribute('aria-label', t('modal.ip.removeIp'));
        remove.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
        remove.addEventListener('click', () => {
            if (ipFields.children.length > 1) row.remove();
            else input.value = '';
        });
        row.append(input, remove);
        ipFields.append(row);
    };
    const renderHistory = (items, page, pages) => {
        if (!historyBox) return;
        historyBox.replaceChildren();
        if (!items.length) {
            historyBox.textContent = t('modal.history.noRecords');
        } else {
            items.forEach(item => {
                const row = document.createElement('div');
                const change = document.createElement('span');
                const oldStatus = item.old_status === 'true' ? 'up' : item.old_status === 'false' ? 'down' : item.old_status;
                const newStatus = item.new_status === 'true' ? 'up' : item.new_status === 'false' ? 'down' : item.new_status;
                change.textContent = `${statusLabel(oldStatus)} → ${statusLabel(newStatus)}`;
                const time = document.createElement('time');
                time.textContent = formatDate(item.timestamp);
                row.append(change, time);
                historyBox.append(row);
            });
        }
        historyState = { page, pages };
        if (historyPagination) historyPagination.hidden = pages <= 1;
        if (historyPage) historyPage.textContent = `${page} / ${pages}`;
        if (historyPrevious) historyPrevious.disabled = page <= 1;
        if (historyNext) historyNext.disabled = page >= pages;
    };
    const loadHistory = async (page = 1, node = currentNode) => {
        if (!node || !historyBox) return;
        historyBox.textContent = '…';
        try {
            const response = await fetch(`/api/device/${encodeURIComponent(node.id())}/history?page=${page}&per_page=10`);
            if (!response.ok) throw new Error('history');
            const data = await response.json();
            if (currentNode !== node || panel.hidden) return;
            const items = Array.isArray(data) ? data.slice((page - 1) * 10, page * 10) : (data.items || []);
            const pages = Array.isArray(data) ? Math.max(1, Math.ceil(data.length / 10)) : (data.pages || 1);
            renderHistory(items, Array.isArray(data) ? page : (data.page || page), pages);
        } catch (_) {
            historyBox.textContent = t('common.loadError');
        }
    };
    const populateSettings = async details => {
        if (!settingsForm) return;
        field('inspectorEditName').value = details.name || currentNode?.data('name') || '';
        ipFields?.replaceChildren();
        const ips = Array.isArray(details.ips) && details.ips.length ? details.ips : [''];
        ips.forEach(addIpField);
        field('inspectorEditMonitoring').checked = details.monitoring_enabled !== false;
        field('inspectorEditFontSize').value = currentNode?.data('fontSize') || '';
        try {
            const [typesResponse, groupsResponse, profilesResponse] = await Promise.all([
                fetch('/api/types'),
                fetch(`/api/map/${encodeURIComponent(window.currentMapId)}/groups`),
                fetch('/api/quality-profiles')
            ]);
            const [types, groups, profiles] = await Promise.all([
                typesResponse.ok ? typesResponse.json() : [], groupsResponse.ok ? groupsResponse.json() : [], profilesResponse.ok ? profilesResponse.json() : []
            ]);
            if (!currentNode) return;
            setOptions(field('inspectorEditType'), types, details.type_id, t('modal.device.selectTypeOpt'));
            setOptions(field('inspectorEditGroup'), groups, details.group_id, t('modal.device.noGroupOpt'));
            setOptions(field('inspectorEditQualityProfile'), profiles, details.quality_profile_id, t('modal.device.defaultQualityProfileOpt'), true);
        } catch (_) { /* The form remains usable with already loaded values. */ }
    };
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
            populateSettings(details);
            const events = field('inspectorEvents');
            events.replaceChildren();
            const history = Array.isArray(details.history?.items) ? details.history.items.slice(0, 3) : [];
            field('inspectorEventsSection').hidden = history.length === 0;
            history.forEach(item => {
                const row = document.createElement('div');
                const status = document.createElement('span');
                status.className = 'map-inspector-event-status';
                status.dataset.status = item.new_status || 'unknown';
                status.textContent = statusLabel(item.new_status);
                const time = document.createElement('time');
                time.textContent = formatDate(item.timestamp);
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
                    if (neighbor.nonempty()) show({ target: neighbor }, 'links');
                });
                neighbors.appendChild(row);
            });
        } catch (error) {
            if (error.name === 'AbortError' || id !== requestId) return;
            chart.textContent = t('common.loadError');
            field('inspectorNeighbors').textContent = t('common.loadError');
        }
    };
    const show = (event, tab = 'overview') => {
        const node = event.target;
        const pointer = event.originalEvent;
        if (
            window.currentMode !== 'pan' || isLinkMode() || node.data('isGroup') || node.data('isShape')
            || pointer?.ctrlKey || pointer?.metaKey || pointer?.shiftKey
        ) return;
        currentNode = node;
        selectTab(tab);
        setSettingsEnabled(window.canEditMap === true);
        renderNode(node);
        loadDetails(node);
        loadHistory(1);
    };
    const hide = () => {
        requestId++;
        request?.abort();
        panel.hidden = true;
        currentNode = null;
    };
    const saveSettings = async event => {
        event.preventDefault();
        if (!currentNode || window.canEditMap !== true) return;
        const name = field('inspectorEditName').value.trim();
        const typeId = field('inspectorEditType').value;
        const ips = [...ipFields.querySelectorAll('.inspector-edit-ip')].map(input => input.value.trim()).filter(Boolean);
        if (!name || !typeId) {
            showToast(t('toast.errorTitle'), t('modal.device.nameTypeRequired'), 'error');
            return;
        }
        const fontSizeText = field('inspectorEditFontSize').value;
        const data = {
            name, ips, type_id: Number(typeId),
            group_id: field('inspectorEditGroup').value ? Number(field('inspectorEditGroup').value) : null,
            monitoring_enabled: field('inspectorEditMonitoring').checked,
            quality_profile_id: field('inspectorEditQualityProfile').value ? Number(field('inspectorEditQualityProfile').value) : null,
            font_size: fontSizeText === '' ? null : Number(fontSizeText)
        };
        const save = field('inspectorSave');
        save.disabled = true;
        try {
            await http.put(`/api/device/${encodeURIComponent(currentNode.id())}`, data);
            if (typeof window.updateDevice === 'function') window.updateDevice({ id: currentNode.id(), ...data });
            currentNode.data('fontSize', data.font_size);
            cy.style().update();
            renderNode(currentNode);
            loadDetails(currentNode);
            showToast(t('toast.successTitle'), t('modal.device.updated'), 'success');
        } catch (error) {
            showToast(t('toast.errorTitle'), error.message || t('modal.device.saveFail'), 'error');
        } finally {
            save.disabled = false;
        }
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
    const onLinkModeChange = event => { if (event.detail?.active) hide(); };
    const onEditPermissionChange = event => setSettingsEnabled(event.detail?.canEdit === true);
    const onInspectRequest = event => {
        const node = event.detail?.node;
        if (!node?.nonempty?.()) return;
        show({ target: node });
        if (event.detail?.tab) selectTab(event.detail.tab === 'settings' && !settingsForm ? 'overview' : event.detail.tab);
    };
    const onAddIp = () => addIpField();
    const onCanvasTap = event => {
        if (event.target === cy && !panel.hidden && window.currentMode === 'pan' && !isLinkMode()) hide();
    };
    cy.on('tap', 'node', show);
    cy.on('tap', onCanvasTap);
    cy.on('data', 'node', onData);
    cy.on('remove', 'node', onRemove);
    close.addEventListener('click', hide);
    settingsForm?.addEventListener('submit', saveSettings);
    addIp?.addEventListener('click', onAddIp);
    historyPrevious?.addEventListener('click', () => loadHistory(historyState.page - 1));
    historyNext?.addEventListener('click', () => loadHistory(historyState.page + 1));
    copyIp.addEventListener('click', copyAddress);
    document.addEventListener('keydown', onKey);
    window.addEventListener('linkvision:mode-changed', onModeChange);
    window.addEventListener('linkvision:link-mode-changed', onLinkModeChange);
    window.addEventListener('linkvision:edit-permission-changed', onEditPermissionChange);
    window.addEventListener('linkvision:inspect-device', onInspectRequest);
    return () => {
        cy.off('tap', 'node', show);
        cy.off('tap', onCanvasTap);
        cy.off('data', 'node', onData);
        cy.off('remove', 'node', onRemove);
        close.removeEventListener('click', hide);
        settingsForm?.removeEventListener('submit', saveSettings);
        addIp?.removeEventListener('click', onAddIp);
        copyIp.removeEventListener('click', copyAddress);
        tabs.forEach(tab => tab.removeEventListener('click', onTabClick));
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('linkvision:mode-changed', onModeChange);
        window.removeEventListener('linkvision:link-mode-changed', onLinkModeChange);
        window.removeEventListener('linkvision:edit-permission-changed', onEditPermissionChange);
        window.removeEventListener('linkvision:inspect-device', onInspectRequest);
        clearTimeout(copyFeedbackTimer);
        hide();
    };
}
