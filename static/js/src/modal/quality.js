/** Отображение статистики качества ICMP в карточке устройства. */
import { t } from '../i18n/i18n.js';

function value(v, suffix = '') {
    return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}${suffix}`;
}

function qualityLabel(quality) {
    return t(`modal.quality.value.${quality}`) || quality;
}

export function renderDeviceQuality(data, current = null) {
    const summary = document.getElementById('device-quality-summary');
    const chart = document.getElementById('device-quality-chart');
    if (!summary || !chart) return;

    // ВАЖНО: приоритет живых полей самой Device (current.quality_status и
    // т.д.) над агрегатом из DeviceQualityHistory (data.latest). Это две
    // РАЗНЫЕ, независимо считающиеся величины на бэкенде:
    // - device.quality_status — "живое" значение с hysteresis-логикой
    //   (быстрый возврат к good на чистом цикле / сглаживание по
    //   скользящему окну), обновляется в monitor_loop и ИМЕННО оно летит по
    //   сокету и красит иконку на карте;
    // - DeviceQualityHistory — агрегат по ВСЕМУ 5-минутному окну целиком,
    //   записывается раз в QUALITY_PERSIST_SECONDS, независимо от
    //   hysteresis-логики выше.
    // Раньше здесь было наоборот (data.latest в приоритете) — из-за этого
    // карточка устройства могла показывать "good" из истории в тот самый
    // момент, когда живое значение на иконке карты ещё "degraded" (или
    // наоборот), хотя оба поля технически "верны" каждое для своего
    // определения. Сводка в карточке должна совпадать с тем, что видно на
    // карте — а график ниже как раз показывает историю отдельно.
    const latest = (current?.quality_status && current.quality_status !== 'unknown' ? {
        quality: current.quality_status, latency_avg_ms: current.quality_latency_ms,
        jitter_ms: current.quality_jitter_ms, loss_percent: current.quality_loss_percent
    } : null) || data?.latest;
    if (!latest) {
        summary.innerHTML = `<div class="text-muted">${t('modal.quality.noData')}</div>`;
        chart.innerHTML = '';
        return;
    }

    summary.innerHTML = `
        <div class="row g-2">
            <div class="col-6 col-md-3"><strong>${t('modal.quality.latency')}</strong><br>${value(latest.latency_avg_ms, ' ms')}</div>
            <div class="col-6 col-md-3"><strong>${t('modal.quality.jitter')}</strong><br>${value(latest.jitter_ms, ' ms')}</div>
            <div class="col-6 col-md-3"><strong>${t('modal.quality.loss')}</strong><br>${value(latest.loss_percent, ' %')}</div>
            <div class="col-6 col-md-3"><strong>${t('modal.quality.status')}</strong><br><span class="badge quality-${latest.quality}">${qualityLabel(latest.quality)}</span></div>
        </div>`;

    const items = data.items || [];
    const width = 700, height = 180, pad = 28;
    const max = Math.max(...items.map(x => x.latency_avg_ms || 0), 1);
    const points = items.map((x, i) => {
        const px = pad + (i * (width - pad * 2) / Math.max(items.length - 1, 1));
        const py = height - pad - ((x.latency_avg_ms || 0) / max) * (height - pad * 2);
        return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(' ');
    chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${t('modal.quality.chartLabel')}">
        <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" />
        <text x="${pad}" y="18" font-size="12">${t('modal.quality.avgLatency')}: ${value(latest.latency_avg_ms, ' ms')}</text>
    </svg>`;
}

/**
 * Очистить вкладку "Качество" — вызывается при открытии модалки для НОВОГО
 * устройства, чтобы не показывать график/сводку от предыдущего открытого
 * устройства (ничего не сбрасывало эти два div, и они хранили чужие данные
 * до следующего успешного fetch).
 */
export function clearDeviceQuality() {
    const summary = document.getElementById('device-quality-summary');
    const chart = document.getElementById('device-quality-chart');
    if (summary) summary.innerHTML = '';
    if (chart) chart.innerHTML = '';
}

export async function loadDeviceQuality(deviceId, hours = 24, current = null, preloaded = null) {
    if (!deviceId) return;

    // /api/device/<id>/details (см. device_service.get_device_details) уже
    // кладёт agregированную историю качества в data.quality_history — если
    // вызывающий код её передал, повторный запрос за теми же данными не
    // нужен. Раньше карточка устройства при каждом открытии всегда делала
    // ВТОРОЙ поход в БД за уже полученными данными.
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
