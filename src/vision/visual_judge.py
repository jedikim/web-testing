"""VisualJudge fallback implementation.

Maintains import compatibility for v3 pipeline while keeping behavior safe:
if no detector is configured or detection fails, return no matches.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class VisualMatch:
    relevant: bool
    confidence: float
    page_bbox: tuple[int, int, int, int]
    label: str = ""
    cell_index: int = 0


class VisualJudge:
    def __init__(self, detector: Any, vlm: Any | None = None) -> None:
        self._detector = detector
        self._vlm = vlm

    async def judge(
        self,
        screenshot: bytes,
        query: str,
        complexity: str = "simple",
    ) -> list[VisualMatch]:
        del query, complexity
        if self._detector is None:
            return []
        try:
            detections = await self._detector.detect(screenshot)
        except Exception:
            return []
        matches: list[VisualMatch] = []
        for idx, det in enumerate(detections):
            bbox = tuple(getattr(det, "bbox", (0, 0, 0, 0)))
            if len(bbox) != 4:
                continue
            conf = float(getattr(det, "confidence", 0.0) or 0.0)
            matches.append(
                VisualMatch(
                    relevant=conf >= 0.5,
                    confidence=conf,
                    page_bbox=(int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])),
                    label=str(getattr(det, "label", "") or ""),
                    cell_index=idx,
                )
            )
        matches.sort(key=lambda m: m.confidence, reverse=True)
        return matches
