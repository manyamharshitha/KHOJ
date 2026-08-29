import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { acceptFields, normalise } from '../src/core/extract.js';
import { extractPhoneCandidates, parseListings } from '../src/core/parseListings.js';
import {
  assertScriptCompliance, insideCallingWindow, isWithinWindows, istMinutes, toE164,
} from '../src/core/guardrails.js';
import { countFieldsPresent, decideVerdict, rankRows, summarise } from '../src/core/rank.js';
import { buildScript, SCRIPT } from '../src/core/script.js';
import type { Brief, ExtractedFields, ResultRow, Turn } from '../src/types.js';

const brief: Brief = {
  city: 'Hyderabad',
  rentCeiling: 35000,
  brokerageCeilingMonths: 1,
  vegMatters: true,
  nonVegRequired: true,
  tenantProfile: 'working_women',
};

const noFields = (): ExtractedFields => ({
  available: null, baitPivot: null, rentActual: null, depositMonths: null,
  brokerageMonths: null, nonVegAllowed: null, tenantProfile: null, extraAnswer: null,
});

/* ------------------------------------------------------------ phone numbers */

describe('toE164', () => {
  it('accepts the shapes people actually paste', () => {
    assert.equal(toE164('9876543210'), '+919876543210');
    assert.equal(toE164('09876543210'), '+919876543210');
    assert.equal(toE164('+91 98765 43210'), '+919876543210');
    assert.equal(toE164('98765-43210'), '+919876543210');
    assert.equal(toE164('919876543210'), '+919876543210');
  });

  it('rejects what cannot be dialled', () => {
    assert.equal(toE164('12345'), null);
    assert.equal(toE164('5876543210'), null, 'Indian mobiles start 6-9');
    assert.equal(toE164('not a number'), null);
    assert.equal(toE164(''), null);
  });
});

/* ---------------------------------------------------------- calling windows */

describe('calling window', () => {
  // 06:30 UTC is 12:00 IST — inside the 11:00-13:00 block.
  const at = (utcHour: number, utcMin = 0) =>
    new Date(Date.UTC(2026, 8, 10, utcHour, utcMin));

  it('converts to IST minutes', () => {
    assert.equal(istMinutes(at(6, 30)), 12 * 60);
    assert.equal(istMinutes(at(0, 0)), 5 * 60 + 30);
  });

  it('allows the two permitted blocks and refuses the rest', () => {
    assert.equal(isWithinWindows(istMinutes(at(6, 30))), true, '12:00 IST');
    assert.equal(isWithinWindows(istMinutes(at(13, 0))), true, '18:30 IST');
    assert.equal(isWithinWindows(istMinutes(at(3, 0))), false, '08:30 IST — too early');
    assert.equal(isWithinWindows(istMinutes(at(20, 0))), false, '01:30 IST — night');
    assert.equal(isWithinWindows(13 * 60), false, '13:00 IST — block is exclusive at the end');
    assert.equal(isWithinWindows(11 * 60), true, '11:00 IST — block is inclusive at the start');
  });

  it('the dev override short-circuits the gate', () => {
    // IGNORE_CALL_WINDOW=1 in .env, so this is true at any hour.
    assert.equal(insideCallingWindow(at(20, 0)), true);
  });
});

/* --------------------------------------------------------------- compliance */

describe('script compliance', () => {
  it('passes on the shipped script', () => {
    assert.doesNotThrow(() => assertScriptCompliance());
  });

  it('refuses to boot if AI disclosure is removed', () => {
    const original = SCRIPT.opener;
    (SCRIPT as { opener: string }).opener = 'Hello, calling about your listing. Recording this.';
    try {
      assert.throws(() => assertScriptCompliance(), /disclose/);
    } finally {
      (SCRIPT as { opener: string }).opener = original;
    }
  });

  it('refuses to boot if the recording consent is removed', () => {
    const original = SCRIPT.opener;
    (SCRIPT as { opener: string }).opener = "Hello — I'm an AI assistant calling for a tenant.";
    try {
      assert.throws(() => assertScriptCompliance(), /consent to record/);
    } finally {
      (SCRIPT as { opener: string }).opener = original;
    }
  });
});

/* ------------------------------------------------------------- call script */

describe('buildScript', () => {
  it('drops the veg question when the tenant does not care', () => {
    const s = buildScript({ ...brief, vegMatters: false }, { locality: 'Kondapur', rentListed: null });
    assert.ok(!s.steps.some((x) => x.id === 'food'));
  });

  it('adds the custom question only when one was given', () => {
    const without = buildScript(brief, { locality: 'X', rentListed: null });
    assert.ok(!without.steps.some((x) => x.id === 'extra'));

    const with_ = buildScript(
      { ...brief, extraQuestion: 'Is there covered parking?' },
      { locality: 'X', rentListed: null },
    );
    const extra = with_.steps.find((x) => x.id === 'extra');
    assert.equal(extra?.ask, 'Is there covered parking?');
  });

  it('fills the locality into the opener and reads the rent back', () => {
    const s = buildScript(brief, { locality: 'Gachibowli', rentListed: 28000 });
    assert.match(s.opener, /Gachibowli/);
    assert.match(s.opener, /recording/i);
    assert.equal(s.steps.find((x) => x.id === 'rent')?.confirmNumeric, true);
  });
});

/* --------------------------------------------------------- evidence guard */

describe('acceptFields — the hallucination guard', () => {
  const turns: Turn[] = [
    { who: 'broker', text: 'Rent is thirty-two thousand, deposit three months.', tStartMs: 1000, tEndMs: 5000 },
    { who: 'broker', text: 'One month brokerage, standard.', tStartMs: 6000, tEndMs: 8000 },
  ];

  it('accepts a field whose quote is really in the transcript', () => {
    const r = acceptFields(
      [{ name: 'rentActual', value: '32000', quote: 'Rent is thirty-two thousand' }],
      turns,
    );
    assert.equal(r.fields.rentActual, 32000);
    assert.equal(r.rejected.length, 0);
    assert.equal(r.evidence.rentActual?.tStartMs, 1000);
  });

  it('discards a field whose quote was invented', () => {
    const r = acceptFields(
      [{ name: 'rentActual', value: '25000', quote: 'Rent is twenty-five thousand' }],
      turns,
    );
    assert.equal(r.fields.rentActual, null, 'invented quote must not set the field');
    assert.equal(r.rejected.length, 1);
  });

  it('ignores punctuation and casing but not different words', () => {
    const ok = acceptFields(
      [{ name: 'brokerageMonths', value: '1', quote: 'one month brokerage standard' }],
      turns,
    );
    assert.equal(ok.fields.brokerageMonths, 1);

    const no = acceptFields(
      [{ name: 'brokerageMonths', value: '2', quote: 'two month brokerage' }],
      turns,
    );
    assert.equal(no.fields.brokerageMonths, null);
  });

  it('rejects a real quote carrying an uncoercible value', () => {
    const r = acceptFields(
      [{ name: 'tenantProfile', value: 'maybe anyone?', quote: 'One month brokerage' }],
      turns,
    );
    assert.equal(r.fields.tenantProfile, null);
    assert.equal(r.rejected.length, 1);
  });

  it('never reads evidence out of what the agent said', () => {
    const withAgent: Turn[] = [
      { who: 'agent', text: 'Is the rent thirty thousand?', tStartMs: 0, tEndMs: 2000 },
      ...turns,
    ];
    const brokerOnly = withAgent.filter((t) => t.who === 'broker');
    const r = acceptFields(
      [{ name: 'rentActual', value: '30000', quote: 'Is the rent thirty thousand' }],
      brokerOnly,
    );
    assert.equal(r.fields.rentActual, null, 'the agent saying it is not evidence');
  });

  it('normalises consistently', () => {
    assert.equal(normalise('  Rent, is 32,000!  '), 'rent is 32 000');
  });
});

/* ----------------------------------------------------------------- verdicts */

describe('decideVerdict', () => {
  it('marks a bait pivot dead even when availability was claimed', () => {
    const f = { ...noFields(), available: true, baitPivot: true };
    assert.equal(decideVerdict(f, brief, 'completed'), 'dead');
  });

  it('marks an explicit no dead', () => {
    assert.equal(decideVerdict({ ...noFields(), available: false }, brief, 'completed'), 'dead');
  });

  it('flags rent over the ceiling', () => {
    const f = { ...noFields(), available: true, rentActual: 41000 };
    assert.equal(decideVerdict(f, brief, 'completed'), 'over_budget');
  });

  it('flags brokerage over the ceiling', () => {
    const f = { ...noFields(), available: true, rentActual: 30000, brokerageMonths: 2 };
    assert.equal(decideVerdict(f, brief, 'completed'), 'over_budget');
  });

  it('flags a food mismatch', () => {
    const f = { ...noFields(), available: true, rentActual: 30000, nonVegAllowed: false };
    assert.equal(decideVerdict(f, brief, 'completed'), 'mismatch');
  });

  it('flags a family-only owner for a working-women seeker', () => {
    const f = { ...noFields(), available: true, rentActual: 30000, tenantProfile: 'family_only' as const };
    assert.equal(decideVerdict(f, brief, 'completed'), 'mismatch');
  });

  it('shortlists a clean match', () => {
    const f: ExtractedFields = {
      ...noFields(), available: true, rentActual: 30000, depositMonths: 2,
      brokerageMonths: 1, nonVegAllowed: true, tenantProfile: 'working_women_ok',
    };
    assert.equal(decideVerdict(f, brief, 'completed'), 'shortlist');
  });

  it('never shortlists when availability was never established', () => {
    const f = { ...noFields(), rentActual: 30000, nonVegAllowed: true };
    assert.equal(decideVerdict(f, brief, 'completed'), 'unreachable');
  });

  it('calls an unanswered call unreachable regardless of fields', () => {
    const f = { ...noFields(), available: true, rentActual: 20000 };
    assert.equal(decideVerdict(f, brief, 'no_answer'), 'unreachable');
  });
});

describe('countFieldsPresent', () => {
  it('counts the five core fields only', () => {
    assert.equal(countFieldsPresent(noFields()), 0);
    assert.equal(
      countFieldsPresent({ ...noFields(), baitPivot: true, extraAnswer: 'yes' }),
      0,
      'bait pivot and the custom answer are not core fields',
    );
    assert.equal(
      countFieldsPresent({ ...noFields(), available: true, rentActual: 1, brokerageMonths: 0 }),
      3,
      'brokerage of zero still counts as present',
    );
  });
});

/* ------------------------------------------------------- ranking and stats */

const row = (over: Partial<ResultRow> & { callId: string }): ResultRow => ({
  listingId: 'l', extRef: null, phone: '+919876543210', locality: null,
  rentListed: null, status: 'completed', durationSec: 30, consentRecord: true,
  recordingUrl: null, error: null, extraction: null, rentDelta: null, ...over,
});

const ext = (verdict: ResultRow['extraction'] extends null ? never : string, rent: number | null, present = 5) =>
  ({
    callId: 'c', model: 'm', extractedAt: '', ...noFields(),
    rentActual: rent, notes: null, fieldsPresent: present, evidence: {},
    verdict,
  }) as NonNullable<ResultRow['extraction']>;

describe('rankRows', () => {
  it('puts shortlist first, then cheapest, then best-evidenced', () => {
    const rows = [
      row({ callId: 'dead', extraction: ext('dead', null) }),
      row({ callId: 'expensive', extraction: ext('shortlist', 31000) }),
      row({ callId: 'cheap', extraction: ext('shortlist', 24000) }),
      row({ callId: 'overbudget', extraction: ext('over_budget', 40000) }),
    ];
    assert.deepEqual(
      rankRows(rows).map((r) => r.callId),
      ['cheap', 'expensive', 'overbudget', 'dead'],
    );
  });

  it('breaks a rent tie on evidence count', () => {
    const rows = [
      row({ callId: 'thin', extraction: ext('shortlist', 25000, 2) }),
      row({ callId: 'solid', extraction: ext('shortlist', 25000, 5) }),
    ];
    assert.deepEqual(rankRows(rows).map((r) => r.callId), ['solid', 'thin']);
  });
});

describe('summarise', () => {
  it('counts a confirmed-dead call as decisive', () => {
    const rows = [
      row({ callId: 'a', extraction: ext('dead', null) }),
      row({ callId: 'b', extraction: ext('shortlist', 25000) }),
      row({ callId: 'c', status: 'no_answer', extraction: null }),
    ];
    const s = summarise(rows);
    assert.equal(s.decisive, 2, 'dead is a successful outcome, not a failure');
    assert.equal(s.answered, 2);
    assert.equal(s.dead, 1);
    assert.equal(s.shortlisted, 1);
  });

  it('computes the rent gap over the listing', () => {
    const rows = [
      row({ callId: 'a', rentListed: 28000, rentDelta: 4000, extraction: ext('shortlist', 32000) }),
      row({ callId: 'b', rentListed: 20000, rentDelta: 2000, extraction: ext('shortlist', 22000) }),
    ];
    const s = summarise(rows);
    // 14.29% and 10% -> mean 12.14
    assert.ok(s.meanRentDeltaPct !== null);
    assert.ok(Math.abs(s.meanRentDeltaPct! - 12.14) < 0.1);
    assert.ok(Math.abs(s.medianRentDeltaPct! - 12.14) < 0.1);
  });

  it('reports null gap when nothing is comparable', () => {
    const s = summarise([row({ callId: 'a', extraction: ext('dead', null) })]);
    assert.equal(s.meanRentDeltaPct, null);
    assert.equal(s.medianRentDeltaPct, null);
  });
});

/* -------------------------------------------------- pasted listing parsing */

describe('extractPhoneCandidates', () => {
  it('pulls numbers out of a WhatsApp-style forward', () => {
    const text = `
2BHK Kondapur 28,000 rent, call Ramesh 9876543210
Gachibowli 3BHK — 30000 — +91 98765 43211
Madhapur, ask for Suresh: 098765-43212 (rent 26k)
    `;
    assert.deepEqual(extractPhoneCandidates(text), [
      '+919876543210', '+919876543211', '+919876543212',
    ]);
  });

  it('does not mistake rents, deposits or dates for phone numbers', () => {
    const text = 'Rent 28,000 deposit 3 months, brokerage 15000, available 2026-09-14, 32000 negotiable';
    assert.deepEqual(extractPhoneCandidates(text), []);
  });

  it('deduplicates the same number written two ways', () => {
    const text = 'Call 9876543210 or +91 98765 43210 — same broker';
    assert.deepEqual(extractPhoneCandidates(text), ['+919876543210']);
  });

  it('rejects landlines and short numbers, keeping only dialable mobiles', () => {
    const text = 'Office 040-23456789, mobile 9876543210, ext 4521';
    assert.deepEqual(extractPhoneCandidates(text), ['+919876543210']);
  });

  it('finds nothing in text with no numbers at all', () => {
    assert.deepEqual(extractPhoneCandidates('Looking for a 2BHK near the metro'), []);
  });
});

describe('parseListings without a key', () => {
  it('still returns every number, so a paste is never wasted', async () => {
    const res = await parseListings('Kondapur 28000 — 9876543210\nMadhapur — 9876543211');
    assert.equal(res.listings.length, 2);
    assert.equal(res.listings[0]?.phone, '+919876543210');
    assert.equal(res.enriched, false, 'no key means numbers only');
    assert.match(res.note ?? '', /ANTHROPIC_API_KEY/);
  });

  it('says so plainly when there is nothing to find', async () => {
    const res = await parseListings('just some notes, no numbers here');
    assert.equal(res.listings.length, 0);
    assert.match(res.note ?? '', /No phone numbers/);
  });
});
