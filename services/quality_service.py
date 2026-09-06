"""
Сервис для расчёта и запросов качества ICMP.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from extensions import db
from models import DeviceQualityHistory


def get_device_quality_history(device_id: int, hours: int = 24) -> Dict[str, Any]:
    """
    Получить историю качества устройства за указанный период.

    Args:
        device_id: ID устройства
        hours: Количество часов (по умолчанию 24)

    Returns:
        Dict с полями latest и items
    """
    cutoff = datetime.now() - timedelta(hours=hours)
    items = (
        DeviceQualityHistory.query.filter(
            DeviceQualityHistory.device_id == device_id,
            DeviceQualityHistory.timestamp >= cutoff,
        )
        .order_by(DeviceQualityHistory.timestamp.asc())
        .all()
    )

    records = [
        {
            "timestamp": item.timestamp.isoformat(),
            "samples": item.samples,
            "loss_percent": item.loss_percent,
            "latency_avg_ms": item.latency_avg_ms,
            "latency_min_ms": item.latency_min_ms,
            "latency_max_ms": item.latency_max_ms,
            "jitter_ms": item.jitter_ms,
            "quality": item.quality,
        }
        for item in items
    ]

    latest = records[-1] if records else None

    return {"latest": latest, "items": records}


def calculate_quality(
    metrics: Optional[Dict[str, Any]],
) -> Tuple[str, Optional[float], Optional[float], Optional[float]]:
    """
    Рассчитать качество ICMP по метрикам пинга.

    Args:
        metrics: Словарь с latencies, jitter_values, samples

    Returns:
        Кортеж (quality, latency_avg, jitter, loss_percent)
    """
    if not metrics:
        return "unknown", None, None, None

    latencies = metrics.get("latencies", [])
    jitter_values = metrics.get("jitter_values", [])
    sent = metrics.get("samples", 0)
    received = len(latencies)
    loss = ((sent - received) / sent * 100.0) if sent else 100.0
    avg = sum(latencies) / len(latencies) if latencies else None
    jitter = sum(jitter_values) / len(jitter_values) if jitter_values else None

    if (
        loss >= 5
        or (avg is not None and avg >= 100)
        or (jitter is not None and jitter >= 30)
    ):
        quality = "bad"
    elif (
        loss >= 1
        or (avg is not None and avg >= 50)
        or (jitter is not None and jitter >= 10)
    ):
        quality = "degraded"
    else:
        quality = "good"

    return quality, avg, jitter, loss
