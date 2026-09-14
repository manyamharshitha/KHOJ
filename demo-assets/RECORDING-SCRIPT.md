# Khoj demo: recording script

About **3 minutes** finished. You click, OBS records, and the graphics in
`demo-assets/png` go between the clips in Clipchamp. Record each clip as its
own file, so a mistake means redoing 30 seconds rather than the whole thing.

No new call is placed in this demo. Clip 4 shows a call Khoj already completed,
with **your recording of that call** as the audio.

---

## 0 · Before recording day

### 1. Deploy today's changes
The transcript viewer, the live-video button, the homepage video slot and the
copy fixes are only on your laptop. The site you record must have them:

```bash
git add .gitignore frontend/src
git commit -m "Show call transcripts, request live video from a call, embed the walkthrough video"
git push
```

Optional, if you want the graphics and this script in the repo too:

```bash
git add demo-assets
git commit -m "Add demo video graphics and recording script"
git push
```

Wait about 5 minutes for Vercel and Render to finish, then check:

```bash
curl -s https://khoj-zgkq.onrender.com/api/health
```

Look for `"livekit_configured":true`.

### 2. Register the LiveKit webhook (clip 6 needs it)
LiveKit dashboard → **Settings → Webhooks** → add
`https://khoj-zgkq.onrender.com/api/visits/webhook/livekit`

A live stream's result is decided when LiveKit reports the stream has finished.
Without the webhook, the Verified tab never changes from "Asked".

### 3. Rehearse once, without recording
1. Sign in on the deployed site and open **Results**.
2. Scroll to **Your past calls**. Check there's a **COMPLETED** call with
   **Read the full call** under it.
3. Match it to your recording: the card shows the call's date and time.

**If no completed call appears there, stop and tell me.** Past calls only show
calls placed while signed in to that same Google account.

4. Run clip 6 once from start to finish, so the first time it's recorded isn't
   the first time it's tried.

### 4. Set up the screen
1. Open a **new incognito window** (`Ctrl+Shift+N`). A fresh window shows the
   setup screens a new user sees.
2. Go to **khoj-beta.vercel.app**. One tab only.
3. Zoom to **125%** (`Ctrl` and `+`) and maximise the window.
4. OBS scene **Browser**: Window Capture → the incognito window.
5. OBS scene **Browser + Phone**: add the scrcpy window (clip 6 only).
6. Laptop and phone on **Do Not Disturb**.

### Do NOT click these while recording
| Button | Why |
|---|---|
| **Call now** | Your number is in its 7-day cooldown, so the call would be blocked and show an error on camera |
| **Verify by phone** on a portal listing | Rings a **real broker** who never agreed to be in a demo |
| **Ask** under "Ask Khoj about this listing" | Uses your daily AI quota |
| **Search** a second time | Uses AI quota again. One search only. |

---

## Clip 1 · Sign in  (≈ 20 s after editing)
**Graphic before it:** `k03-section-signin.png` (3 s)

| # | Do this | Wait for |
|---|---|---|
| 1 | Rest on the homepage for 2 seconds | |
| 2 | Click **Log in** (top right) | Login page |
| 3 | Click **Continue with Google** and pick your account | Google's popup. OBS won't show it, which also keeps your email off the video. |
| 4 | Click **I'm looking for a place** | "a few quick questions" |
| 5 | Click **Let's go** | Question 1 |
| 6 | Answer by clicking: **Veg** → **Rent** → **Under ₹50,000** → **2 BHK** → **Bengaluru** | |
| 7 | Locality: type `Koram`, then click **Koramangala** in the list | |
| 8 | Click: **Within a month** → **Family** → **Doesn't matter** → **Doesn't matter** → **No** | "5 more, just for renting" |
| 9 | Click 3 chips: **No or low brokerage fee**, **Maintenance included in rent**, **24x7 water supply** | |
| 10 | Click **Finish setup** | Guided tour |
| 11 | Click **Next**, **Next**, **Next**, **Got it** | Dashboard |

**Voiceover:**
> Khoj starts with Google sign-in. Then a few quick questions: budget,
> bedrooms, city and locality. Those answers become exactly what Khoj checks,
> and what it asks on the call.

**Edit:** speed up steps 6–11 to 2×.

---

## Clip 2 · Sources  (≈ 15 s)
**Graphic before it:** `k04-section-sources.png` (3 s)

| # | Do this |
|---|---|
| 1 | Click **Sources** in the left sidebar |
| 2 | Move the mouse slowly down the list: NoBroker, RealEstateIndia, Zolo, Colive |
| 3 | Switch **Colive** off, pause 1 second, switch it back **on** |
| 4 | Make sure all four switches end up **on** |

**Voiceover:**
> Sources are where Khoj looks. Every portal can be switched on or off, or you
> can paste in a listing site of your own.

---

## Clip 3 · Properties  (≈ 30 s after editing)
**Graphic before it:** `k05-section-properties.png` (3 s)
**Lower-third during the wait:** `k11-lt-search-speed.png`

| # | Do this | Wait for |
|---|---|---|
| 1 | Click **Search Properties From Selected Sources**, **once** | "Searching properties…" |
| 2 | **Don't touch anything.** Keep recording. | 30–90 seconds. Results opens by itself. |
| 3 | Scroll slowly past 3–4 listings with photos | |
| 4 | Click one listing to open it | Its details |
| 5 | Hover over **View on NoBroker ↗** (don't click it) | |
| 6 | Click the listing again to close it | |

**Voiceover:**
> One search reads every portal at once. Each result comes with its photo,
> rent and size, and a link back to the page it came from.

**Edit:** speed the waiting up to 4× and put `k11` over it. Don't cut the wait
out. Showing it sped up proves the search really ran.

---

## Clip 4 · Add a number, and a real call  (≈ 45 s after editing)
**Graphic before it:** `k06-section-call.png` (3 s)
**Lower-third over the call:** `k12-lt-call-real.png` ("Real AI call · recorded earlier")

### Part A: adding a number (record this)
| # | Do this | Wait for |
|---|---|---|
| 1 | Click **Sources** and scroll down to **Already have a number?** | |
| 2 | Click the box and type a 10-digit number | |
| 3 | Click **Add this listing** | "Listing added" dialog |
| 4 | Pause 3 seconds so the warning can be read. Rest the mouse near **Call now**, **don't click it**. | |
| 5 | Click **Ask questions first** | Questions tab |

### Part B: the call (record this)
| # | Do this |
|---|---|
| 1 | Click **Results** in the sidebar |
| 2 | Scroll down to **Your past calls** |
| 3 | Rest on the **COMPLETED** call from your rehearsal for 3 seconds. Its card may just be named **Khoj**: it was added by phone number, so it has no address. |

### In Clipchamp
- Cut straight from Part A step 4 to Part B. Viewers see "add a number", then
  a completed call.
- Import **your recording of that call**. Put the first 15–25 seconds under
  Part B: the AI introducing itself and the first question and answer.
- Put `k12` on top, so it says plainly that the call was recorded earlier.
- Cover the number you typed in Part A wherever it's readable.

**Voiceover:**
> Already have a broker's number? Add it, and Khoj calls. Here's a real call it
> made earlier. The AI says it's an AI, asks if it's a good time, then checks
> availability, rent and deposit.

---

## Clip 5 · Transcript  (≈ 25 s)
**Graphic before it:** `k07-section-transcript.png` (3 s)
**Lower-third:** `k13-lt-transcript.png`

Carry straight on from clip 4, on the same past call:

| # | Do this |
|---|---|
| 1 | Click **Read the full call** |
| 2 | Scroll slowly **inside** the transcript box for about 8 seconds |
| 3 | Click **Read the full call** again to close it |

**Voiceover:**
> Every call is written down, turn by turn, so each answer traces back to what
> the broker actually said.

---

## Clip 6 · Live video  (≈ 40 s after editing)
**Graphic before it:** `k08-section-live.png` (3 s)
**Background:** `k10-split-frame.png`, with the browser clip in the left box
and the phone clip in the right
**Lower-thirds:** `k14-lt-live-gps.png` while streaming, `k15-lt-distance.png`
on the result
**Graphic after it:** `k09-badge-meaning.png` (6 s)

The link goes to the number on that past call, which is your own phone.

### On the laptop (OBS scene Browser + Phone)
| # | Do this | Wait for |
|---|---|---|
| 1 | Under the completed past call, click **Request live video** | "Ask for a live video?" dialog |
| 2 | Leave the pre-filled time (5 minutes from now) and click **Book it** | Verified tab opens with a **Scheduled** entry |
| 3 | Click **Send the request now** | "Khoj could not send it automatically. Send it yourself:" (text messages aren't set up on Render) |
| 4 | Click **Send on WhatsApp**, and send the message to yourself | WhatsApp opens with the message ready |

If WhatsApp isn't signed in on the laptop, click **Copy link** instead and open
the link on the phone some other way.

### On the phone
| # | Do this | Wait for |
|---|---|---|
| 5 | Open the link from WhatsApp | "Please record a short video here" |
| 6 | Tap **Start recording**, then **Allow** camera and **Allow** location | The preview starts and the timer runs |
| 7 | Walk slowly around the room for 20–30 seconds | |
| 8 | Tap **Finish early and send** | "Thank you — video received." |

### Back on the laptop
| # | Do this | Wait for |
|---|---|---|
| 9 | Press `F5` on the **Verified** tab | The status updates, which can take up to a minute |
| 10 | Rest on the result for 3 seconds | |

**What you'll see is "Received", not "Verified".** Its note reads: *"A video
arrived, but the location could not be checked — so this is not verified."*
That's accurate. The past call was added by phone number with no address, so
there's nothing to compare the phone's location against. It's also a fair thing
to show: the badge isn't handed out without proof.

If your rehearsal shows anything else, tell me before you record.

**Voiceover:**
> Khoj can also ask the broker for a live video. They get a link, open it at
> the property, and stream with their location on. The badge only appears if
> the stream came from near the address at around the agreed time. This listing
> was added by phone number with no address, so the location can't be checked,
> and Khoj says so instead of verifying it.

---

## Putting it together in Clipchamp

| Order | Item | Length |
|---|---|---|
| 1 | `k01-title.png` | 4 s |
| 2 | `k02-problem.png` | 5 s |
| 3 | `k03` → **Clip 1** | 3 s + clip |
| 4 | `k04` → **Clip 2** | 3 s + clip |
| 5 | `k05` → **Clip 3** (+ `k11` on top) | 3 s + clip |
| 6 | `k06` → **Clip 4** (+ your call recording, + `k12` on top) | 3 s + clip |
| 7 | `k07` → **Clip 5** (+ `k13` on top) | 3 s + clip |
| 8 | `k08` → **Clip 6** on `k10` (+ `k14`, `k15` on top) | 3 s + clip |
| 9 | `k09-badge-meaning.png` | 6 s |
| 10 | `k16-end.png` | 5 s |

- Lower-thirds go on a track **above** the clip they label.
- Turn on **auto captions** and fix "Khoj", which it will spell wrong.
- Cross-fades between sections only, kept short.
- Before exporting, scrub through the whole video and cover every readable phone
  number: the one typed in clip 4, and the one in WhatsApp in clip 6.

---

## After uploading

1. **YouTube:** upload the 1080p export. Set visibility to **Public**: the
   CALL-E hackathon rules require the video to be "publicly visible", about
   three minutes long. Choose **"No, it's not made for kids"** (kids mode
   restricts embedding).
   Use `k17-thumb-A.png` or `k18-thumb-B.png` as the thumbnail. Custom
   thumbnails need a phone-verified YouTube account.
2. **Put it on the website:** Vercel → your project → **Settings →
   Environment Variables** → add `VITE_DEMO_VIDEO_URL` with the YouTube link
   (Production). Then **Deployments → ⋯ → Redeploy**. Saving the variable alone
   changes nothing, because the link is built into the site at deploy time.
3. **Check it:** open khoj-beta.vercel.app, scroll to **See it in action**, and
   press play. Also open the YouTube link in an incognito window to confirm it
   plays for someone who isn't you.
