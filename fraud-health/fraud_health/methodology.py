"""Risk methodology: dimensions, bands, and the invariants every record must satisfy.

The methodology block stored in `activated-payments/risk-health/index.json` is the single
source of truth — the dashboard reads its `dimensions` and `bands` directly to draw the
breakdown bars and the band filter. This module reads that block rather than restating
it, so the code and the page can never drift apart.

Two rules carry the whole model and are enforced in `validate_record`:

1. Score is a SUM of risk dimensions. `score == sum(riskDimensions)`, each dimension
   within [0, max]. Before this pipeline, 402 of 481 records failed that: the headline
   was `100 - sum(trust points)` from an older trust model, while the eight risk
   dimensions the page draws were back-fitted separately. A merchant could show 73/100
   above bars totalling 59.

2. Risk is not uncertainty. Missing evidence never adds risk points; it lowers
   `reviewCompleteness` and lands in `unverified`. A dimension of 0 means "no affirmative
   anomaly observed", never "this risk is disproven".
"""

from __future__ import annotations

from typing import Any

SCORE_DIRECTION = "higher_is_riskier"

# Review stages, most to least evidenced. Published on every record so a reader can tell
# what a score is actually built on.
STAGE_EVIDENCED = "evidence-based"  # independent sources attached and cited
STAGE_SIGNALS = "automated-signals-only"  # deterministic warehouse signals only
STAGE_LEGACY = "legacy-trust-inverted"  # pre-v2 record, score originally 100 - trust


class MethodologyError(ValueError):
    pass


class Methodology:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.raw = raw
        self.dimensions: list[dict[str, Any]] = raw["dimensions"]
        self.bands: list[dict[str, Any]] = raw["bands"]
        self.keys: list[str] = [d["key"] for d in self.dimensions]
        self.maxima: dict[str, int] = {d["key"]: int(d["max"]) for d in self.dimensions}
        total = sum(self.maxima.values())
        if total != 100:
            raise MethodologyError(f"dimension maxima sum to {total}, expected 100")

    def band_for(self, score: int) -> dict[str, Any]:
        for band in self.bands:
            if band["min"] <= score <= band["max"]:
                return band
        raise MethodologyError(f"score {score} falls outside every band")

    def zero_dimensions(self) -> dict[str, int]:
        return {k: 0 for k in self.keys}

    def total(self, dims: dict[str, Any]) -> int:
        return sum(int(dims.get(k, 0) or 0) for k in self.keys)


def validate_record(
    record: dict[str, Any],
    methodology: Methodology,
    *,
    require_sum: bool = True,
    require_dimensions: bool = True,
) -> list[str]:
    """Return a list of human-readable integrity problems; empty means valid.

    Index summaries carry no `riskDimensions` by design — the dashboard loads those
    lazily from the detail shard — so they are validated with `require_dimensions=False`
    and checked only for score/band/action/trust coherence.
    """
    problems: list[str] = []
    account_id = record.get("accountId") or record.get("id") or "<no id>"

    dims = record.get("riskDimensions")
    if not isinstance(dims, dict):
        if require_dimensions:
            return [f"{account_id}: missing riskDimensions"]
        dims = None

    for key in methodology.keys if dims is not None else []:
        if key not in dims:
            problems.append(f"{account_id}: riskDimensions missing '{key}'")
            continue
        value = dims[key]
        if not isinstance(value, int) or isinstance(value, bool):
            problems.append(f"{account_id}: riskDimensions.{key} is not an integer ({value!r})")
            continue
        if not 0 <= value <= methodology.maxima[key]:
            problems.append(
                f"{account_id}: riskDimensions.{key}={value} outside [0, {methodology.maxima[key]}]"
            )

    for stray in (set(dims) - set(methodology.keys)) if dims is not None else set():
        problems.append(f"{account_id}: riskDimensions has unknown dimension '{stray}'")

    score = record.get("score")
    if not isinstance(score, int) or isinstance(score, bool):
        problems.append(f"{account_id}: score is not an integer ({score!r})")
        return problems
    if not 0 <= score <= 100:
        problems.append(f"{account_id}: score {score} outside [0, 100]")

    if dims is not None and require_sum:
        total = methodology.total(dims)
        if total != score:
            problems.append(f"{account_id}: score {score} != sum(riskDimensions) {total}")

    if record.get("riskScore") is not None and record["riskScore"] != score:
        problems.append(f"{account_id}: riskScore {record['riskScore']} != score {score}")

    # trustScore is kept only so older embeds keep rendering; it must stay the exact
    # complement of the risk score or the two disagree on screen.
    if record.get("trustScore") is not None and record["trustScore"] != 100 - score:
        problems.append(
            f"{account_id}: trustScore {record['trustScore']} != 100 - score {100 - score}"
        )

    # A human override (riskOverride*) can raise the operational rating above the
    # dimension sum. The sum still has to equal `score` — the bars must match the number
    # beside them — but the band and action follow the EFFECTIVE score, so a deliberate
    # escalation is not quietly undone by the arithmetic.
    override = record.get("riskOverrideScore")
    if override is not None:
        if not isinstance(override, int) or isinstance(override, bool):
            problems.append(f"{account_id}: riskOverrideScore {override!r} is not an integer")
            override = None
        elif not 0 <= override <= 100:
            problems.append(f"{account_id}: riskOverrideScore {override} outside [0, 100]")
            override = None
        elif not record.get("riskOverrideReason"):
            problems.append(f"{account_id}: riskOverrideScore set without riskOverrideReason")
    effective = max(score, override) if override is not None else score

    try:
        band = methodology.band_for(effective)
    except MethodologyError as exc:
        problems.append(f"{account_id}: {exc}")
        return problems

    if record.get("band") not in (None, band["label"]):
        problems.append(
            f"{account_id}: band '{record['band']}' != '{band['label']}' for effective score {effective}"
        )
    if record.get("action") not in (None, band["action"]):
        problems.append(
            f"{account_id}: action '{record.get('action')}' != '{band['action']}' "
            f"for effective score {effective}"
        )

    completeness = record.get("reviewCompleteness")
    if completeness is not None and not 0 <= completeness <= 100:
        problems.append(f"{account_id}: reviewCompleteness {completeness} outside [0, 100]")

    stage = record.get("reviewStage")
    if stage == STAGE_EVIDENCED and not record.get("sources"):
        problems.append(f"{account_id}: reviewStage is '{STAGE_EVIDENCED}' but sources is empty")

    return problems


def effective_score(record: dict[str, Any]) -> int:
    """Operational score: the dimension sum, or a human override where one is set."""
    score = int(record["score"])
    override = record.get("riskOverrideScore")
    return max(score, int(override)) if override is not None else score


def apply_band(record: dict[str, Any], methodology: Methodology) -> dict[str, Any]:
    """Recompute every field that is a pure function of the score. Mutates and returns."""
    score = int(record["score"])
    band = methodology.band_for(effective_score(record))
    record["riskScore"] = score
    record["trustScore"] = 100 - score
    record["band"] = band["label"]
    record["action"] = band["action"]
    return record
