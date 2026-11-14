export const QUALITY_MEASUREMENTS_EVENT = 'linkvision:quality-measurements';

// The bundled Cytoscape returns the underlying data object from data().
// Numeric samples are read by the inspector, never by graph selectors or
// styles. Writing through the normal setter would invalidate node styles and
// compound bounds. Keep the same values available to other readers and emit
// a dedicated event for the inspector.
export function updateQualityMeasurements(node, reading = {}) {
    const data = node.data();
    let changed = false;
    for (const key of ['quality_latency_ms', 'quality_jitter_ms', 'quality_loss_percent']) {
        const value = reading[key] ?? null;
        if (data[key] === value) continue;
        data[key] = value;
        changed = true;
    }
    if (changed) node.emit(QUALITY_MEASUREMENTS_EVENT);
}
