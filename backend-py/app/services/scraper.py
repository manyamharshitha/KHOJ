"""Neighbourhood context from public discussion, summarised by Gemini.

The calling pipeline verifies the *property*. This answers the other half of the
question — what the area is actually like — from people who live there.

Reddit only, through its official OAuth API. The commonly cited trick of
appending ``.json`` to a search URL no longer works — it answers 403 with an
HTML page, because unauthenticated API reads were closed off. So this uses the
documented client-credentials flow with registered credentials, which is the
supported route rather than a way around a block.

Quora forbids scraping in its terms and is not touched. Portals are left to the
crawler, which has a different job.

Everything here degrades rather than fails. A rate limit, an outage, or a
locality nobody has ever posted about all end the same way: no context, said
plainly. A neighbourhood summary is a nice-to-have next to a verified phone
call, and it must never be able to fail a search.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import Field

from app.config import settings
from app.llm.client import LLMError, complete_model, llm_available
from app.models import Base

log = logging.getLogger(__name__)

#: The authenticated search endpoint. The unauthenticated one — appending
#: ".json" to a reddit.com search URL — now answers 403 with an HTML page.
#: That route was closed off, so OAuth is the only one that still returns data.
REDDIT_SEARCH = "https://oauth.reddit.com/search"
REDDIT_TOKEN = "https://www.reddit.com/api/v1/access_token"

#: Reddit rejects unfamiliar or absent user agents outright. This identifies the
#: project honestly rather than impersonating a browser.
UA = "khoj-locality-context/1.0 (rental verification research; contact via repo)"

#: Cached for the process. Tokens last an hour; fetching one per query would
#: triple the request count for no benefit.
_token: tuple[str, float] | None = None


def reddit_configured() -> bool:
    """Whether Reddit credentials exist. Without them there is no context."""
    return bool(settings.reddit_client_id and settings.reddit_client_secret)


async def _access_token() -> str | None:
    """A client-credentials token, cached until shortly before it expires."""
    global _token
    import time

    if _token and _token[1] > time.monotonic() + 60:
        return _token[0]
    if not reddit_configured():
        return None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
            response = await client.post(
                REDDIT_TOKEN,
                data={"grant_type": "client_credentials"},
                auth=(settings.reddit_client_id, settings.reddit_client_secret),
                headers={"User-Agent": settings.reddit_user_agent or UA},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001 - context is optional, never fatal
        log.warning("reddit: could not get a token (%s)", type(exc).__name__)
        return None

    token = payload.get("access_token")
    if not token:
        return None
    _token = (token, time.monotonic() + float(payload.get("expires_in") or 3600))
    return token


#: Enough posts for a pattern, few enough to stay inside a sensible prompt.
MAX_POSTS = 12
MAX_CHARS_PER_POST = 900


@dataclass(slots=True)
class RedditPost:
    title: str
    body: str
    subreddit: str
    score: int
    permalink: str

    def as_text(self) -> str:
        body = self.body[:MAX_CHARS_PER_POST]
        return f"[r/{self.subreddit}, {self.score} points] {self.title}\n{body}".strip()


@dataclass(slots=True)
class LocalityContext:
    """What was found, and where it came from."""

    locality: str
    summary: str | None = None
    pros: list[str] = field(default_factory=list)
    cons: list[str] = field(default_factory=list)
    known_issues: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    post_count: int = 0
    note: str | None = None

    def to_document(self) -> dict[str, Any]:
        return {
            "locality": self.locality,
            "summary": self.summary,
            "pros": self.pros,
            "cons": self.cons,
            "known_issues": self.known_issues,
            "sources": self.sources,
            "post_count": self.post_count,
            "note": self.note,
        }


class LocalitySummary(Base):
    """Gemini's reading of what residents actually said."""

    summary: str = Field(max_length=700)
    pros: list[str] = Field(default_factory=list, max_length=6)
    cons: list[str] = Field(default_factory=list, max_length=6)
    known_issues: list[str] = Field(default_factory=list, max_length=6)


SYSTEM = """\
You summarise what people who live in an Indian neighbourhood have said about it
in public forum posts, for someone deciding whether to rent there.

Rules:

1. Use ONLY the posts provided. Never add general knowledge about the city or
   area. If the posts do not mention something, it does not go in.
2. Report what residents claim, not what is true. These are opinions from the
   internet and some are wrong. Prefer points several posts agree on.
3. Concrete over vague. "Water tankers needed in April and May" is useful;
   "infrastructure issues" is not.
4. known_issues is for recurring, specific problems — flooding on a named road,
   power cuts, water shortage, traffic at a named junction.
5. If the posts are mostly unrelated to living there, say so in summary and
   leave the lists empty. An honest "nothing useful was found" beats a
   confident summary of noise.
6. Never mention rent prices. Rent is established by the phone call, not by
   strangers online, and a forum figure would undercut a verified one.
"""


async def search_reddit(query: str, *, limit: int = MAX_POSTS) -> list[RedditPost]:
    """Public Reddit search. Returns an empty list on any failure."""
    token = await _access_token()
    if not token:
        return []

    params = {"q": query, "limit": str(limit), "sort": "relevance", "t": "year"}
    headers = {
        "User-Agent": settings.reddit_user_agent or UA,
        "Authorization": f"Bearer {token}",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(12.0), headers=headers, follow_redirects=True
        ) as client:
            response = await client.get(REDDIT_SEARCH, params=params)
            if response.status_code == 429:
                log.warning("reddit: rate limited on %r", query)
                return []
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001 - context is optional, never fatal
        log.info("reddit: search failed for %r (%s)", query, type(exc).__name__)
        return []

    posts: list[RedditPost] = []
    for child in (payload.get("data") or {}).get("children") or []:
        data = child.get("data") or {}
        title = (data.get("title") or "").strip()
        if not title:
            continue
        posts.append(
            RedditPost(
                title=title,
                body=(data.get("selftext") or "").strip(),
                subreddit=data.get("subreddit") or "",
                score=int(data.get("score") or 0),
                permalink=f"https://www.reddit.com{data.get('permalink') or ''}",
            )
        )
    return posts


async def gather_posts(locality: str, city: str | None = None) -> list[RedditPost]:
    """Several angles on one locality, deduplicated.

    One query returns whatever Reddit's relevance ranking likes; asking about
    living there, flooding and water separately is what surfaces the specific
    complaints that make this worth reading at all.
    """
    where = f"{locality} {city}".strip() if city else locality
    queries = [
        f"{where} living review",
        f"{where} flooding OR waterlogging OR monsoon",
        f"{where} water supply OR traffic OR power cut",
    ]

    results = await asyncio.gather(*(search_reddit(q) for q in queries), return_exceptions=True)

    seen: set[str] = set()
    posts: list[RedditPost] = []
    for result in results:
        if isinstance(result, BaseException):
            continue
        for post in result:
            if post.permalink in seen:
                continue
            seen.add(post.permalink)
            posts.append(post)

    posts.sort(key=lambda p: p.score, reverse=True)
    return posts[:MAX_POSTS]


async def locality_context(locality: str, city: str | None = None) -> LocalityContext:
    """Public discussion about a locality, summarised. Never raises."""
    locality = (locality or "").strip()
    if not locality:
        return LocalityContext(locality="", note="No locality was identified for this listing.")

    if not reddit_configured():
        return LocalityContext(
            locality=locality,
            note=(
                "Neighbourhood context is not configured. It needs Reddit API "
                "credentials — register a script app at reddit.com/prefs/apps "
                "and set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET."
            ),
        )

    posts = await gather_posts(locality, city)
    if not posts:
        return LocalityContext(
            locality=locality,
            post_count=0,
            note=(
                "No public discussion about this area was found. That is common "
                "for smaller localities and says nothing about the place itself."
            ),
        )

    if not llm_available():
        return LocalityContext(
            locality=locality,
            post_count=len(posts),
            sources=[p.permalink for p in posts[:5]],
            note="Found discussion, but the summariser is not configured on this server.",
        )

    corpus = "\n\n---\n\n".join(p.as_text() for p in posts)
    try:
        result = await complete_model(
            system=SYSTEM,
            user=f"Neighbourhood: {locality}{f', {city}' if city else ''}\n\nPosts:\n\n{corpus}",
            output=LocalitySummary,
            temperature=0.0,
        )
    except LLMError as exc:
        log.warning("locality: summary failed for %s (%s)", locality, exc)
        return LocalityContext(
            locality=locality,
            post_count=len(posts),
            sources=[p.permalink for p in posts[:5]],
            note="Found discussion, but it could not be summarised just now.",
        )

    return LocalityContext(
        locality=locality,
        summary=result.summary,
        pros=result.pros,
        cons=result.cons,
        known_issues=result.known_issues,
        sources=[p.permalink for p in posts[:5]],
        post_count=len(posts),
        note=(
            "Opinions from public Reddit posts by people who say they live in the "
            "area. Unverified, unlike the phone call."
        ),
    )
