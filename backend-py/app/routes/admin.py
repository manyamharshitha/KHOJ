"""Portal API credentials, and broker bulk upload.

On the credentials half, one thing has to be said plainly because the spec that
asked for it assumes otherwise: **as of 2026-09-09 none of 99acres, CommonFloor,
Housing or MagicBricks runs a public developer programme.** There is no page to
request a key from. This store exists so that if one of them ever opens up, the
plumbing is already here — but nothing in the search path reads it today, and
storing a key here will not make a portal answer an API that does not exist.

Keys are never returned. A read gives back a stub (``sk_...56``) which is enough
to tell two credentials apart and useless to anyone who intercepts it.
"""

from __future__ import annotations

import csv
import io
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import Field

from app.core.auth import OptionalUser, require_user
from app.llm.extractor import to_e164
from app.models import (
    Base,
    Listing,
    PortalCredential,
    SearchCriteria,
    SearchSession,
    SessionStatus,
    TargetSite,
    UserType,
)
from app.repositories import (
    create_session,
    delete_portal_credential,
    get_broker_profile,
    get_user_type,
    list_portal_credentials,
    new_id,
    save_listings,
    save_portal_credential,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["admin"])

BULK_SOURCE = "Broker upload"
BULK_PLACEHOLDER_URL = "https://broker-upload.local/"

#: A CSV bigger than this is not a broker's listing sheet.
_MAX_CSV_BYTES = 2 * 1024 * 1024
_MAX_ROWS = 500


class CredentialRequest(Base):
    site_id: str = Field(min_length=1, max_length=60)
    api_endpoint: str
    api_key: str = Field(min_length=1, max_length=500)
    auth_type: str = Field(default="bearer", max_length=30)
    rate_limit_per_day: int = Field(default=1000, ge=1, le=10_000_000)


@router.post("/admin/portal-credentials")
async def save_credential(body: CredentialRequest, user: OptionalUser) -> dict[str, object]:
    await require_user(user)
    credential = PortalCredential(
        site_id=body.site_id.strip().lower(),
        api_endpoint=body.api_endpoint,  # type: ignore[arg-type]
        api_key=body.api_key,
        auth_type=body.auth_type,
        rate_limit_per_day=body.rate_limit_per_day,
    )
    await save_portal_credential(credential)
    return {
        "credential": credential.masked(),
        "note": (
            "Stored. Nothing reads this yet: no Indian rental portal currently "
            "offers a public API, so search still goes through the browser."
        ),
    }


@router.get("/admin/portal-credentials")
async def list_credentials(user: OptionalUser) -> dict[str, object]:
    """Every stored credential, keys masked."""
    await require_user(user)
    return {"credentials": [c.masked() for c in await list_portal_credentials()]}


@router.delete("/admin/portal-credentials/{site_id}")
async def remove_credential(site_id: str, user: OptionalUser) -> dict[str, bool]:
    await require_user(user)
    if not await delete_portal_credential(site_id.strip().lower()):
        raise HTTPException(status_code=404, detail="No credential for that site.")
    return {"deleted": True}


@router.post("/broker/listings/bulk-upload")
async def bulk_upload(
    user: OptionalUser, file: UploadFile = File(...)
) -> dict[str, object]:
    """Load a broker's listings from a CSV.

    Rows are validated one at a time and reported individually. A sheet of fifty
    where three have a bad phone number imports forty-seven and names the three,
    rather than refusing the lot — a broker retyping a spreadsheet because of one
    typo will simply not use this.

    A listing with no dialable number is still stored. It cannot be called, but
    it is a real property the broker owns and it belongs on their dashboard.
    """
    account = await require_user(user)
    if await get_user_type(account.uid) is not UserType.BROKER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a broker account can bulk-upload listings.",
        )

    raw = await file.read(_MAX_CSV_BYTES + 1)
    if len(raw) > _MAX_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That file is larger than 2 MB.",
        )

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Excel on a Windows machine in India commonly writes cp1252.
        try:
            text = raw.decode("cp1252")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="That file is not readable as text. Save it as CSV (UTF-8).",
            ) from None

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That CSV has no header row.",
        )

    headers = {(h or "").strip().lower() for h in reader.fieldnames}
    if not headers & {"phone", "contact_number", "contact", "mobile"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "No phone column found. Include one named phone, mobile, "
                "contact or contact_number."
            ),
        )

    profile = await get_broker_profile(account.uid)
    session = SearchSession(
        id=new_id("ses"),
        customer_id=account.uid,
        prompt=f"Bulk upload from {profile.business_name if profile else 'a broker'}",
        criteria=SearchCriteria(),
        # A session must carry at least one target site — the model enforces it,
        # because a search of nowhere is a bug everywhere else. Nothing was
        # crawled here, so this stands in, exactly as the manual-entry route
        # does for the same reason.
        target_sites=[
            TargetSite(name=BULK_SOURCE, url=BULK_PLACEHOLDER_URL, contact_gated=False)  # type: ignore[arg-type]
        ],
        status=SessionStatus.RANKED,
    )
    await create_session(session)

    def pick(row: dict[str, str], *names: str) -> str | None:
        for name in names:
            for key, value in row.items():
                if (key or "").strip().lower() == name and (value or "").strip():
                    return value.strip()
        return None

    def money(value: str | None) -> int | None:
        if not value:
            return None
        digits = "".join(ch for ch in value if ch.isdigit())
        return int(digits) if digits else None

    listings: list[Listing] = []
    problems: list[dict[str, object]] = []

    for index, row in enumerate(reader, start=2):  # row 1 is the header
        if index - 1 > _MAX_ROWS:
            problems.append({"row": index, "problem": f"Stopped at {_MAX_ROWS} rows."})
            break

        raw_phone = pick(row, "phone", "contact_number", "contact", "mobile")
        phone = to_e164(raw_phone) if raw_phone else None
        if raw_phone and not phone:
            problems.append(
                {"row": index, "problem": f"{raw_phone!r} is not a dialable Indian number."}
            )

        title = pick(row, "title", "name", "property", "address")
        locality = pick(row, "locality", "area", "neighbourhood", "neighborhood")
        if not title and not locality:
            problems.append({"row": index, "problem": "No title, address or locality."})
            continue

        listings.append(
            Listing(
                id=new_id("lst"),
                session_id=session.id,
                source_site=BULK_SOURCE,
                title=title,
                locality=locality,
                bedrooms=int(b) if (b := pick(row, "bedrooms", "bhk", "beds") or "").isdigit() else None,
                rent=money(pick(row, "rent", "price", "monthly_rent")),
                deposit=money(pick(row, "deposit", "security_deposit")),
                maintenance=money(pick(row, "maintenance")),
                contact_number=phone,
                contact_name=pick(row, "owner", "broker", "contact_name")
                or (profile.business_name if profile else None),
                is_broker=True,
            )
        )

    saved = await save_listings(listings) if listings else 0
    log.info(
        "bulk: %s uploaded %d listing(s), %d problem row(s)",
        account.uid,
        saved,
        len(problems),
    )

    return {
        "session_id": session.id,
        "imported": saved,
        "callable": sum(1 for x in listings if x.is_callable),
        "problems": problems,
        "note": (
            f"{saved} listing(s) imported."
            + (f" {len(problems)} row(s) had problems." if problems else "")
        ),
    }
