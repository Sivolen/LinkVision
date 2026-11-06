"""Регрессии для расчёта качества и профилей."""

from services.quality_service import calculate_quality, validate_quality_thresholds


class TestQualityThresholds:
    def test_latency_profile_uses_bad_threshold_immediately(self):
        thresholds = {
            "loss_degraded_percent": 1,
            "loss_bad_percent": 5,
            "latency_degraded_ms": 10,
            "latency_bad_ms": 20,
            "jitter_degraded_ms": 10,
            "jitter_bad_ms": 30,
        }
        validate_quality_thresholds(thresholds)
        quality, avg, _, loss = calculate_quality(
            {"samples": 4, "latencies": [38, 40, 39, 39], "jitter_values": [2, 1, 0]},
            thresholds,
        )
        assert quality == "bad"
        assert avg == 39
        assert loss == 0

    def test_degraded_threshold_must_be_below_bad(self):
        thresholds = {
            "loss_degraded_percent": 5,
            "loss_bad_percent": 5,
            "latency_degraded_ms": 10,
            "latency_bad_ms": 20,
            "jitter_degraded_ms": 10,
            "jitter_bad_ms": 30,
        }
        try:
            validate_quality_thresholds(thresholds)
        except ValueError:
            pass
        else:
            raise AssertionError("Некорректные пороги должны быть отклонены")


def test_quality_history_groups_long_ranges_without_losing_latest(app, monkeypatch):
    from datetime import datetime, timedelta
    import services.quality_service as quality_service
    from extensions import db
    from models import Device, DeviceQualityHistory

    fixed_now = datetime(2026, 1, 2, 12)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr(quality_service, "datetime", FixedDateTime)
    with app.app_context():
        device = Device(name="history test")
        db.session.add(device)
        db.session.flush()
        for i, (samples, loss, latency) in enumerate(
            [(4, 0, 10), (8, 50, 30), (4, 0, 20)]
        ):
            db.session.add(
                DeviceQualityHistory(
                    device_id=device.id,
                    timestamp=fixed_now - timedelta(minutes=15 - i * 5),
                    samples=samples,
                    loss_percent=loss,
                    latency_min_ms=latency - 1,
                    latency_avg_ms=latency,
                    latency_max_ms=latency + 1,
                    jitter_ms=2,
                    quality="good",
                )
            )
        db.session.commit()
        original_count = DeviceQualityHistory.query.count()
        day = quality_service.get_device_quality_history(device.id, 24)
        long_range = quality_service.get_device_quality_history(device.id, 48)
        assert day["count"] == 3 and day["interval_seconds"] == 300
        assert long_range["interval_seconds"] == 600
        assert long_range["count"] == 2
        combined = next(row for row in long_range["items"] if row["samples"] == 12)
        assert combined["loss_percent"] == 100 / 3
        assert combined["latency_avg_ms"] == 25
        assert long_range["latest"]["id"] == day["latest"]["id"]
        assert DeviceQualityHistory.query.count() == original_count
