"""Whether this machine can afford to start a headless browser.

Asked *before* Chromium is launched, because afterwards is too late. Chromium
wants roughly 300-400MB at startup. On a 512MB instance already holding Python,
FastAPI, the Motor pool and two model clients, that request is refused by the
kernel with SIGKILL — and a signal is not an exception. No ``except`` runs, no
``finally`` runs, no timeout fires; the process disappears mid-request, the
platform answers 503 without CORS headers, and the browser reports a CORS
failure for a server that is simply dead.

There is no way to catch that after the fact. The only thing that works is not
starting the browser, so this decides in advance.

Reading ``/proc/meminfo`` rather than taking a dependency on psutil: the file is
present on every Linux host this runs on, costs nothing, and one number is all
that is needed. A host without it — a laptop, most obviously — is assumed to
have room, which is true of the machines that lack the file.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from app.config import settings

log = logging.getLogger(__name__)

_MEMINFO = Path("/proc/meminfo")


def available_memory_mb() -> int | None:
    """Memory this host could still hand out, in MB, or None if unknowable.

    ``MemAvailable`` rather than ``MemFree``: free memory excludes reclaimable
    page cache and reads far lower than what a new process could actually get,
    which would refuse the crawler on hosts that have plenty.
    """
    try:
        for line in _MEMINFO.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def headless_available() -> tuple[bool, str]:
    """Whether to launch Chromium, and why.

    The reason is returned rather than logged here so the caller can put it in
    front of the customer: "the server is out of memory for page reading" is a
    different thing from "that portal blocked us", and a search that quietly
    returns less should say which happened.
    """
    if settings.enable_headless_scraping is True:
        return True, "explicitly enabled"
    if settings.enable_headless_scraping is False:
        return False, "disabled by configuration (ENABLE_HEADLESS_SCRAPING=false)"

    available = available_memory_mb()
    if available is None:
        # No /proc/meminfo: not Linux, so not one of the constrained hosts this
        # guard exists for.
        return True, "memory could not be measured; assuming a development host"

    floor = settings.headless_memory_floor_mb
    if available < floor:
        return False, (
            f"only {available}MB available and Chromium needs roughly 400MB on top "
            f"of this process (floor is {floor}MB)"
        )
    return True, f"{available}MB available"


def describe_host() -> str:
    """One line for the startup log."""
    available = available_memory_mb()
    where = "Render" if os.environ.get("RENDER") else "this host"
    memory = f"{available}MB available" if available is not None else "memory unknown"
    return f"{where}, {memory}"
