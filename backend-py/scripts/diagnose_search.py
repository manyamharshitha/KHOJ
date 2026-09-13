#!/usr/bin/env python
"""Walk the search from end to end and report which stage fails.

    python scripts/diagnose_search.py yelahanka bangalore
    python scripts/diagnose_search.py yelahanka bangalore --use-llm

Five stages, in the order the real search does them:

    1  search triggered      config loads, target URLs are built
    2  access to search      the portals answer over the network
    3  searching             pages come back with listing content
    4  fetching results      extraction turns that into Listing objects
    5  showing results       storage and the API can serve them

Each prints PASS or FAIL with the reason and how long it took. A FAIL says what
broke and where, rather than leaving a spinner running.

Stage 4 is the only one that costs anything: it calls Gemini, which on the free
tier is twenty requests a day. It is skipped unless you pass --use-llm.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

# `python tests/diagnose_searchingprop.py` puts tests/ on the path, not the
# project root — so `import app` and `import scripts` both fail with
# ModuleNotFoundError before a single check has run. Adding an __init__.py does
# not help: the directory that needs to be importable is the one above this file.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

OK = "PASS"
NO = "FAIL"
SKIP = "SKIP"


@dataclass
class Stage:
    number: int
    name: str
    status: str
    detail: str
    seconds: float


results: list[Stage] = []


def report(number: int, name: str, status: str, detail: str, seconds: float) -> None:
    mark = {OK: "[ PASS ]", NO: "[ FAIL ]", SKIP: "[ SKIP ]"}[status]
    print(f"{mark}  {number}. {name:<24} {seconds:6.2f}s  {detail}")
    results.append(Stage(number, name, status, detail, seconds))


# ---------------------------------------------------------------------------


async def stage_1_triggered(locality: str, city: str) -> list:
    """Config loads and the search produces concrete URLs to visit."""
    start = time.monotonic()
    try:
        from app.models import SearchCriteria
        from app.scraping.sites import resolve_targets

        criteria = SearchCriteria(city=city, localities=[locality], bedrooms=2)
        targets = resolve_targets(["nobroker", "realestateindia"], criteria)

        if not targets:
            report(1, "search triggered", NO,
                   "resolve_targets returned nothing — no portal matched",
                   time.monotonic() - start)
            return []

        report(1, "search triggered", OK,
               f"{len(targets)} target URL(s) built", time.monotonic() - start)
        for t in targets:
            print(f"             -> {t.url}")
        return targets

    except Exception as exc:
        report(1, "search triggered", NO, f"{type(exc).__name__}: {exc}",
               time.monotonic() - start)
        traceback.print_exc()
        return []


async def stage_2_access(targets: list) -> list:
    """The portals answer. This is the network and the URL shape together."""
    import httpx
    from app.scraping.http_reader import HEADERS

    start = time.monotonic()
    reachable = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0, headers=HEADERS) as c:
        for t in targets:
            try:
                r = await c.get(str(t.url))
                size = len(r.text) // 1024
                if r.status_code == 200:
                    print(f"             -> {t.name}: HTTP 200, {size}KB")
                    reachable.append(t)
                else:
                    # 403/406 = refuses automated readers. 410 = no such city.
                    print(f"             -> {t.name}: HTTP {r.status_code}  (refused)")
            except Exception as exc:
                print(f"             -> {t.name}: {type(exc).__name__}: {exc}")

    if not reachable:
        report(2, "access to search", NO,
               "no portal answered — check DNS, firewall, or the URL patterns",
               time.monotonic() - start)
        return []

    report(2, "access to search", OK, f"{len(reachable)}/{len(targets)} portal(s) answered",
           time.monotonic() - start)
    return reachable


async def stage_3_searching(targets: list) -> list:
    """crawl() returns page text with listing content in it."""
    start = time.monotonic()
    try:
        from app.scraping.crawler import crawl

        pages = await crawl(targets)
        usable = [p for p in pages if p.text and len(p.text) > 600]

        for p in pages:
            chars = len(p.text)
            note = f"{chars:,} chars" if chars else (p.note[:60] or "empty")
            print(f"             -> {p.site.name}: {p.status.value}, {note}")

        if not usable:
            report(3, "searching", NO,
                   "crawl returned no readable page text",
                   time.monotonic() - start)
            return []

        report(3, "searching", OK, f"{len(usable)} page(s) with content",
               time.monotonic() - start)
        return usable

    except Exception as exc:
        report(3, "searching", NO, f"{type(exc).__name__}: {exc}", time.monotonic() - start)
        traceback.print_exc()
        return []


async def stage_4_fetch_results(pages: list, locality: str, city: str, use_llm: bool) -> list:
    """Turn page text into Listing objects."""
    start = time.monotonic()

    if not use_llm:
        report(4, "fetching results", SKIP,
               "needs Gemini (20/day on the free tier) — pass --use-llm to run it", 0.0)
        # The free path still proves the page parses, without spending a call.
        #
        # `scrape` rather than `parse(p.text, ...)`, and the difference matters:
        # `p.text` from stage 3 has already been flattened to prose, while
        # `parse` matches quoted HTML attributes — href="..." and src="..." —
        # which the flattening removed. Feeding one to the other silently found
        # nothing on pages full of listings, which then failed stage 5 with
        # "nothing reached this stage" and sent the search for a database fault
        # that did not exist. `scrape` fetches its own raw HTML.
        try:
            from scripts.extract_listings_http import scrape

            found = []
            for portal in ("nobroker", "realestateindia"):
                found += await scrape(portal, locality, city)
            print(f"             -> regex parser found {len(found)} listing(s) with no LLM")
            return found
        except Exception as exc:
            print(f"             -> regex parser failed: {type(exc).__name__}: {exc}")
            return []

    try:
        from app.llm.client import llm_available
        from app.llm.extractor import extract_listings
        from app.models import SearchCriteria

        if not llm_available():
            report(4, "fetching results", NO,
                   "no LLM configured — set GEMINI_API_KEY", time.monotonic() - start)
            return []

        criteria = SearchCriteria(city=city, localities=[locality], bedrooms=2)
        listings = []
        for p in pages:
            got = await extract_listings(
                session_id="ses_diagnose", source_site=p.site.name, page_text=p.text,
                page_url=p.final_url, criteria=criteria,
                criteria_text=f"2BHK in {locality}, {city}", max_listings=5)
            print(f"             -> {p.site.name}: {len(got)} listing(s)")
            listings += got

        if not listings:
            report(4, "fetching results", NO,
                   "extraction returned nothing — check the log above for a quota "
                   "error (429) or a truncation",
                   time.monotonic() - start)
            return []

        report(4, "fetching results", OK, f"{len(listings)} listing(s) extracted",
               time.monotonic() - start)
        return listings

    except Exception as exc:
        report(4, "fetching results", NO, f"{type(exc).__name__}: {exc}",
               time.monotonic() - start)
        traceback.print_exc()
        return []


async def stage_5_show(listings: list) -> None:
    """The database answers and the listings survive a round trip."""
    start = time.monotonic()

    if not listings:
        report(5, "showing results", NO, "nothing reached this stage", 0.0)
        return

    try:
        from app.core.db import connect, disconnect, ping

        await connect()
        alive = await ping()
        await disconnect()

        if not alive:
            report(5, "showing results", NO,
                   "the database did not answer — check FIRESTORE_ENTERPRISE_URI",
                   time.monotonic() - start)
            return

        # What the browser would receive.
        with_link = sum(1 for x in listings if getattr(x, "url", None) or getattr(x, "link", None))
        with_photo = sum(1 for x in listings if getattr(x, "image_url", None) or getattr(x, "photo", None))
        with_rent = sum(1 for x in listings if getattr(x, "rent", None))

        print(f"             -> {with_rent} with a rent, {with_link} with a link, "
              f"{with_photo} with a photo")

        report(5, "showing results", OK, "database reachable, listings are renderable",
               time.monotonic() - start)

    except Exception as exc:
        report(5, "showing results", NO, f"{type(exc).__name__}: {exc}",
               time.monotonic() - start)
        traceback.print_exc()


# ---------------------------------------------------------------------------


async def main() -> int:
    ap = argparse.ArgumentParser(description="Find which stage of the search is broken.")
    ap.add_argument("locality", nargs="?", default="yelahanka")
    ap.add_argument("city", nargs="?", default="bangalore")
    ap.add_argument("--use-llm", action="store_true",
                    help="run stage 4 against Gemini (costs quota)")
    args = ap.parse_args()

    print(f"\nSearching for a 2BHK in {args.locality}, {args.city}\n" + "-" * 78)

    targets = await stage_1_triggered(args.locality, args.city)
    reachable = await stage_2_access(targets) if targets else []
    pages = await stage_3_searching(reachable) if reachable else []
    listings = await stage_4_fetch_results(pages, args.locality, args.city, args.use_llm) if pages else []
    await stage_5_show(listings)

    print("-" * 78)
    failed = [s for s in results if s.status == NO]
    if failed:
        first = failed[0]
        print(f"\nBROKEN AT STAGE {first.number}: {first.name}")
        print(f"  {first.detail}\n")
        return 1

    print("\nAll stages passed. The search works end to end.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))