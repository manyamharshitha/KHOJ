"""Record the silent preview of the Khoj walkthrough from the app running locally.

    backend-py\\.venv\\Scripts\\python.exe demo-assets\\record_preview.py

Needs the frontend on :5173 and the backend on :8010. Writes one WebM per clip
to demo-assets/recordings/raw, plus clips.json with the timestamps
build_preview.py cuts on.

It drives a real app against a real database, so what it will and will not do
is fixed here rather than left to whoever runs it:

- It never clicks Search, Call now, Verify by phone, Ask, or Send the request
  now. Those spend AI quota, ring a person, or text one.
- The properties shown are a real search from 13 September, opened by session
  id. No new search is run.
- The Google popup is never opened. The login page is shown, then the clip cuts
  to setup, so nobody's account is signed into.
- Two steps do write rows, because the screens after them only exist once they
  have: adding a number creates a listing and its session, and booking a live
  video creates a visit, its link token and a notification. Every id is written
  to clips.json under "created" so the rows can be deleted afterwards.

Playwright records the page and nothing else, so there is no pointer in the
video. A drawn cursor is injected, moved in small steps and pulsed on click;
without it, controls change state by themselves on screen and the viewer has
no idea what was pressed.
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
RAW = HERE / "recordings" / "raw"
BASE = "http://localhost:5173"

#: A real search, 13 Sept: 74 Bengaluru listings, 42 of them with photos.
RESULTS_SESSION = "ses_1a0987cb938738c6bae"
#: A completed call with an 85-turn transcript.
CALL_SESSION = "ses_1a098f862954418417a"
#: Typed into the "Already have a number?" box. Never dialled: Call now is not pressed.
DEMO_NUMBER = "9876543210"

CURSOR = r"""
(() => {
  if (window.__khojCursor) return;
  window.__khojCursor = true;
  const make = () => {
    const arrow = document.createElement('div');
    arrow.innerHTML =
      '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 11.5-6.6.9 3.9 7.4-3 1.6-3.9-7.5L4 20z" fill="#14171A" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(arrow.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(-200px,-200px)', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.28))',
    });
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      position: 'fixed', left: '-18px', top: '-18px', width: '36px', height: '36px',
      borderRadius: '50%', border: '2px solid #1B4B73', opacity: '0',
      zIndex: '2147483646', pointerEvents: 'none',
    });
    document.documentElement.append(ring, arrow);
    let x = -200, y = -200;
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      arrow.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    }, true);
    addEventListener('mousedown', () => {
      ring.animate(
        [
          { opacity: 0.9, transform: `translate(${x}px, ${y}px) scale(0.4)` },
          { opacity: 0, transform: `translate(${x}px, ${y}px) scale(1.5)` },
        ],
        { duration: 480, easing: 'ease-out' },
      );
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', make);
  else make();
})();
"""


class Director:
    """Moves, clicks and pauses at a pace a viewer can follow, and keeps time."""

    def __init__(self, page: Page) -> None:
        self.page = page
        self.t0 = time.monotonic()
        self.marks: dict[str, float] = {}

    def now(self) -> float:
        return round(time.monotonic() - self.t0, 2)

    def mark(self, name: str) -> None:
        self.marks[name] = self.now()

    def pause(self, seconds: float) -> None:
        self.page.wait_for_timeout(int(seconds * 1000))

    def to(self, locator, steps: int = 30) -> None:
        locator.wait_for(state="visible", timeout=30_000)
        box = locator.bounding_box()
        if box is None or box["y"] < 60 or box["y"] + box["height"] > self.page.viewport_size["height"] - 20:
            self.bring_into_view(locator)
            box = locator.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=steps)

    def click(self, locator, settle: float = 0.35) -> None:
        self.to(locator)
        self.pause(settle)
        self.page.mouse.down()
        self.page.mouse.up()

    def type(self, text: str, delay: int = 110) -> None:
        self.page.keyboard.type(text, delay=delay)

    def scroll(self, dy: float, steps: int = 14, each_ms: int = 55) -> None:
        for _ in range(steps):
            self.page.mouse.wheel(0, dy / steps)
            self.page.wait_for_timeout(each_ms)

    def bring_into_view(self, locator) -> None:
        """Scroll smoothly until the element sits in the middle band of the screen."""
        height = self.page.viewport_size["height"]
        for _ in range(40):
            box = locator.bounding_box()
            if box is None:
                self.scroll(300)
                continue
            middle = box["y"] + box["height"] / 2
            if height * 0.25 < middle < height * 0.7:
                return
            self.scroll(max(-500, min(500, middle - height * 0.45)), steps=10)
        locator.scroll_into_view_if_needed()


def button(page: Page, name: str):
    return page.get_by_role("button", name=name, exact=True).filter(visible=True).first


def set_storage(page: Page, key: str, value: str) -> None:
    page.evaluate("([k, v]) => localStorage.setItem(k, v)", [key, value])


def open_page(ctx, path: str) -> tuple[Page, Director]:
    page = ctx.new_page()
    director = Director(page)
    page.goto(BASE + path, wait_until="load")
    page.mouse.move(760, 470)
    return page, director


def finish(page: Page, director: Director, name: str, clips: dict) -> None:
    director.pause(0.8)
    director.mark("end")
    video = page.video
    page.close()
    target = RAW / f"{name}.webm"
    video.save_as(target)
    clips[name] = {"file": target.name, **director.marks}
    print(f"  recorded {name:<16} {director.marks}")


# ---------------------------------------------------------------- the clips


def clip_home_login(ctx, clips):
    page, d = open_page(ctx, "/")
    page.get_by_role("link", name="Log in").filter(visible=True).first.wait_for()
    d.pause(1.2)
    d.mark("start")
    d.pause(2)
    d.click(page.get_by_role("link", name="Log in").filter(visible=True).first)
    page.wait_for_url(re.compile(r"/login"))
    d.pause(1.5)
    d.to(button(page, "Continue with Google"))
    d.pause(2.2)
    finish(page, d, "1a-login", clips)


def clip_setup(ctx, clips):
    page, d = open_page(ctx, "/dashboard")
    role = page.get_by_role("button", name="I'm looking for a place")
    role.wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(1.2)
    d.click(role)
    d.click(button(page, "Let's go"))

    def answer(number: int, label: str) -> None:
        page.get_by_text(f"Question {number} of").wait_for()
        d.pause(0.45)
        d.click(button(page, label))

    for n, label in enumerate(["Veg", "Rent", "Under ₹50,000", "2 BHK", "Bengaluru"], start=1):
        answer(n, label)

    page.get_by_text("Question 6 of").wait_for()
    d.pause(0.4)
    d.click(page.locator("input[placeholder^='e.g.']"))
    d.type("Koram")
    suggestion = page.get_by_text("Koramangala", exact=True).filter(visible=True).first
    d.pause(0.6)
    d.click(suggestion)

    for n, label in enumerate(
        ["Within a month", "Family", "Doesn't matter", "Doesn't matter", "No"], start=7
    ):
        answer(n, label)

    page.get_by_text("5 more, just for renting.").wait_for()
    d.pause(0.8)
    for chip in ["No or low brokerage fee", "Maintenance included in rent", "24x7 water supply"]:
        d.click(button(page, chip))
        d.pause(0.3)
    d.click(button(page, "Finish setup"))

    page.get_by_text("Guided tour").wait_for()
    for _ in range(3):
        d.pause(0.9)
        d.click(button(page, "Next"))
    d.pause(0.9)
    d.click(button(page, "Got it"))
    d.pause(1.5)
    finish(page, d, "1b-setup", clips)


def clip_sources(ctx, clips):
    page, d = open_page(ctx, "/dashboard")
    button(page, "Sources").wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(0.8)
    d.click(button(page, "Sources"))
    page.get_by_text("Listing sources").wait_for()
    d.pause(1)
    for name in ["NoBroker", "RealEstateIndia", "Zolo", "Colive"]:
        row = page.locator("strong", has_text=name).filter(visible=True).first
        if row.count():
            d.to(row, steps=22)
            d.pause(0.55)
    toggle = page.get_by_label("Toggle Colive")
    d.click(toggle)
    d.pause(1)
    d.click(toggle)
    d.pause(1.2)
    # The next clip opens a real past search rather than running a new one.
    set_storage(page, "khoj.session.id", RESULTS_SESSION)
    finish(page, d, "2-sources", clips)


def clip_properties(ctx, clips):
    page, d = open_page(ctx, "/dashboard")
    button(page, "Results").wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(0.8)
    d.click(button(page, "Results"))
    page.locator("button[aria-expanded]").first.wait_for(timeout=30_000)
    d.pause(2)
    page.mouse.move(900, 520, steps=20)
    for _ in range(3):
        d.scroll(520, steps=18, each_ms=60)
        d.pause(1.3)
    cards = page.locator("button[aria-expanded]").filter(visible=True)
    target = cards.nth(min(3, max(0, cards.count() - 1)))
    d.click(target)
    d.pause(1.6)
    link = page.locator("a", has_text="View on").filter(visible=True)
    if link.count():
        d.to(link.last)
        d.pause(1.8)
    d.click(target)
    d.pause(1.2)
    finish(page, d, "3-properties", clips)


def clip_add_number(ctx, clips, created):
    page, d = open_page(ctx, "/dashboard")
    button(page, "Sources").wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(0.6)
    d.click(button(page, "Sources"))
    page.get_by_text("Already have a number?").wait_for()
    box = page.get_by_placeholder(re.compile("Have a number"))
    d.bring_into_view(box)
    d.pause(1)
    d.click(box)
    d.type(DEMO_NUMBER, delay=140)
    d.pause(0.8)
    with page.expect_response(
        lambda r: r.request.method == "POST" and "/api/" in r.url, timeout=60_000
    ) as info:
        d.click(button(page, "Add this listing"))
    try:
        body = info.value.json()
        created["manual"] = {
            "session_id": body.get("session_id"),
            "listing_id": body.get("listing_id") or (body.get("listing") or {}).get("id"),
            "url": info.value.url,
        }
    except Exception as exc:  # noqa: BLE001 - recorded, not fatal to the video
        created["manual"] = {"error": repr(exc), "url": info.value.url}
    page.get_by_text("What would you like to do next?").wait_for()
    d.pause(3)
    d.to(button(page, "Call now"))  # hovered only
    d.pause(1.6)
    d.click(button(page, "Ask questions first"))
    d.pause(1.5)
    # The call and transcript clips open the session that has a completed call.
    set_storage(page, "khoj.session.id", CALL_SESSION)
    finish(page, d, "4-add-number", clips)


def clip_call_and_transcript(ctx, clips):
    page, d = open_page(ctx, "/dashboard")
    button(page, "Results").wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(0.6)
    d.click(button(page, "Results"))
    summary = page.locator("summary", has_text="Read the full call")
    summary.wait_for(state="attached", timeout=30_000)
    page.mouse.move(900, 560, steps=24)
    d.pause(3.5)
    d.scroll(260, steps=20, each_ms=90)
    d.pause(3.5)
    d.scroll(260, steps=20, each_ms=90)
    d.pause(3.5)

    d.mark("transcript")
    d.click(summary)
    d.pause(1.8)
    d.to(page.locator("details[open] ol"))
    for _ in range(9):
        d.scroll(170, steps=10, each_ms=70)
        d.pause(0.35)
    d.pause(1)
    d.click(summary)
    d.pause(1.2)
    finish(page, d, "5-call-transcript", clips)


def clip_live_video(ctx, clips, created):
    page, d = open_page(ctx, "/dashboard")
    button(page, "Results").wait_for(timeout=30_000)
    d.pause(1)
    d.mark("start")
    d.pause(0.6)
    d.click(button(page, "Results"))
    request = button(page, "Request live video")
    request.wait_for(timeout=30_000)
    d.pause(1.6)
    d.click(request)
    page.get_by_text("When will they be there?").wait_for()
    d.pause(3.2)
    with page.expect_response(
        lambda r: r.request.method == "POST" and "/visits/schedule" in r.url, timeout=60_000
    ) as info:
        d.click(button(page, "Book it"))
    try:
        created["visit_id"] = (info.value.json().get("visit") or {}).get("id")
    except Exception as exc:  # noqa: BLE001
        created["visit_error"] = repr(exc)
    page.get_by_text("Video verifications").wait_for()
    d.pause(2)
    d.to(button(page, "Send the request now"))  # hovered only
    d.pause(2.6)
    finish(page, d, "6-live-video", clips)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    for old in RAW.glob("*.webm"):
        old.unlink()

    clips: dict = {}
    created: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # 1536x864 at 1.25 device pixels renders a sharp 1920x1080 frame, and
        # reads like the browser zoomed to 125% that the script asks for.
        ctx = browser.new_context(
            viewport={"width": 1536, "height": 864},
            device_scale_factor=1.25,
            record_video_dir=str(RAW / "_tmp"),
            record_video_size={"width": 1920, "height": 1080},
        )
        ctx.add_init_script(CURSOR)
        try:
            clip_home_login(ctx, clips)
            clip_setup(ctx, clips)
            clip_sources(ctx, clips)
            clip_properties(ctx, clips)
            clip_add_number(ctx, clips, created)
            clip_call_and_transcript(ctx, clips)
            clip_live_video(ctx, clips, created)
        finally:
            (RAW / "clips.json").write_text(
                json.dumps({"clips": clips, "created": created}, indent=2), encoding="utf-8"
            )
            ctx.close()
            browser.close()
            for leftover in (RAW / "_tmp").glob("*"):
                leftover.unlink()
            if (RAW / "_tmp").exists():
                (RAW / "_tmp").rmdir()

    print("\ncreated rows to delete:", json.dumps(created))
    return 0


if __name__ == "__main__":
    sys.exit(main())
