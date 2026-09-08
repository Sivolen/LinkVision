/** Отображение статистики качества ICMP в карточке устройства. */
import { t } from '../i18n/i18n.js';

function value(v, suffix = '') {
    return v === null || v === undefined || Number.isNaN(Number(v))
        ? '—'
        : `${Number(v).toFixed(2)}${suffix}`;
}

function qualityLabel(quality) {
    return t(`modal.quality.value.${quality}`) || quality;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderLatencyChart(items) {
    const valid = items
        .map(item => ({
            timestamp: item.timestamp,
            latency: Number(item.latency_avg_ms),
        }))
        .filter(item => Number.isFinite(item.latency));

    if (!valid.length) {
        return `<div class="device-quality-chart-empty">${t('modal.quality.noChartData')}</div>`;
    }

    const width = 760;
    const height = 260;
    const pad = { top: 28, right: 24, bottom: 42, left: 52 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const maxValue = Math.max(...valid.map(point => point.latency), 1);
    const chartMax = Math.ceil(maxValue * 1.15) || 1;

    const points = valid.map((point, index) => {
        const x = pad.left + (index / Math.max(valid.length - 1, 1)) * innerW;
        const y = pad.top + innerH - (point.latency / chartMax) * innerH;
        return { ...point, x, y };
    });

    const polyline = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const area = `${pad.left},${pad.top + innerH} ${polyline} ${points.at(-1).x.toFixed(1)},${pad.top + innerH}`;

    const grid = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const y = pad.top + innerH - ratio * innerH;
        const label = (chartMax * ratio).toFixed(0);
        return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" class="quality-chart-grid" />
                <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="quality-chart-axis">${label}</text>`;
    }).join('');

    const first = escapeHtml(new Date(valid[0].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    const last = escapeHtml(new Date(valid.at(-1).timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    return `<svg class="quality-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(t('modal.quality.chartLabel'))}">
        ${grid}
        <text x="${pad.left}" y="18" class="quality-chart-title">${escapeHtml(t('modal.quality.avgLatency'))}</text>
        <polygon points="${area}" class="quality-chart-area" />
        <polyline points="${polyline}" class="quality-chart-line" />
        ${points.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3" class="quality-chart-point">
            <title>${escapeHtml(new Date(point.timestamp).toLocaleString())}: ${value(point.latency, ' ms')}</title>
        </circle>`).join('')}
        <text x="${pad.left}" y="${height - 12}" class="quality-chart-axis">${first}</text>
        <text x="${width - pad.right}" y="${height - 12}" text-anchor="end" class="quality-chart-axis">${last}</text>
    </svg>`;
}

export function renderDeviceQuality(data, current = null) {
    const summary = document.getElementById('device-quality-summary');
    const chart = document.getElementById('device-quality-chart');
    if (!summary || !chart) return;

    const latest = (current?.quality_status && current.quality_status !== 'unknown' ? {
        quality: current.quality_status,
        latency_avg_ms: current.quality_latency_ms,
        jitter_ms: current.quality_jitter_ms,
        loss_percent: current.quality_loss_percent,
    } : null) || data?.latest;

    const items = Array.isArray(data?.items) ? data.items : [];
    if (!latest && !items.length) {
        summary.innerHTML = `<div class="text-muted quality-empty-state">${t('modal.quality.noData')}</div>`;
        chart.innerHTML = '';
        return;
    }

    if (latest) {
        summary.innerHTML = `
            <div class="quality-summary-grid">
                <div class="quality-metric-card">
                    <span class="quality-metric-label">${t('modal.quality.latency')}</span>
                    <strong>${value(latest.latency_avg_ms, ' ms')}</strong>
                </div>
                <div class="quality-metric-card">
                    <span class="quality-metric-label">${t('modal.quality.jitter')}</span>
                    <strong>${value(latest.jitter_ms, ' ms')}</strong>
                </div>
                <div class="quality-metric-card">
                    <span class="quality-metric-label">${t('modal.quality.loss')}</span>
                    <strong>${value(latest.loss_percent, ' %')}</strong>
                </div>
                <div class="quality-metric-card quality-metric-status">
                    <span class="quality-metric-label">${t('modal.quality.status')}</span>
                    <span class="badge quality-${escapeHtml(latest.quality)}">${escapeHtml(qualityLabel(latest.quality))}</span>
                </div>
            </div>`;
    } else {
        summary.innerHTML = '';
    }

    chart.innerHTML = `
        <div class="device-quality-chart-header">
            <div>
                <strong>${t('modal.quality.chartTitle')}</strong>
                <div class="text-muted small">${t('modal.quality.chartSubtitle')}</div>
            </div>
            <span class="quality-chart-period">24 h</span>
        </div>
        ${renderLatencyChart(items)}`;
}

export function clearDeviceQuality() {
    const summary = document.getElementById('device-quality-summary');
    const chart = document.getElementById('device-quality-chart');
    if (summary) summary.innerHTML = '';
    if (chart) chart.innerHTML = '';
}

export async function loadDeviceQuality(deviceId, hours = 24, current = null, preloaded = null) {
    if (!deviceId) return;

    if (preloaded) {
        renderDeviceQuality(preloaded, current);
        return;
    }

    try {
        const response = await fetch(`/api/device/${deviceId}/quality?hours=${hours}`);
        if (!response.ok) throw new Error('quality request failed');
        renderDeviceQuality(await response.json(), current);
    } catch (err) {
        Logger.error('Ошибка загрузки статистики качества:', err);
        const summary = document.getElementById('device-quality-summary');
        if (summary) summary.innerHTML = `<div class="text-danger">${t('common.loadError')}</div>`;
    }
}
