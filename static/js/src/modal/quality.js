/** Отображение статистики качества ICMP в карточке устройства. */
import { t, getLocale } from '../i18n/i18n.js';

function tr(key, fallback) {
    const translated = t(key);
    return translated === key ? fallback : translated;
}

function value(v, suffix = '') {
    return v === null || v === undefined || Number.isNaN(Number(v))
        ? '—'
        : `${Number(v).toFixed(2)}${suffix}`;
}

function qualityLabel(quality) {
    return tr(`modal.quality.value.${quality}`, quality);
}

function formatChartTime(timestamp) {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(getLocale(), {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function escapeSvgText(valueText) {
    return String(valueText)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function renderLatencyChart(chart, items, latest) {
    const width = 760;
    const height = 250;
    const padLeft = 58;
    const padRight = 18;
    const padTop = 30;
    const padBottom = 42;
    const plotWidth = width - padLeft - padRight;
    const plotHeight = height - padTop - padBottom;

    const rawItems = Array.isArray(items)
        ? items
        : (items && Array.isArray(items.items) ? items.items : []);

    const pointsData = rawItems
        .filter(item => item && item.latency_avg_ms !== null && item.latency_avg_ms !== undefined)
        .map(item => ({
            value: Number(item.latency_avg_ms),
            time: item.timestamp || item.created_at || item.recorded_at
        }))
        .filter(item => Number.isFinite(item.value));

    if (!pointsData.length) {
        chart.innerHTML = `<div class="text-muted py-4 text-center">${escapeSvgText(tr('modal.quality.noChartData', 'Нет данных для графика'))}</div>`;
        return;
    }

    const maxValue = Math.max(...pointsData.map(point => point.value), 1);
    const yMax = Math.ceil(maxValue / 10) * 10 || 10;
    const yTicks = [0, 0.25, 0.5, 0.75, 1];
    const xFor = index => padLeft + (pointsData.length === 1 ? plotWidth / 2 : index * plotWidth / (pointsData.length - 1));
    const yFor = valueNumber => padTop + plotHeight - (valueNumber / yMax) * plotHeight;
    const linePoints = pointsData.map((point, index) => `${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(' ');

    const grid = yTicks.map(ratio => {
        const y = padTop + plotHeight - ratio * plotHeight;
        const label = (yMax * ratio).toFixed(0);
        return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="quality-chart-grid" />
                <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" class="quality-chart-axis">${label}</text>`;
    }).join('');

    const first = pointsData[0];
    const last = pointsData[pointsData.length - 1];
    const xLabels = pointsData.length === 1
        ? `<text x="${xFor(0)}" y="${height - 12}" text-anchor="middle" class="quality-chart-axis">${escapeSvgText(formatChartTime(first.time))}</text>`
        : `<text x="${xFor(0)}" y="${height - 12}" text-anchor="start" class="quality-chart-axis">${escapeSvgText(formatChartTime(first.time))}</text>
           <text x="${xFor(pointsData.length - 1)}" y="${height - 12}" text-anchor="end" class="quality-chart-axis">${escapeSvgText(formatChartTime(last.time))}</text>`;

    const circles = pointsData.map((point, index) => {
        const x = xFor(index);
        const y = yFor(point.value);
        const tooltip = `${tr('modal.quality.avgLatency', 'Средняя задержка')}: ${value(point.value, ' ms')} — ${formatChartTime(point.time)}`;
        return `<circle cx="${x}" cy="${y}" r="3" class="quality-chart-point"><title>${escapeSvgText(tooltip)}</title></circle>`;
    }).join('');

    chart.innerHTML = `<div class="quality-chart-title">${escapeSvgText(tr('modal.quality.chartTitle', 'Средняя задержка за 24 часа'))}</div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvgText(tr('modal.quality.chartLabel', 'График средней задержки'))}" class="quality-chart-svg">
            ${grid}
            ${pointsData.length > 1 ? `<polyline points="${linePoints}" class="quality-chart-line" fill="none" />` : ''}
            ${circles}
            ${xLabels}
            <text x="14" y="${padTop + plotHeight / 2}" transform="rotate(-90 14 ${padTop + plotHeight / 2})" text-anchor="middle" class="quality-chart-axis">${escapeSvgText(tr('modal.quality.latencyAxis', 'Задержка, мс'))}</text>
        </svg>
        <div class="quality-chart-caption">${escapeSvgText(tr('modal.quality.chartPeriod', 'Показана история средней задержки за последние 24 часа'))}</div>`;
}

export function renderDeviceQuality(data, current = null) {
    const summary = document.getElementById('device-quality-summary');
    const chart = document.getElementById('device-quality-chart');
    if (!summary || !chart) return;

    const latest = (current?.quality_status && current.quality_status !== 'unknown' ? {
        quality: current.quality_status,
        latency_avg_ms: current.quality_latency_ms,
        jitter_ms: current.quality_jitter_ms,
        loss_percent: current.quality_loss_percent
    } : null) || data?.latest;

    if (!latest) {
        summary.innerHTML = `<div class="text-muted">${escapeSvgText(tr('modal.quality.noData', 'Нет накопленной статистики'))}</div>`;
        chart.innerHTML = '';
        return;
    }

    summary.innerHTML = `
        <div class="row g-2">
            <div class="col-6 col-md-3"><strong>${escapeSvgText(tr('modal.quality.latency', 'Задержка'))}</strong><br>${value(latest.latency_avg_ms, ' ms')}</div>
            <div class="col-6 col-md-3"><strong>${escapeSvgText(tr('modal.quality.jitter', 'Джиттер'))}</strong><br>${value(latest.jitter_ms, ' ms')}</div>
            <div class="col-6 col-md-3"><strong>${escapeSvgText(tr('modal.quality.loss', 'Потери'))}</strong><br>${value(latest.loss_percent, ' %')}</div>
            <div class="col-6 col-md-3"><strong>${escapeSvgText(tr('modal.quality.status', 'Качество'))}</strong><br><span class="badge quality-${escapeSvgText(latest.quality)}">${escapeSvgText(qualityLabel(latest.quality))}</span></div>
        </div>`;

    const historyItems = Array.isArray(data?.items)
        ? data.items
        : (Array.isArray(data) ? data : []);

    // История пишется агрегатами раз в 5 минут. Сразу после начала
    // мониторинга она может быть ещё пустой, хотя live-метрики уже есть.
    // В этом случае всё равно рисуем текущую точку, чтобы график не выглядел
    // сломанным. Когда накопится история, она полностью заменит этот fallback.
    const chartItems = historyItems.length > 0
        ? historyItems
        : (latest?.latency_avg_ms !== null && latest?.latency_avg_ms !== undefined
            ? [{
                timestamp: current?.quality_last_check || data?.latest?.timestamp || new Date().toISOString(),
                latency_avg_ms: latest.latency_avg_ms,
            }]
            : []);

    renderLatencyChart(chart, chartItems, latest);
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
        if (summary) summary.innerHTML = `<div class="text-danger">${escapeSvgText(tr('common.loadError', 'Не удалось загрузить данные'))}</div>`;
    }
}
