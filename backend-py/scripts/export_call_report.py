"""Export every verification call to a PDF.

Reads the calls, listings, sessions and honesty reports out of the database and
lays them out as a report: what was dialled, what was said, what was asked and
answered, and where the phone call disagreed with the advert.

    python scripts/export_call_report.py
    python scripts/export_call_report.py --out report.pdf --limit 50

Usage figures at the top are counted from our own records. They are what this
system placed, which is not the same as what CALL-E billed — only the CALL-E
dashboard knows that, and the SDK exposes no balance endpoint to ask.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from reportlab.lib import colors  # noqa: E402
from reportlab.lib.enums import TA_LEFT  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import mm  # noqa: E402
from reportlab.platypus import (  # noqa: E402
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.db import connect, disconnect, get_db  # noqa: E402
from app.models import as_utc  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
log = logging.getLogger("export")

INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#6b6b6b")
RULE = colors.HexColor("#d8d8d8")
FLAG = colors.HexColor("#b3261e")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title", parent=base["Title"], fontSize=20, textColor=INK, spaceAfter=2
        ),
        "sub": ParagraphStyle(
            "sub", parent=base["Normal"], fontSize=9, textColor=MUTED, spaceAfter=14
        ),
        "h2": ParagraphStyle(
            "h2", parent=base["Heading2"], fontSize=13, textColor=INK, spaceBefore=14, spaceAfter=6
        ),
        "h3": ParagraphStyle(
            "h3", parent=base["Heading3"], fontSize=10, textColor=MUTED, spaceBefore=10, spaceAfter=4
        ),
        "body": ParagraphStyle(
            "body", parent=base["Normal"], fontSize=9.5, leading=14, textColor=INK, alignment=TA_LEFT
        ),
        "q": ParagraphStyle(
            "q", parent=base["Normal"], fontSize=9, leading=13, textColor=MUTED
        ),
        "a": ParagraphStyle(
            "a", parent=base["Normal"], fontSize=9.5, leading=13, textColor=INK, spaceAfter=5
        ),
        "flag": ParagraphStyle(
            "flag", parent=base["Normal"], fontSize=9.5, leading=13, textColor=FLAG
        ),
    }


def _esc(value: Any) -> str:
    """Reportlab parses its own mini-markup, so raw text has to be escaped."""
    return (
        str(value if value is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _when(value: Any) -> str:
    dt = as_utc(value)
    return dt.strftime("%d %b %Y, %H:%M UTC") if dt else "unknown"


def _rupees(value: Any) -> str:
    try:
        return f"Rs {int(value):,}"
    except (TypeError, ValueError):
        return "not stated"


async def gather(limit: int) -> dict[str, Any]:
    db = await connect()
    calls = await db["calls"].find({}).sort([("created_at", -1)]).to_list(length=limit)

    listing_ids = [c.get("listing_id") for c in calls if c.get("listing_id")]
    session_ids = [c.get("session_id") for c in calls if c.get("session_id")]

    listings = {
        d["_id"]: d
        async for d in db["listings"].find({"_id": {"$in": listing_ids}})
    }
    sessions = {
        d["_id"]: d
        async for d in db["search_sessions"].find({"_id": {"$in": session_ids}})
    }
    reports = {
        d.get("call_id"): d
        async for d in db["analyses"].find({"call_id": {"$in": [c["_id"] for c in calls]}})
    }
    totals = {
        "sessions": await db["search_sessions"].count_documents({}),
        "listings": await db["listings"].count_documents({}),
        "calls": await db["calls"].count_documents({}),
        "verifications": await db["verifications"].count_documents({}),
        "analyses": await db["analyses"].count_documents({}),
    }
    await disconnect()
    return {
        "calls": calls,
        "listings": listings,
        "sessions": sessions,
        "reports": reports,
        "totals": totals,
    }


def build(data: dict[str, Any], out: str) -> None:
    st = _styles()
    doc = SimpleDocTemplate(
        out,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title="Khoj — verification call report",
    )
    story: list[Any] = []
    calls = data["calls"]
    totals = data["totals"]

    story.append(Paragraph("Khoj — verification call report", st["title"]))
    story.append(Paragraph(f"Generated {_when(None) if False else ''}", st["sub"]))

    # --- usage ----------------------------------------------------------
    by_status: dict[str, int] = {}
    for c in calls:
        by_status[str(c.get("call_status"))] = by_status.get(str(c.get("call_status")), 0) + 1

    rows = [["Metric", "Count"]]
    rows += [
        ["Searches run", totals["sessions"]],
        ["Listings extracted", totals["listings"]],
        ["Calls placed", totals["calls"]],
        ["Verifications recorded", totals["verifications"]],
        ["Honesty reports", totals["analyses"]],
    ]
    rows += [[f"  — calls {k}", v] for k, v in sorted(by_status.items())]

    table = Table(rows, colWidths=[110 * mm, 40 * mm], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
                ("LINEBELOW", (0, 1), (-1, -2), 0.25, RULE),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(Paragraph("Usage", st["h2"]))
    story.append(table)
    story.append(
        Paragraph(
            "Counted from this system's own records. CALL-E bills separately and "
            "its SDK exposes no balance endpoint, so the credits actually consumed "
            "must be read from the CALL-E dashboard.",
            st["q"],
        )
    )

    if not calls:
        story.append(Paragraph("No calls have been placed yet.", st["body"]))
        doc.build(story)
        return

    # --- one section per call -------------------------------------------
    for index, call in enumerate(calls):
        story.append(PageBreak() if index else Spacer(1, 10))
        listing = data["listings"].get(call.get("listing_id"), {})
        session = data["sessions"].get(call.get("session_id"), {})
        report = data["reports"].get(call["_id"], {})

        title = listing.get("title") or listing.get("locality") or "Listing"
        story.append(Paragraph(_esc(title), st["h2"]))
        story.append(
            Paragraph(
                f"{_esc(call.get('phone_dialed'))} &nbsp;·&nbsp; "
                f"{_esc(call.get('call_status'))} &nbsp;·&nbsp; {_when(call.get('created_at'))}",
                st["sub"],
            )
        )
        if session.get("prompt"):
            story.append(Paragraph(f"Search: {_esc(session['prompt'])}", st["q"]))

        if call.get("error"):
            story.append(Paragraph(f"Error: {_esc(call['error'])}", st["flag"]))

        # advertised vs spoken
        story.append(Paragraph("Advertised", st["h3"]))
        story.append(
            Paragraph(
                f"Rent {_rupees(listing.get('rent'))} &nbsp;·&nbsp; "
                f"maintenance {_rupees(listing.get('maintenance'))} &nbsp;·&nbsp; "
                f"deposit {_rupees(listing.get('deposit'))}",
                st["body"],
            )
        )

        qna = [q for q in (call.get("qna_pairs") or []) if q.get("question")]
        if qna:
            story.append(Paragraph("What was asked on the call", st["h3"]))
            for pair in qna:
                story.append(Paragraph(_esc(pair.get("question")), st["q"]))
                answer = pair.get("quote") or pair.get("answer")
                story.append(
                    Paragraph(
                        _esc(answer) if answer else "<i>not answered</i>",
                        st["a"] if answer else st["q"],
                    )
                )

        if report:
            story.append(Paragraph("Honesty analysis", st["h3"]))
            score = report.get("honesty_score")
            story.append(
                Paragraph(
                    f"Score {score}/10 &nbsp;·&nbsp; verdict "
                    f"{_esc(report.get('final_verdict'))}",
                    st["body"],
                )
            )
            if report.get("summary"):
                story.append(Paragraph(_esc(report["summary"]), st["body"]))
            for flag in report.get("red_flags") or []:
                story.append(Paragraph(f"• {_esc(flag)}", st["flag"]))
            for d in report.get("listing_discrepancies") or []:
                story.append(
                    Paragraph(
                        f"• <b>{_esc(d.get('field'))}</b>: advert said "
                        f"{_esc(d.get('listing_claim'))}, call said "
                        f"{_esc(d.get('spoken_claim'))}",
                        st["flag"],
                    )
                )

        turns = call.get("transcript") or []
        if turns:
            story.append(Paragraph(f"Transcript ({len(turns)} turns)", st["h3"]))
            story.append(HRFlowable(width="100%", thickness=0.4, color=RULE, spaceAfter=6))
            for turn in turns:
                who = str(turn.get("speaker") or "?")
                story.append(
                    Paragraph(
                        f"<b>{_esc(who)}</b> &nbsp; {_esc(turn.get('text'))}",
                        st["body"] if who == "owner" else st["q"],
                    )
                )

    doc.build(story)


def main() -> int:
    parser = argparse.ArgumentParser(description="Export call results to PDF.")
    parser.add_argument("--out", default="khoj-call-report.pdf")
    parser.add_argument("--limit", type=int, default=100)
    args = parser.parse_args()

    data = asyncio.run(gather(args.limit))
    build(data, args.out)

    size = os.path.getsize(args.out)
    log.info("wrote %s (%.1f KB)", args.out, size / 1024)
    log.info(
        "%d call(s), %d verification(s), %d honesty report(s)",
        data["totals"]["calls"],
        data["totals"]["verifications"],
        data["totals"]["analyses"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
