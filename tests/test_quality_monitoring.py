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
