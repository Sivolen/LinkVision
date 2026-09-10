/** Отображение статистики качества ICMP в карточке устройства. */
import { t, getLocale } from '../i18n/i18n.js';

function tr(key, fallback) {
    const translated = t(key);
    return translated === key ? fallback : translated;
}
function value(v, suffix = '') {
    return v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}${suffix}`;
}
function qualityLabel(q) { return tr(`modal.quality.value.${q}`, q); }
function metricLabel(m) { return tr(`modal.quality.metric.${m}`, m); }
function metricClass(status) {
    return status === 'bad' ? 'quality-metric-bad' : status === 'degraded' ? 'quality-metric-degraded' : status === 'good' ? 'quality-metric-good' : 'quality-metric-unknown';
}
function esc(v) {
    return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
function chartTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(getLocale(), { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }).format(d);
}

function normaliseItems(data) {
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return items.filter(Boolean).map(x => ({ ...x, _time: new Date(x.timestamp).getTime() }))
        .filter(x => Number.isFinite(x._time)).sort((a,b) => a._time - b._time);
}

function makeSeriesChart(items, series, title, aria, suffix, step) {
    const width=760, height=250, left=58, right=18, top=28, bottom=42;
    const pw=width-left-right, ph=height-top-bottom;
    const points = items.map(item => ({ time:item.timestamp, values:series.map(s => Number(item[s.key])) }))
        .filter(p => p.values.some(Number.isFinite));
    if (!points.length) return '';
    const all=points.flatMap(p=>p.values.filter(Number.isFinite));
    const max=Math.max(...all, 1);
    const yMax=Math.max(step, Math.ceil(max/step)*step);
    const x=i=>left+(points.length===1?pw/2:i*pw/(points.length-1));
    const y=v=>top+ph-(v/yMax)*ph;
    const grid=[0,.25,.5,.75,1].map(r=>`<line x1="${left}" y1="${y(yMax*r)}" x2="${width-right}" y2="${y(yMax*r)}" class="quality-chart-grid"/><text x="${left-8}" y="${y(yMax*r)+4}" text-anchor="end" class="quality-chart-axis">${(yMax*r).toFixed(0)}</text>`).join('');
    const lines=series.map((s,si)=>{
        const pts=points.map((p,i)=>Number.isFinite(p.values[si])?`${x(i).toFixed(1)},${y(p.values[si]).toFixed(1)}`:null).filter(Boolean).join(' ');
        return pts ? `<polyline points="${pts}" class="quality-chart-line quality-chart-series-${si}" fill="none"/>` : '';
    }).join('');
    const dots=series.map((s,si)=>points.map((p,i)=>Number.isFinite(p.values[si])?`<circle cx="${x(i)}" cy="${y(p.values[si])}" r="3" class="quality-chart-point quality-chart-series-${si}"><title>${esc(`${s.label}: ${value(p.values[si],suffix)} — ${chartTime(p.time)}`)}</title></circle>`:'').join('')).join('');
    const first=points[0], last=points[points.length-1];
    // Промежуточные подписи по оси времени: раньше показывались только первая
    // и последняя точки — для окна в 24 часа (до ~288 точек) этого мало,
    // чтобы понять, на какое время суток пришёлся конкретный участок графика.
    // Берём умеренное число меток (5), равномерно распределённых по оси, и не
    // дублируем first/last, если шаг совпал с краем.
    const tickCount = Math.min(5, points.length);
    const tickIdx = points.length <= 1 ? [0] : Array.from({length: tickCount}, (_, i) => Math.round(i * (points.length - 1) / (tickCount - 1)));
    const uniqueTickIdx = [...new Set(tickIdx)];
    const labels = uniqueTickIdx.map((i, pos) => {
        const anchor = pos === 0 ? 'start' : pos === uniqueTickIdx.length - 1 ? 'end' : 'middle';
        return `<text x="${x(i).toFixed(1)}" y="${height-12}" text-anchor="${anchor}" class="quality-chart-axis">${esc(chartTime(points[i].time))}</text>`;
    }).join('');
    const legend=series.map((s,i)=>`<span class="quality-chart-legend-item quality-chart-series-${i}"><i></i>${esc(s.label)}</span>`).join('');
    return `<div class="quality-chart-title">${esc(title)}</div><div class="quality-chart-legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" class="quality-chart-svg" role="img" aria-label="${esc(aria)}">${grid}${lines}${dots}${labels}<text x="14" y="${top+ph/2}" transform="rotate(-90 14 ${top+ph/2})" text-anchor="middle" class="quality-chart-axis">${esc(suffix.trim())}</text></svg>`;
}

function makeLossChart(items) {
    const points=items.map(x=>({time:x.timestamp,value:Number(x.loss_percent)})).filter(x=>Number.isFinite(x.value));
    if(!points.length) return '';
    const width=760,height=190,left=58,right=18,top=24,bottom=40,pw=width-left-right,ph=height-top-bottom;
    const max=Math.max(5,Math.ceil(Math.max(...points.map(x=>x.value))/5)*5);
    const x=i=>left+(points.length===1?pw/2:i*pw/(points.length-1)), y=v=>top+ph-(v/max)*ph;
    const grid=[0,.5,1].map(r=>`<line x1="${left}" y1="${y(max*r)}" x2="${width-right}" y2="${y(max*r)}" class="quality-chart-grid"/><text x="${left-8}" y="${y(max*r)+4}" text-anchor="end" class="quality-chart-axis">${(max*r).toFixed(0)}%</text>`).join('');
    const line=points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' ');
    const dots=points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.value)}" r="3" class="quality-chart-point quality-chart-loss"><title>${esc(`${tr('modal.quality.loss','Потери')}: ${value(p.value,' %')} — ${chartTime(p.time)}`)}</title></circle>`).join('');
    const lossTickCount = Math.min(5, points.length);
    const lossTickIdx = points.length <= 1 ? [0] : Array.from({length: lossTickCount}, (_, i) => Math.round(i * (points.length - 1) / (lossTickCount - 1)));
    const lossLabels = [...new Set(lossTickIdx)].map((i, pos, arr) => {
        const anchor = pos === 0 ? 'start' : pos === arr.length - 1 ? 'end' : 'middle';
        return `<text x="${x(i).toFixed(1)}" y="${height-12}" text-anchor="${anchor}" class="quality-chart-axis">${esc(chartTime(points[i].time))}</text>`;
    }).join('');
    return `<div class="quality-chart-title">${esc(tr('modal.quality.lossChartTitle','Потери пакетов'))}</div><svg viewBox="0 0 ${width} ${height}" class="quality-chart-svg" role="img" aria-label="${esc(tr('modal.quality.lossChartLabel','График потерь пакетов'))}">${grid}<polyline points="${line}" class="quality-chart-line quality-chart-loss" fill="none"/>${dots}${lossLabels}</svg>`;
}

function renderCharts(chart, data, current) {
    // The chart is a pure time series of persisted 5-minute aggregates.
    // `live` is used by the metric cards, but it is NOT a chart point:
    // otherwise the last history point + current snapshot looks like a
    // second "24 hour" aggregate. A 24h view must contain only the
    // DeviceQualityHistory rows returned by the API (up to ~288 points).
    const items = normaliseItems(data);

    if (!items.length) {
        chart.innerHTML = `<div class="text-muted py-4 text-center">${esc(tr('modal.quality.noChartData','Нет данных для графика'))}</div>`;
        return;
    }

    const main = makeSeriesChart(items, [
        {key:'latency_avg_ms', label:tr('modal.quality.latency','Задержка')},
        {key:'jitter_ms', label:tr('modal.quality.jitterShort','Джиттер')}
    ], tr('modal.quality.chartTitle','Задержка и джиттер за 24 часа'),
       tr('modal.quality.chartLabel','График качества'), ' ms', 10);

    chart.innerHTML = main + makeLossChart(items) +
        `<div class="quality-chart-caption">${esc(tr('modal.quality.chartPeriod','Одна точка = один 5-минутный агрегат мониторинга'))}` +
        ` · ${esc(tr('modal.quality.chartPoints','Точек'))}: ${items.length}</div>`;
}

export function renderDeviceQuality(data, current=null) {
    const summary=document.getElementById('device-quality-summary'), chart=document.getElementById('device-quality-chart');
    if(!summary||!chart) return;
    const latest=current && current.quality_status && current.quality_status!=='unknown' ? {
        quality:current.quality_status, latency_avg_ms:current.quality_latency_ms, jitter_ms:current.quality_jitter_ms, loss_percent:current.quality_loss_percent, metric_status:current.quality_metric_status
    } : data?.latest;
    if(!latest){ summary.innerHTML=`<div class="text-muted">${esc(tr('modal.quality.noData','Нет накопленной статистики'))}</div>`; chart.innerHTML=''; return; }

    // IMPORTANT: metric status belongs to the same snapshot as the numbers.
    // Do not take statuses from an older history row when current live values
    // are shown in the card.
    const statuses=latest.metric_status || current?.quality_metric_status || data?.metric_status || {};
    const reasons=Object.entries(statuses).filter(([,s])=>s==='bad'||s==='degraded').map(([m,s])=>`${metricLabel(m)}: ${qualityLabel(s)}`);
    const reasonText=reasons.length?reasons.join(', '):tr('modal.quality.noProblems','Проблем по отдельным метрикам не обнаружено');
    const card=(m,v,suffix)=>`<div class="col-6 col-md-3"><div class="quality-metric-card ${metricClass(statuses[m])}"><strong>${esc(metricLabel(m))}</strong><div class="quality-metric-value">${value(v,suffix)}</div><small>${esc(qualityLabel(statuses[m]||'unknown'))}</small></div></div>`;
    summary.innerHTML=`<div class="row g-2">${card('latency',latest.latency_avg_ms,' ms')}${card('jitter',latest.jitter_ms,' ms')}${card('loss',latest.loss_percent,' %')}<div class="col-6 col-md-3"><div class="quality-metric-card quality-overall quality-${esc(latest.quality)}"><strong>${esc(tr('modal.quality.status','Качество'))}</strong><div class="quality-metric-value">${esc(qualityLabel(latest.quality))}</div><small>${esc(reasonText)}</small></div></div></div>`;
    renderCharts(chart,data,current);
}

export function clearDeviceQuality(){
    const s=document.getElementById('device-quality-summary'), c=document.getElementById('device-quality-chart');
    if(s)s.innerHTML=''; if(c)c.innerHTML='';
}

export async function loadDeviceQuality(deviceId,hours=24,current=null,preloaded=null){
    if(!deviceId)return;
    // Render details immediately, then ALWAYS fetch the dedicated history endpoint.
    if(preloaded) renderDeviceQuality(preloaded,current);
    try{
        const response=await fetch(`/api/device/${deviceId}/quality?hours=${hours}`,{cache:'no-store'});
        if(!response.ok)throw new Error(`quality request failed: ${response.status}`);
        renderDeviceQuality(await response.json(),current);
    }catch(err){
        Logger.error('Ошибка загрузки статистики качества:',err);
        if(!preloaded){
            const summary=document.getElementById('device-quality-summary');
            if(summary)summary.innerHTML=`<div class="text-danger">${esc(tr('common.loadError','Не удалось загрузить данные'))}</div>`;
        }
    }
}
