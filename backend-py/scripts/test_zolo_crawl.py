"""Ad-hoc check: does the real crawler reach Zolo/Colive and find a dialable number?

Run with: ./.venv/bin/python scripts/test_zolo_crawl.py
"""

from __future__ import annotations

import asyncio

from app.llm.extractor import extract_phone_candidates
from app.models import ListingSourceStatus, TargetSite
from app.scraping.crawler import crawl
from app.scraping.sites import SITES


async def main() -> None:
    targets = [
        TargetSite(name="Zolo", url=SITES["zolo"].search_url("Hyderabad"), contact_gated=False),
        TargetSite(name="Colive", url=SITES["colive"].search_url("Hyderabad"), contact_gated=False),
    ]
    results = await crawl(targets)
    for r in results:
        print(f"\n=== {r.site.name} — {r.status.value} ===")
        print("note:", r.note)
        print("text length:", len(r.text))
        if r.status is ListingSourceStatus.OK:
            phones = extract_phone_candidates(r.text)
            print("phone numbers found in page:", phones)


asyncio.run(main())
