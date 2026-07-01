// state.js – счётчик незавершённых self-обновлений
// Заменяет булевый skipNextMapUpdate на надёжный счётчик

let pendingSelfUpdates = 0;

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
