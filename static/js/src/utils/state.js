// state.js – счётчик незавершённых self-обновлений
// Заменяет булевый skipNextMapUpdate на надёжный счётчик

let pendingSelfUpdates = 0;
const localOperationIds = new Set();

export function beginSelfUpdate() {
    pendingSelfUpdates++;
}

export function endSelfUpdate() {
    pendingSelfUpdates = Math.max(0, pendingSelfUpdates - 1);
}

export function isSelfUpdating() {
    return pendingSelfUpdates > 0;
}

export function getPendingCount() {
    return pendingSelfUpdates;
}

// Keep a short-lived record so the initiating tab can ignore its own
// optimistic Socket.IO echo without suppressing concurrent changes from peers.
export function rememberLocalOperation(operationId, ttlMs = 30000) {
    if (!operationId) return;
    localOperationIds.add(operationId);
    setTimeout(() => localOperationIds.delete(operationId), ttlMs);
}

export function isLocalOperation(operationId) {
    return Boolean(operationId && localOperationIds.has(operationId));
}
