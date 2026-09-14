# Khoj — Call-e hackathon submission

**Deadline: 14 Sept 2026, 11:45 pm SGT (9:15 pm IST).**

## Required by the rules

| Item | Status |
|---|---|
| Pull request to [CALLE-AI/awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents), with its URL on the form | Entry ready below — you open it |
| Demo video, about 3 minutes, on YouTube or Vimeo, **publicly visible** | To record |
| Email address of your Call-e account | Yours to fill in |
| Demo app URL (optional) | https://khoj-beta.vercel.app |
| Feedback survey (optional, for "Most Valuable Feedback") | Optional |

Judged on: **Real World Impact · Quality of the Idea · Technical Implementation · Product Experience & Demo.**

---

## The pull request to awesome-phone-call-agents

Their naming rules: branch `<type>/<short-kebab-summary>`, and PR titles in commit format
`<type>(<scope>): <summary>` — lowercase, imperative, no full stop.

**Steps on GitHub**
1. Fork `CALLE-AI/awesome-phone-call-agents`.
2. Create the branch `docs/add-khoj-community-app`.
3. In `README.md`, add the line below to the end of the **Community apps** list.
4. If you can, run their check: `python3 scripts/validate_repository.py`.
5. Open the pull request with the title and description below.

**Branch**
```
docs/add-khoj-community-app
```

**README line** (Community apps)
```markdown
*   [Khoj](https://github.com/manyamharshitha/KHOJ) - Consent-first CALL-E verification calls to Indian rental brokers that check rent, deposit and availability against the advert and keep the full transcript. See integration notes at [README#call-e-integration-notes](https://github.com/manyamharshitha/KHOJ#call-e-integration-notes).
```

**Commit message and PR title**
```
docs(community-apps): add khoj rental listing verification calls
```

**PR description**
```markdown
Adds Khoj to Community apps.

Khoj places CALL-E calls to the broker behind a rental listing in India, asks the customer's own questions (availability, rent, maintenance, deposit, brokerage), and checks the answers against the advert. The transcript and every mismatch are shown to the customer.

Setup, usage, side effects and cancellation are documented in the project README under "Call-e integration notes":
https://github.com/manyamharshitha/KHOJ#call-e-integration-notes

Safety:
- The opener discloses the AI and asks consent; the call script refuses to build if either is removed, and a refusal ends the call.
- The agent never states a budget, makes an offer, negotiates, or books a viewing.
- Calls run only in 11:00–13:00 and 17:00–20:00 IST, and a number is not re-called within 7 days.
- Every call needs an explicit confirmation naming the property; nothing dials from a search on its own.
- No real phone numbers are included in this change.
```

---

## Devpost form text

### Inspiration
Renting in an Indian city is fought over the phone. Adverts go stale within days, the rent in the listing isn't the rent on the call, maintenance and brokerage appear only after you've fallen for the flat, and none of it is knowable without ringing a broker, one listing at a time. We wanted the calls made for us, honestly, and the answers written down.

### What it does
Khoj reads rental listings from NoBroker, RealEstateIndia, Zolo, Colive and more, and ranks them by what you would really pay each month: rent plus maintenance, not the headline number. Pick a listing, or type a broker's number, and a Call-e voice agent calls the broker. It says it's an AI, asks consent, and asks your questions: is it still available, the real rent, the deposit, the brokerage. It switches language if the broker does.

The answers, the full transcript and an honesty report land on the listing. The honesty report compares what was said with what was advertised and quotes every mismatch. When you want proof the flat exists, Khoj asks the broker for a live video from the property. They open a link on their phone and stream with location on, and a stream from near the address at the agreed time earns the **Khoj Verified** badge.

### How we built it
- **Frontend:** React 19, Vite and styled-components on Vercel, with Firebase Authentication for Google sign-in.
- **Backend:** FastAPI on Render, storing data in Firestore Enterprise through its MongoDB-compatible API.
- **Calls:** a fixed persona plus the customer's questions become one Call-e task, placed with `create_and_wait`. The returned transcript and structured result become answers and an honesty check.
- **Listings:** an HTTP page reader, with headless Chromium only as a fallback. Gemini extracts each listing into typed data, and ranking is plain arithmetic, not a model, so the order is reproducible.
- **Live video:** LiveKit, with short-lived publish-only tokens for the broker, signed webhooks, and a GPS distance check against the geocoded address.
- **Tests:** 271 offline tests, plus 14 live tests that connect to LiveKit and confirm a second participant actually receives decoded video frames.

### Challenges we ran into
- **Portals fight back.** 99acres, MagicBricks, Housing and OLX refuse automated readers, so we dropped them rather than show broken sources. NoBroker returns *410 Gone* for "Bengaluru" and only answers to "bangalore", so city names had to be mapped per portal.
- **512 MB servers.** Launching Chromium on the Render instance got the process killed, and the platform then answered with no CORS headers, so every failure looked like a CORS error. We moved to an HTTP-first reader and a memory check before Chromium is ever launched.
- **A retry that caused a storm.** A client-side retry turned each failure into three requests, which triggered rate limiting, which looked like more failures. We removed it and moved backoff into the polling.
- **SMS in India.** A Twilio trial can't send free text to arbitrary numbers, and Indian SMS needs weeks of DLT registration. The verification link now goes through a one-tap WhatsApp hand-off.
- **What "verified" is allowed to mean.** Indoor GPS is often tens of metres out, so a location mismatch is shown with its distance and a human override, never as an automatic fail. The badge claims only "a live video near this address, around the agreed time."

### Accomplishments that we're proud of
- The AI disclosure and consent request are enforced in code: the call script refuses to build without them.
- Every answer on a result traces back to the broker's own words in the transcript.
- The live video is tested end to end against real LiveKit infrastructure, not only the publishing side.
- Ranking on total monthly cost exposes exactly the hidden-maintenance trick the portals rely on.

### What we learned
A voice agent is only useful in the real world if people can trust what it did. That meant more work on restraint than on talking: what the agent must never say, when it must not call, and how little a badge is allowed to claim.

### What's next for Khoj
- A production messaging sender, so verification links go out automatically
- Using the search's locality for listings added by number, so their live videos can be location-checked
- Server-side recording of live videos, so there's something to review afterwards
- More Indian languages
- Onboarding brokers so verified listings can be published on Khoj directly

### Built with
`react` · `vite` · `styled-components` · `firebase` · `fastapi` · `python` · `pydantic` · `mongodb` · `firestore` · `call-e` · `gemini` · `livekit` · `twilio` · `playwright` · `vercel` · `render`
