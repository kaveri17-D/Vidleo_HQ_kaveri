from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional


PROGRESS_RE = re.compile(r"\[download\]\s+(?P<percent>\d+(?:\.\d+)?)%")
SPEED_RE = re.compile(r"at\s+(?P<speed>[0-9.]+\s*\w+/s)")
ETA_RE = re.compile(r"ETA\s+(?P<eta>[0-9:]+)")


@dataclass
class ProgressSnapshot:
    percent: int
    speed: Optional[str] = None
    eta: Optional[str] = None


class DownloadProgressTracker:
    """
    Parses yt-dlp progress lines and emits structured progress updates.
    """

    def __init__(self, callback: Optional[Callable[[ProgressSnapshot], None]] = None) -> None:
        self.callback = callback
        self.latest_percent = 0

    def feed_line(self, line: str) -> None:
        match = PROGRESS_RE.search(line)
        if not match:
            return

        percent = max(0, min(100, int(float(match.group("percent")))))
        if percent < self.latest_percent:
            return

        self.latest_percent = percent
        speed_match = SPEED_RE.search(line)
        eta_match = ETA_RE.search(line)
        snapshot = ProgressSnapshot(
            percent=percent,
            speed=speed_match.group("speed") if speed_match else None,
            eta=eta_match.group("eta") if eta_match else None,
        )

        if self.callback:
            self.callback(snapshot)
