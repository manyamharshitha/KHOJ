"""Render frames.html into the PNGs for the demo video, and check them.

    backend-py\\.venv\\Scripts\\python.exe demo-assets\\render.py

Each <section> becomes one PNG in demo-assets/png at its exact pixel size, then
a contact sheet of all of them lands at demo-assets/contact-sheet.png.

The checks are the point of this file rather than an afterthought. A graphic
that is one line too long puts a headline under the auto-captions, and nobody
notices until the video is uploaded and a judge is watching it. So before
anything is called finished, every frame is measured in the real browser:

- every element inside the 96px safe margin (64px on thumbnails)
- nothing below y=860 on a video frame, which is where captions go
- no text under 28px, and gold text only at 44px and above, where its contrast
  against the background is good enough to read
- the four section cards with their headlines at exactly the same height
- nothing in the bottom-right of a thumbnail, where YouTube prints the length
- the fonts actually loaded, because a silent fallback to Georgia would still
  "render" and would look like a different product

A failed check exits non-zero and says which frame and which element, so a bad
frame is a message here rather than a surprise in Clipchamp.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "png"

REQUIRED_FONTS = {"Fraunces", "IBM Plex Mono", "Inter"}

CHECKS = r"""
() => {
  const problems = [];
  const GOLD = new Set(['rgb(169, 129, 46)', 'rgb(210, 168, 85)']);
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());

  for (const frame of document.querySelectorAll('.frame')) {
    const id = frame.id;
    const f = frame.getBoundingClientRect();
    const thumb = frame.classList.contains('thumb');
    const W = f.width, H = f.height;
    const margin = thumb ? 64 : 96;
    const floor = thumb ? H - 64 : 860;

    for (const el of frame.querySelectorAll('*')) {
      if (el.closest('[data-deco]') || el.closest('symbol')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;

      const x0 = r.left - f.left, y0 = r.top - f.top;
      const x1 = r.right - f.left, y1 = r.bottom - f.top;
      const name = `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') || ''}">`;
      const box = [x0, y0, x1, y1].map(Math.round).join(',');

      if (x0 < margin - 0.5 || y0 < margin - 0.5 || x1 > W - margin + 0.5) {
        problems.push(`${id}: ${name} at [${box}] is outside the ${margin}px safe margin`);
      }
      if (y1 > floor + 0.5) {
        problems.push(`${id}: ${name} at [${box}] reaches y=${Math.round(y1)}, below ${floor}`);
      }
      if (thumb && x1 > W - 260 && y1 > H - 120) {
        problems.push(`${id}: ${name} sits where YouTube prints the video length`);
      }

      if (ownText(el)) {
        const style = getComputedStyle(el);
        const size = parseFloat(style.fontSize);
        const label = `"${el.textContent.trim().slice(0, 32)}"`;
        if (!thumb && size < 28) problems.push(`${id}: ${label} is ${size}px, under 28px`);
        if (GOLD.has(style.color) && size < 44) {
          problems.push(`${id}: ${label} is gold at ${size}px; gold text needs 44px+`);
        }
      }
    }
  }

  // Every card marked as a section, rather than a list of ids that silently
  // stops checking a card the moment one is renamed or added.
  const sections = [...document.querySelectorAll('.frame.section')].map((f) => f.id);
  if (sections.length < 2) problems.push(`expected several section cards, found ${sections.length}`);
  const tops = sections.map((id) => {
    const frame = document.getElementById(id);
    return Math.round(frame.querySelector('.h').getBoundingClientRect().top - frame.getBoundingClientRect().top);
  });
  if (new Set(tops).size !== 1) problems.push(`section headlines are not level: ${tops.join(', ')}`);

  return problems;
}
"""


def png_header(path: Path) -> tuple[int, int, int]:
    """Width, height and PNG colour type, read from the file's own header."""
    head = path.read_bytes()[:26]
    width, height = struct.unpack(">II", head[16:24])
    return width, height, head[25]


def contact_sheet(page, files: list[Path]) -> Path:
    """Every PNG on one page, so the whole set can be judged at a glance.

    Lower-thirds sit on a mid-grey so their white pills are visible, and the
    first thumbnail is repeated at 168x94 — YouTube's smallest size — because
    that is the size most people will actually see it at.
    """
    cells = []
    for f in files:
        bg = "#6b7075" if "-lt-" in f.name else "transparent"
        cells.append(
            f'<figure><img src="{f.as_uri()}" style="background:{bg}">'
            f"<figcaption>{f.name}</figcaption></figure>"
        )
    thumb = next(f for f in files if "thumb-A" in f.name)
    html = f"""<!doctype html><meta charset="utf-8">
    <style>
      body {{ margin: 0; padding: 32px; background: #1d2024; font: 16px system-ui; color: #cfd4d8; }}
      .grid {{ display: grid; grid-template-columns: repeat(3, 600px); gap: 28px; }}
      figure {{ margin: 0; }} img {{ width: 600px; display: block; border-radius: 6px; }}
      figcaption {{ margin-top: 8px; font-family: monospace; }}
      .tiny img {{ width: 168px; height: 94px; }}
    </style>
    <div class="grid">{''.join(cells)}
      <figure class="tiny"><img src="{thumb.as_uri()}"><figcaption>thumb-A at 168x94</figcaption></figure>
    </div>"""
    sheet_html = OUT / "_contact-sheet.html"
    sheet_html.write_text(html, encoding="utf-8")
    page.set_viewport_size({"width": 1920, "height": 1080})
    page.goto(sheet_html.as_uri(), wait_until="load")
    path = HERE / "contact-sheet.png"
    page.screenshot(path=str(path), full_page=True)
    sheet_html.unlink()
    return path


def main() -> int:
    OUT.mkdir(exist_ok=True)
    # Frames get renamed as the storyboard changes. Without this, the old
    # k06-section-verified.png sits next to the new set and ends up dragged
    # into Clipchamp as if it were current.
    for stale in OUT.glob("k*.png"):
        stale.unlink()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.goto((HERE / "frames.html").as_uri(), wait_until="networkidle")
        page.evaluate("document.fonts.ready.then(() => true)")

        loaded = set(
            page.evaluate(
                "[...document.fonts].filter(f => f.status === 'loaded')"
                ".map(f => f.family.replace(/[\"']/g, ''))"
            )
        )
        missing = REQUIRED_FONTS - loaded
        if missing:
            print(f"FAIL fonts did not load: {sorted(missing)} (is this machine online?)")
            return 1

        problems = page.evaluate(CHECKS)

        ids = page.evaluate("[...document.querySelectorAll('.frame')].map(f => f.id)")
        written: list[Path] = []
        for frame_id in ids:
            path = OUT / f"{frame_id}.png"
            page.locator(f"#{frame_id}").screenshot(
                path=str(path), omit_background=True, animations="disabled"
            )
            written.append(path)

        for path in written:
            w, h, colour = png_header(path)
            want = (1280, 720) if "thumb" in path.name else (1920, 1080)
            if (w, h) != want:
                problems.append(f"{path.name}: is {w}x{h}, expected {want[0]}x{want[1]}")
            # Colour type 6 is RGBA. A lower-third without alpha would paint a
            # solid rectangle over the recording instead of a label on it.
            if "-lt-" in path.name and colour != 6:
                problems.append(f"{path.name}: has no alpha channel")

        sheet = contact_sheet(page, written)
        browser.close()

    for path in written:
        w, h, _ = png_header(path)
        print(f"  {path.name:<28} {w}x{h}")
    print(f"  contact sheet -> {sheet}")

    if problems:
        print(f"\nFAIL {len(problems)} problem(s):")
        for line in problems:
            print(f"  - {line}")
        return 1

    print(f"\nOK {len(written)} frames, fonts {sorted(REQUIRED_FONTS)} loaded, all layout checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
