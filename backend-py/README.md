# Khoj — Python backend

Give it a sentence and up to five sites. It crawls them, reads the listings with
an LLM, ranks them cheapest-first, phones each owner with a conversational voice
agent, records what was said, and reports where the phone call and the advert
disagree.

Python 3.11+ · FastAPI · Firestore · Playwright · Twilio Media Streams + OpenAI
Realtime.

## Run it

```bash
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Nothing above needs a telephony account. `TELEPHONY_PROVIDER=mock` is the
default and simulates calls from a fixture through the *same* downstream path a
real call takes — the same webhook handler, the same transcript storage, the
same honesty evaluation.

```bash
pytest            # 39 tests. No network, no Firebase, no LLM key.
```

## The two commitments

Almost every design decision here follows from one of these.

**A blank beats a guess.** A missing field costs the customer one phone call. A
wrong field costs her a Saturday. So unstated values stay `None` at every layer:
the preference parser does not infer a city from a locality, the extractor does
not turn a missing maintenance charge into zero, and the honesty evaluator
discards any finding it cannot quote.

**It records claims, not truth.** Nothing here proves a flat exists — nobody can,
over the phone. What it captures is a timestamped, recorded claim, and what it
detects is the *shape* of a misleading advert: a rent that moved, maintenance
that was never mentioned, an "owner" who describes a commission.

## Flow

| Step | Module | What happens |
|---|---|---|
| 1 | `llm/preferences.py` | Free text → `SearchCriteria`. No keyword rules |
| 2 | `scraping/crawler.py` | Playwright renders each site, returns sanitised text |
| 3 | `llm/extractor.py` | Text → typed `Listing`s, scored against the brief |
| 4 | `ranking.py` | `rent + maintenance` ascending, newer building breaks ties |
| 5 | `telephony/persona.py` | A system prompt built from *this* listing and *her* must-haves |
| 6 | `telephony/realtime.py` | Twilio audio ↔ OpenAI Realtime, both directions |
| 7 | `routes/telephony.py` | Recording → Firebase Storage, signed URL |
| 8 | `llm/honesty.py` | Advert vs. transcript → discrepancies, Q&A, score |

## API

```
GET  /api/health                          which providers are actually wired
GET  /api/sites                           known portals, and whether contacts are reachable
POST /api/search                          start a search, returns immediately
GET  /api/session/{id}                    status and ranked listings
POST /api/session/{id}/call-all           phone the matches, cheapest first
GET  /api/session/{id}/results            listings + recordings + Q&A + honesty reports
```

Telephony webhooks (`/api/telephony/voice`, `/stream`, `/status`, `/recording`)
are for Twilio, not for you.

```bash
curl -X POST localhost:8000/api/search -H 'content-type: application/json' -d '{
  "prompt": "pet-friendly 2BHK near HSR Layout under 35k with reserved parking in a new society",
  "sites": ["nobroker", "99acres"]
}'
```

## Firestore

Five collections: `customers`, `search_sessions`, `listings`, `calls`,
`analyses`. Every shape is a Pydantic model in `models.py` — Firestore is
schemaless, so the schema lives there or nowhere.

`repositories.py` is the only module that imports the database. That boundary is
what would let this swap stores again without touching a route.

`total_monthly_cost` is **derived, never read from the page.** Portals advertise
rent and bury maintenance; ranking on rent alone reproduces the exact deception
this product exists to expose.

## Three things to know before you demo

**Portals gate the phone numbers.** NoBroker, 99acres, MagicBricks, Housing and
OLX all keep contact details behind a login and usually an OTP, and they block
automated readers. `GET /api/sites` says so per site, and the crawler returns
`blocked` or `contact_gated` with an explanation instead of a silent empty
result. A search can find listings there and still have nothing to dial. Where
this works end-to-end is a URL the customer pastes herself, a builder's own site,
or a classifieds page.

**No bot-detection evasion.** The crawler identifies itself honestly and sends no
forged fingerprints. A site that does not want to be read automatically is
reported as blocked rather than worked around.

**Twilio is not CALL-E.** If this is going to the CALL-E hackathon, the rules
require the entry to use CALL-E's SDK/API/MCP/CLI. `telephony/dialer.py` is a
`Protocol` with two implementations, so a `CalleDialer` drops in beside
`TwilioDialer` without touching anything above it — but as configured, this
submission would not satisfy that rule.

## Call policy

Not optional extras. These are what separate a useful service from a nuisance.

- Calls go out **11:00–13:00 and 17:00–20:00 IST** only. A malformed
  `CALL_WINDOWS_IST` falls back to that default rather than leaving an empty
  list, which would permit 3am.
- **One call per number per 7 days**, across every customer.
- **Three concurrent calls**, so a run does not ring forty phones at once.
- The agent **discloses that it is an AI and asks consent to record** in its
  first sentence. `assert_compliance()` runs at import and refuses to start the
  process if either is edited away, or if promotional language appears.
- **A recording with no clear consent is discarded**, not stored. `_read_consent`
  only accepts a clear yes; anything ambiguous stays `None` and the audio is
  dropped.
- The agent never negotiates, never books a viewing, and never states the
  customer's budget.

## What is not done

- **No real call has been placed.** The Twilio path is written against the
  documented API but has never run against a live number.
- **The LLM paths need a key.** `pytest` covers the deterministic logic —
  phone normalisation, ranking, the constraint filter, the compliance gate, the
  evidence guard. The model calls themselves are unverified.
- **No auth yet.** `AUTH_REQUIRED` and `DEV_AUTH_TOKEN` are read but no route
  enforces them; sessions are not yet scoped to a customer.
