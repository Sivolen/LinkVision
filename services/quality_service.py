"""
Сервис для расчёта и запросов качества ICMP.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from extensions import db
from models import DeviceQualityHistory, QualityProfile, Device

# Пороги "фабричного" профиля — используются только как значения по
# умолчанию при СОЗДАНИИ дефолтного профиля (см. ensure_default_profile) и
# как аварийный fallback, если из БД по какой-то причине не удалось прочитать
# ни один профиль (например, до применения миграции). Раньше эти же числа
# были захардкожены прямо в формуле ниже — теперь пороги настраиваются через
# QualityProfile (Настройки -> рядом с параметрами пинга), это лишь исходные
# значения по умолчанию.
FALLBACK_THRESHOLDS: Dict[str, float] = {
    "loss_degraded_percent": 1.0,
    "loss_bad_percent": 5.0,
    "latency_degraded_ms": 50.0,
    "latency_bad_ms": 100.0,
    "jitter_degraded_ms": 10.0,
    "jitter_bad_ms": 30.0,
}


def _metric_status(value: Optional[float], degraded: float, bad: float) -> str:
    if value is None:
        return "unknown"
    value = float(value)
    if value >= float(bad):
        return "bad"
    if value >= float(degraded):
        return "degraded"
    return "good"


def get_metric_statuses(
    latency_avg_ms: Optional[float],
    jitter_ms: Optional[float],
    loss_percent: Optional[float],
    thresholds: Optional[Dict[str, float]] = None,
) -> Dict[str, str]:
    t = thresholds or FALLBACK_THRESHOLDS
    return {
        "latency": _metric_status(latency_avg_ms, t["latency_degraded_ms"], t["latency_bad_ms"]),
        "jitter": _metric_status(jitter_ms, t["jitter_degraded_ms"], t["jitter_bad_ms"]),
        "loss": _metric_status(loss_percent, t["loss_degraded_percent"], t["loss_bad_percent"]),
    }


def get_device_quality_thresholds(device_id: int) -> Dict[str, float]:
    ensure_default_quality_profile()
    device = Device.query.get(device_id)
    if not device:
        return dict(FALLBACK_THRESHOLDS)
    profile = None
    if device.quality_profile_id:
        profile = QualityProfile.query.get(device.quality_profile_id)
    if profile is None:
        profile = QualityProfile.query.filter_by(is_default=True).first()
    return profile_to_thresholds(profile) if profile else dict(FALLBACK_THRESHOLDS)


def get_device_quality_history(device_id: int, hours: int = 24) -> Dict[str, Any]:
    """Return every persisted quality aggregate in the requested time range.

    History rows are 5-minute aggregates; they are deliberately NOT collapsed
    into a daily average. The current live sample is returned separately so the
    UI can show it without pretending it is a historical 5-minute point.
    """
    hours = max(1, min(int(hours or 24), 720))
    cutoff = datetime.now() - timedelta(hours=hours)
    thresholds = get_device_quality_thresholds(device_id)
    items = (
        DeviceQualityHistory.query.filter(
            DeviceQualityHistory.device_id == device_id,
            DeviceQualityHistory.timestamp >= cutoff,
        )
        .order_by(DeviceQualityHistory.timestamp.asc(), DeviceQualityHistory.id.asc())
        .all()
    )

    records = []
    for item in items:
        records.append({
            "id": item.id,
            "timestamp": item.timestamp.isoformat(),
            "samples": item.samples,
            "loss_percent": item.loss_percent,
            "latency_min_ms": item.latency_min_ms,
            "latency_avg_ms": item.latency_avg_ms,
            "latency_max_ms": item.latency_max_ms,
            "jitter_ms": item.jitter_ms,
            "quality": item.quality,
            "metric_status": get_metric_statuses(
                item.latency_avg_ms, item.jitter_ms, item.loss_percent, thresholds
            ),
        })

    # Live snapshot is deliberately separate from persisted 5-minute history.
    # This lets the UI draw the current point even when the first history
    # aggregate has not been persisted yet, and avoids guessing field names
    # from /details response on the frontend.
    device = Device.query.get(device_id)
    live = None
    if device and device.quality_last_check:
        live_latency = device.quality_latency_ms
        live_jitter = device.quality_jitter_ms
        live_loss = device.quality_loss_percent
        live_quality = device.quality_status or "unknown"
        live = {
            "timestamp": device.quality_last_check.isoformat(),
            "quality": live_quality,
            "latency_avg_ms": live_latency,
            "jitter_ms": live_jitter,
            "loss_percent": live_loss,
            "metric_status": get_metric_statuses(
                live_latency, live_jitter, live_loss, thresholds
            ),
        }

    latest = records[-1] if records else None
    return {
        "hours": hours,
        "interval_seconds": 300,
        "count": len(records),
        "latest": latest,
        "items": records,
        "live": live,
        "thresholds": thresholds,
    }

def calculate_quality(
    metrics: Optional[Dict[str, Any]], thresholds: Optional[Dict[str, float]] = None
) -> Tuple[str, Optional[float], Optional[float], Optional[float]]:
    """
    Рассчитать качество ICMP по метрикам пинга.

    Args:
        metrics: Словарь с latencies, jitter_values, samples
        thresholds: Пороги профиля качества (см. profile_to_thresholds) —
            если не переданы, используется FALLBACK_THRESHOLDS (аварийный
            случай — обычный вызов из monitor.py всегда передаёт thresholds
            конкретного профиля устройства).

    Returns:
        Кортеж (quality, latency_avg, jitter, loss_percent)
    """
    if not metrics:
        return "unknown", None, None, None

    t = thresholds or FALLBACK_THRESHOLDS

    latencies = metrics.get("latencies", [])
    jitter_values = metrics.get("jitter_values", [])
    sent = metrics.get("samples", 0)
    received = len(latencies)
    loss = ((sent - received) / sent * 100.0) if sent else 100.0
    avg = sum(latencies) / len(latencies) if latencies else None
    jitter = sum(jitter_values) / len(jitter_values) if jitter_values else None

    if (
        loss >= t["loss_bad_percent"]
        or (avg is not None and avg >= t["latency_bad_ms"])
        or (jitter is not None and jitter >= t["jitter_bad_ms"])
    ):
        quality = "bad"
    elif (
        loss >= t["loss_degraded_percent"]
        or (avg is not None and avg >= t["latency_degraded_ms"])
        or (jitter is not None and jitter >= t["jitter_degraded_ms"])
    ):
        quality = "degraded"
    else:
        quality = "good"

    return quality, avg, jitter, loss


def validate_quality_thresholds(thresholds: Dict[str, float]) -> None:
    """Проверить согласованность порогов профиля качества."""
    required = set(FALLBACK_THRESHOLDS)
    missing = required - set(thresholds)
    if missing:
        raise ValueError(f"Не заданы пороги качества: {', '.join(sorted(missing))}")

    for key, value in thresholds.items():
        try:
            number = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"Порог «{key}» должен быть числом")
        if number < 0:
            raise ValueError(f"Порог «{key}» не может быть отрицательным")

    pairs = (
        ("loss_degraded_percent", "loss_bad_percent"),
        ("latency_degraded_ms", "latency_bad_ms"),
        ("jitter_degraded_ms", "jitter_bad_ms"),
    )
    for degraded, bad in pairs:
        if float(thresholds[degraded]) >= float(thresholds[bad]):
            raise ValueError(
                f"Порог «{degraded}» должен быть меньше порога «{bad}»"
            )


def profile_to_thresholds(profile: QualityProfile) -> Dict[str, float]:
    """Преобразовать ORM-объект профиля в словарь порогов для calculate_quality()."""
    return {
        "loss_degraded_percent": profile.loss_degraded_percent,
        "loss_bad_percent": profile.loss_bad_percent,
        "latency_degraded_ms": profile.latency_degraded_ms,
        "latency_bad_ms": profile.latency_bad_ms,
        "jitter_degraded_ms": profile.jitter_degraded_ms,
        "jitter_bad_ms": profile.jitter_bad_ms,
    }


def ensure_default_quality_profile() -> QualityProfile:
    """
    Гарантировать существование ровно одного профиля с is_default=True.

    Вызывается лениво (при первом обращении к профилям — из get_all_quality_profiles
    и из monitor_loop) — если профилей в БД ещё нет вообще (свежая установка
    или БД до этой фичи), создаёт профиль "По умолчанию" с историческими
    порогами (FALLBACK_THRESHOLDS), чтобы поведение мониторинга не изменилось
    молча в момент внедрения профилей.
    """
    default_profile = QualityProfile.query.filter_by(is_default=True).first()
    if default_profile:
        return default_profile

    # Есть профили, но почему-то ни один не помечен дефолтным (не должно
    # происходить при нормальной работе сервиса — delete/update ниже это
    # предотвращают, но на всякий случай не создаём второй "По умолчанию").
    any_profile = QualityProfile.query.order_by(QualityProfile.id.asc()).first()
    if any_profile:
        any_profile.is_default = True
        db.session.commit()
        return any_profile

    default_profile = QualityProfile(
        name="По умолчанию", is_default=True, **FALLBACK_THRESHOLDS
    )
    db.session.add(default_profile)
    db.session.commit()
    return default_profile


def get_all_quality_profiles() -> List[QualityProfile]:
    ensure_default_quality_profile()
    return QualityProfile.query.order_by(
        QualityProfile.is_default.desc(), QualityProfile.name.asc()
    ).all()


def get_device_thresholds_map(
    device_ids: Optional[List[int]] = None,
) -> Tuple[Dict[int, Dict[str, float]], Dict[str, float]]:
    """
    Разово (одним набором запросов, а не по одному на устройство) собрать
    thresholds для КАЖДОГО профиля, назначенного явно, плюс thresholds
    дефолтного профиля отдельно — вызывающий код (monitor_loop) сам решает
    для каждого устройства: profiles_by_id.get(device.quality_profile_id, default_thresholds).

    Returns:
        (profiles_by_id: {profile_id: thresholds}, default_thresholds)
    """
    default_profile = ensure_default_quality_profile()
    profiles = QualityProfile.query.all()
    profiles_by_id = {p.id: profile_to_thresholds(p) for p in profiles}
    return profiles_by_id, profile_to_thresholds(default_profile)


def create_quality_profile(name: str, thresholds: Dict[str, float]) -> QualityProfile:
    name = (name or "").strip()
    if not name:
        raise ValueError("Название профиля не может быть пустым")
    if QualityProfile.query.filter_by(name=name).first():
        raise ValueError("Профиль с таким названием уже существует")

    validate_quality_thresholds(thresholds)
    profile = QualityProfile(name=name, is_default=False, **thresholds)
    db.session.add(profile)
    db.session.commit()
    return profile


def update_quality_profile(
    profile_id: int, name: Optional[str], thresholds: Dict[str, float]
) -> QualityProfile:
    profile = QualityProfile.query.get_or_404(profile_id)
    validate_quality_thresholds(thresholds)
    if name and name.strip() and name.strip() != profile.name:
        if QualityProfile.query.filter(
            QualityProfile.name == name.strip(), QualityProfile.id != profile_id
        ).first():
            raise ValueError("Профиль с таким названием уже существует")
        profile.name = name.strip()
    for key, value in thresholds.items():
        setattr(profile, key, value)
    db.session.commit()
    return profile


def set_default_quality_profile(profile_id: int) -> QualityProfile:
    """Сделать профиль дефолтным (снимает флаг со всех остальных — дефолт всегда ровно один)."""
    profile = QualityProfile.query.get_or_404(profile_id)
    QualityProfile.query.filter(QualityProfile.id != profile_id).update(
        {"is_default": False}
    )
    profile.is_default = True
    db.session.commit()
    return profile


def delete_quality_profile(profile_id: int) -> None:
    """
    Удалить профиль.

    Дефолтный профиль удалить нельзя (иначе устройства с quality_profile_id=NULL
    остались бы вообще без порогов) — сначала нужно сделать дефолтным другой
    профиль. Устройства, у которых был явно назначен ИМЕННО этот профиль,
    переводятся обратно на "по умолчанию" (quality_profile_id=NULL), а не
    остаются висеть на удалённом ID.
    """
    profile = QualityProfile.query.get_or_404(profile_id)
    if profile.is_default:
        raise ValueError(
            "Нельзя удалить профиль по умолчанию — сначала назначьте дефолтным другой"
        )

    Device.query.filter_by(quality_profile_id=profile_id).update(
        {"quality_profile_id": None}
    )
    db.session.delete(profile)
    db.session.commit()


def set_device_quality_profile(device_id: int, profile_id: Optional[int]) -> Device:
    """profile_id=None — вернуть устройство на профиль по умолчанию."""
    device = Device.query.get_or_404(device_id)
    if profile_id is not None and not QualityProfile.query.get(profile_id):
        raise ValueError("Профиль не найден")
    device.quality_profile_id = profile_id
    db.session.commit()
    return device
