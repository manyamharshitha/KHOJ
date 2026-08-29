import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { acceptFields, fromDialerResult, normalise } from '../src/core/extract.js';
import { fromCalleEvent, isCalleEvent } from '../src/core/calleMapper.js';
import { assessListing } from '../src/core/authenticity.js';
import { fetchSource, htmlToText } from '../src/core/sources.js';
import type { CalleWebhookEvent } from '../src/core/calleMapper.js';
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
  recordingUrl: null, error: null, extraction: null, rentDelta: null,
  assessment: null, ...over,
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

/* ------------------------------------------------------- CALL-E translation */

describe('CALL-E webhook mapping', () => {
  const event = (over: Record<string, unknown> = {}): CalleWebhookEvent => ({
    id: 'evt_1',
    type: 'call.completed' as const,
    created_at: '2026-09-10T12:00:00Z',
    data: {
      id: 'task_abc',
      status: 'completed' as const,
      metadata: { callId: 'cal_1', runId: 'run_1' },
      structured_result: null,
      summary: null,
      failure_code: null,
      failure_message: null,
      completed_at: '2026-09-10T12:01:00Z',
      recipients: [{
        id: 'rcp_1',
        phones: ['+919876543210'],
        status: 'completed',
        summary: null,
        structured_result: {
          available: 'yes', bait_pivot: 'no', rent_actual: '32000',
          deposit_months: '3', brokerage_months: '1', non_veg_allowed: 'yes',
          tenant_profile: 'working_women_ok', consent_to_record: 'yes',
          notes: 'Owner prefers family.',
        },
        attempts: [{
          id: 'att_1', phone: '+919876543210', status: 'completed',
          started_at: '2026-09-10T12:00:00Z', completed_at: '2026-09-10T12:00:57Z',
          summary: null, provider_call_id: 'pc_1',
          failure_code: null, failure_message: null,
          transcript_turns: [
            { offset_seconds: 0, speaker: 'bot', text: 'Hello, is that alright?' },
            { offset_seconds: 9, speaker: 'user', text: 'Haan, tell me.' },
            { offset_seconds: 21, speaker: 'user', text: 'Rent is thirty-two thousand, deposit three months.' },
          ],
        }],
      }],
      ...over,
    },
  });

  it('maps a completed call, including the timings', () => {
    const b = fromCalleEvent(event())!;
    assert.equal(b.callId, 'cal_1');
    assert.equal(b.providerCallId, 'task_abc');
    assert.equal(b.status, 'completed');
    assert.equal(b.durationSec, 57);
    assert.equal(b.consentRecord, true);
    assert.equal(b.turns?.length, 3);
  });

  it('calls the bot the agent and the human the broker', () => {
    const b = fromCalleEvent(event())!;
    assert.equal(b.turns?.[0]?.who, 'agent');
    assert.equal(b.turns?.[1]?.who, 'broker');
  });

  it('converts second offsets to milliseconds and closes each turn at the next', () => {
    const turns = fromCalleEvent(event())!.turns!;
    assert.equal(turns[0]?.tStartMs, 0);
    assert.equal(turns[0]?.tEndMs, 9000, 'ends where the next turn starts');
    assert.equal(turns[2]?.tStartMs, 21000);
    assert.equal(turns[2]?.tEndMs, 25000, 'last turn gets a nominal 4s tail');
  });

  it('types the structured result without inventing anything', () => {
    const r = fromCalleEvent(event())!.structuredResult!;
    assert.equal(r.available, true);
    assert.equal(r.baitPivot, false);
    assert.equal(r.rentActual, 32000);
    assert.equal(r.depositMonths, 3);
    assert.equal(r.tenantProfile, 'working_women_ok');
  });

  it('turns "unknown" and empty strings into null, never a guess', () => {
    const e = event();
    e.data.recipients![0]!.structured_result = {
      available: 'unknown', bait_pivot: 'unknown', rent_actual: '',
      deposit_months: '', brokerage_months: '', non_veg_allowed: 'unknown',
      tenant_profile: 'unknown', consent_to_record: 'unknown', notes: '',
    };
    const r = fromCalleEvent(e)!.structuredResult!;
    assert.equal(r.available, null);
    assert.equal(r.rentActual, null);
    assert.equal(r.tenantProfile, null, '"unknown" is not a tenant profile');
    assert.equal(r.notes, null);
  });

  it('reads a no-answer out of the failure code', () => {
    const e = event();
    e.data.status = 'failed' as never;
    e.data.recipients![0]!.attempts![0]!.transcript_turns = [];
    e.data.recipients![0]!.attempts![0]!.failure_code = 'no_answer';
    assert.equal(fromCalleEvent(e)!.status, 'no_answer');
  });

  it('ignores a task it cannot map back to one of our calls', () => {
    const e = event();
    e.data.metadata = {};
    assert.equal(fromCalleEvent(e), null);
  });

  it('recognises the envelope', () => {
    assert.equal(isCalleEvent(event()), true);
    assert.equal(isCalleEvent({ callId: 'x', status: 'completed' }), false);
  });
});

describe('fromDialerResult — evidence without an API call', () => {
  const turns: Turn[] = [
    { who: 'agent', text: 'What is the rent?', tStartMs: 0, tEndMs: 2000 },
    { who: 'broker', text: 'Rent is thirty-two thousand, deposit three months.', tStartMs: 2000, tEndMs: 8000 },
    { who: 'broker', text: 'Non-veg no problem, owner prefers family.', tStartMs: 8000, tEndMs: 12000 },
  ];

  it('attaches the broker turn that states a spoken number', () => {
    const e = fromDialerResult('c1', {
      ...noFields(), available: true, rentActual: 32000, notes: null,
    }, turns, brief, 'completed');
    assert.match(e.evidence.rentActual?.quote ?? '', /thirty-two thousand/);
    assert.equal(e.evidence.rentActual?.tStartMs, 2000);
  });

  it('never sources evidence from the agent', () => {
    const e = fromDialerResult('c1', {
      ...noFields(), rentActual: 32000, notes: null,
    }, turns, brief, 'completed');
    assert.doesNotMatch(e.evidence.rentActual?.quote ?? '', /What is the rent/);
  });

  it('keeps a value that has no locatable quote, but leaves it unsourced', () => {
    const e = fromDialerResult('c1', {
      ...noFields(), available: true, rentActual: 99999, notes: null,
    }, turns, brief, 'completed');
    assert.equal(e.rentActual, 99999, 'the dialer validated it — keep it');
    assert.equal(e.evidence.rentActual, undefined, 'but do not claim evidence');
  });

  it('records where the fields came from', () => {
    const e = fromDialerResult('c1', { ...noFields(), notes: null }, turns, brief, 'completed');
    assert.match(e.model, /^calle:/);
  });
});

/* -------------------------------------------------------- authenticity */

describe('assessListing', () => {
  const ext = (over: Partial<ExtractedFields> & { fieldsPresent?: number; evidence?: object } = {}) => ({
    callId: 'c', model: 'm', extractedAt: '', ...noFields(),
    notes: null, fieldsPresent: 3, evidence: {}, verdict: 'shortlist' as const,
    ...over,
  });

  it('will not judge a call that never connected', () => {
    const a = assessListing({ extraction: null, rentListed: 28000, status: 'no_answer', durationSec: null });
    assert.equal(a.trust, 'unknown');
    assert.equal(a.signals.length, 0);
  });

  it('calls a bait pivot dead even when the broker claimed it was available', () => {
    const a = assessListing({
      extraction: ext({ available: true, baitPivot: true }),
      rentListed: 28000, status: 'completed', durationSec: 60,
    });
    assert.equal(a.trust, 'dead');
    assert.match(a.summary, /bait/i);
    assert.ok(a.signals.some((s) => s.id === 'bait_pivot' && s.weight < 0));
  });

  it('trusts a specific, correctly-priced listing', () => {
    const a = assessListing({
      extraction: ext({
        available: true, rentActual: 28000, depositMonths: 2,
        brokerageMonths: 1, nonVegAllowed: true, fieldsPresent: 5,
      }),
      rentListed: 28000, status: 'completed', durationSec: 65,
    });
    assert.equal(a.trust, 'verified');
    assert.ok(a.signals.some((s) => s.id === 'rent_matches'));
  });

  it('punishes a rent far above the advert and says by how much', () => {
    const a = assessListing({
      extraction: ext({ available: true, rentActual: 40000, fieldsPresent: 2 }),
      rentListed: 28000, status: 'completed', durationSec: 55,
    });
    assert.ok(a.signals.some((s) => s.id === 'rent_far_above'));
    assert.match(a.signals.find((s) => s.id === 'rent_far_above')!.label, /43%/);
    assert.notEqual(a.trust, 'verified');
  });

  it('marks a broker who commits to nothing as doubtful', () => {
    const a = assessListing({
      extraction: ext({ fieldsPresent: 1 }),
      rentListed: 28000, status: 'completed', durationSec: 40,
    });
    assert.equal(a.trust, 'doubtful');
    assert.ok(a.signals.some((s) => s.id === 'vague'));
  });

  it('never claims to have verified the flat itself', () => {
    const a = assessListing({
      extraction: ext({ available: true, rentActual: 28000, fieldsPresent: 5 }),
      rentListed: 28000, status: 'completed', durationSec: 65,
    });
    // The wording must stay about what was said, not about what is true.
    assert.doesNotMatch(a.summary, /guarantee|certified|confirmed genuine/i);
  });

  it('keeps the score inside 0-100 whatever the signals do', () => {
    const worst = assessListing({
      extraction: ext({ available: false, baitPivot: true, rentActual: 90000, fieldsPresent: 0 }),
      rentListed: 20000, status: 'completed', durationSec: 5,
    });
    assert.ok(worst.score >= 0 && worst.score <= 100);
  });
});

/* ------------------------------------------------------------- sources */

describe('htmlToText', () => {
  it('drops scripts and styles rather than reading them as content', () => {
    const t = htmlToText('<style>a{color:red}</style><script>var x=9876543210</script><p>Call 9876543211</p>');
    assert.doesNotMatch(t, /color:red/);
    assert.doesNotMatch(t, /9876543210/, 'a number inside a script is not a broker');
    assert.match(t, /Call 9876543211/);
  });

  it('turns block tags into line breaks so listings stay separate', () => {
    const t = htmlToText('<li>Kondapur 9876543210</li><li>Madhapur 9876543211</li>');
    assert.ok(t.includes('\n'));
  });

  it('decodes the entities that appear in real pages', () => {
    assert.match(htmlToText('<p>Rent &amp; deposit&nbsp;here</p>'), /Rent & deposit here/);
  });
});

describe('fetchSource', () => {
  it('refuses anything that is not a URL', async () => {
    const r = await fetchSource('not a url');
    assert.equal(r.outcome, 'refused');
  });

  it('refuses to fetch the private network', async () => {
    for (const u of ['http://localhost:8080/x', 'http://127.0.0.1/x', 'http://192.168.1.1/']) {
      const r = await fetchSource(u);
      assert.equal(r.outcome, 'refused', u);
      assert.match(r.note, /private network/);
    }
  });

  it('refuses non-http schemes', async () => {
    const r = await fetchSource('file:///etc/passwd');
    assert.equal(r.outcome, 'refused');
  });
});
