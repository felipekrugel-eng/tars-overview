import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from importlib.util import module_from_spec, spec_from_file_location

script = Path(__file__).resolve().parents[1] / "check_pull_freshness.py"
spec = spec_from_file_location("check_pull_freshness", script)
module = module_from_spec(spec)
spec.loader.exec_module(module)


class PullFreshnessTest(unittest.TestCase):
    def test_verified_pull_boundary_and_offset(self):
        now = dt.datetime(2026, 9, 28, 13, 54, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pull_status.json"
            path.write_text(json.dumps({
                "pull_succeeded": True,
                "completed_at_utc": "2026-09-28T04:05:00-07:00",
            }))
            self.assertFalse(module.should_run(path, now, 170)[0])  # 169 min
            self.assertTrue(module.should_run(path, now + dt.timedelta(minutes=1), 170)[0])

    def test_missing_or_unverified_manifest_triggers_recovery(self):
        now = dt.datetime(2026, 9, 28, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pull_status.json"
            self.assertTrue(module.should_run(path, now, 170)[0])
            path.write_text(json.dumps({"pull_succeeded": False, "completed_at_utc": "2026-09-28T00:00:00Z"}))
            self.assertTrue(module.should_run(path, now, 170)[0])
            path.write_text(json.dumps({"pull_succeeded": True, "completed_at_utc": "2026-09-28T00:00:00"}))
            self.assertTrue(module.should_run(path, now, 170)[0])


if __name__ == "__main__":
    unittest.main()
