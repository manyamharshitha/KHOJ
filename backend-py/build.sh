#!/usr/bin/env bash
#
# Render build step.
#
# `pip install playwright` installs the Python client. It does NOT install the
# browser it drives, nor the shared libraries Chromium needs on a bare Linux
# image — and Render's Python runtime ships none of them. Without the two
# commands below the crawler has a working import, a working API, and no
# browser: every search reached `scraping` and stopped there.
#
# `--with-deps` is the half that is easy to miss. It runs the distro package
# installer for the ~40 libraries Chromium links against (libnss3, libatk,
# libgbm and friends). Installing the browser without them produces a binary
# that exits immediately or blocks on a missing symbol, which is far harder to
# diagnose than a clean "executable doesn't exist".

set -o errexit
set -o nounset
set -o pipefail

echo "--- pip ---"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

echo "--- chromium + OS dependencies ---"
# Chromium only. Firefox and WebKit are never launched by this codebase and
# together cost several hundred megabytes of build time and disk.
python -m playwright install chromium --with-deps

echo "--- verifying the browser actually launches ---"
# Proving it here turns a runtime hang into a build failure. A browser that
# cannot start is the single fault that this whole build step exists to
# prevent, so it is worth ten seconds to find out now rather than from a
# customer's stuck progress bar.
python - <<'PY'
import asyncio


async def main() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        # The same flags the crawler uses, so this proves the configuration
        # that actually runs rather than a more permissive one.
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
            ],
        )
        page = await browser.new_page()
        await page.set_content("<h1>ok</h1>")
        assert await page.inner_text("h1") == "ok"
        await browser.close()
    print("chromium launches and renders")


asyncio.run(main())
PY

echo "--- build complete ---"
