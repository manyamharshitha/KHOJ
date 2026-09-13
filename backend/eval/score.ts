import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { extractFromTranscript } from '../core/extract.js';
import type { Brief, Turn } from '../types.js';

const SCORED_FIELDS = ['available', 'baitPivot', 'rentActual'] as const;
type ScoredField = (typeof SCORED_FIELDS)[number];

/** Question ids that carry a labelled expectation. */
const SCORED_QUESTIONS = ['deposit', 'brokerage', 'food', 'tenant'] as const;

interface Golden extends Partial<Record<ScoredField, unknown>> {
  answers?: Record<string, string | null>;
}

type Outcome = 'exact' | 'miss' | 'wrong';

const norm = (t: string) =>
  t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Answers are free text, so "3", "3 months" and "three months" are the same
 * answer. Numbers compare numerically; everything else compares as normalised
 * text with either side allowed to contain the other.
 *
 * A null expectation is strict: only null matches it. That is the whole point —
 * an answer invented where the broker said nothing is the failure this project
 * exists to prevent, and it must never score as a pass.
 */
function compareAnswer(expected: string | null, actual: string | null): Outcome {
  if (expected === null) return actual === null ? 'exact' : 'wrong';
  if (actual === null) return 'miss';

  const wantNum = Number(expected.replace(/[^\d.]/g, ''));
  const gotNum = Number(actual.replace(/[^\d.]/g, ''));
  if (/\d/.test(expected) && /\d/.test(actual)
      && Number.isFinite(wantNum) && Number.isFinite(gotNum)) {
    return wantNum === gotNum ? 'exact' : 'wrong';
  }

  const w = norm(expected);
  const g = norm(actual);
  return w !== '' && g !== '' && (g.includes(w) || w.includes(g)) ? 'exact' : 'wrong';
}

const brief: Brief = {
  city: 'Hyderabad',
  rentCeiling: 100000,
  language: 'en',
  questions: [
    { id: 'rent', text: 'What is the actual monthly rent?', category: 'Price & availability', options: [], selectedOption: null, customOptions: [], required: true, custom: false },
    { id: 'deposit', text: 'What is the security deposit?', category: 'Price & availability', options: [], selectedOption: null, customOptions: [], required: false, custom: false },
    { id: 'brokerage', text: 'Is there a brokerage fee, and how much?', category: 'Price & availability', options: [], selectedOption: null, customOptions: [], required: false, custom: false },
    { id: 'food', text: 'Any restriction on non-veg food?', category: 'Household fit', options: [], selectedOption: null, customOptions: [], required: false, custom: false },
    { id: 'tenant', text: 'Family-only, or are bachelors okay?', category: 'Household fit', options: [], selectedOption: null, customOptions: [], required: false, custom: false },
  ],
};

interface Tally { n: number; exact: number; miss: number; wrong: number }

async function main() {
  if (!config.groqKey) {
    console.error(
      'No credentials. Set GROQ_API_KEY in .env, then re-run.\n' +
      'Extraction is the one part of this backend that cannot be tested offline.',
    );
    process.exit(2);
  }

  // `npm run eval -- --model <id>` scores a different model against the same
  // labels, which is how you compare two models instead of arguing about them.
  const flag = process.argv.indexOf('--model');
  const named = flag !== -1 ? process.argv[flag + 1] : undefined;
  if (named) (config as { extractionModel: string }).extractionModel = named;
  console.log(`
  model: ${config.extractionModel}`);

  const goldens = JSON.parse(readFileSync('eval/goldens.json', 'utf8')) as
    Record<string, Golden>;

  const rows = [...SCORED_FIELDS, ...SCORED_QUESTIONS] as string[];
  const tallies = new Map<string, Tally>(
    rows.map((f) => [f, { n: 0, exact: 0, miss: 0, wrong: 0 }]),
  );
  const failures: string[] = [];
  let hallucinated = 0;
  let cases = 0;

  for (const [file, expected] of Object.entries(goldens)) {
    if (file.startsWith('_')) continue;
    cases++;

    const fixture = JSON.parse(readFileSync(join('fixtures', file), 'utf8')) as
      { turns: Turn[] };

    process.stdout.write(`  extracting ${file} … `);
    const { extraction, rejected } = await extractFromTranscript(
      file, fixture.turns, brief, 'completed',
    );
    hallucinated += rejected.length;
    console.log(`${rejected.length ? `${rejected.length} rejected` : 'ok'}`);

    const record = (field: string, outcome: Outcome, want: unknown, got: unknown) => {
      const t = tallies.get(field)!;
      t.n++;
      t[outcome]++;
      if (outcome !== 'exact') {
        failures.push(
          `  ${outcome === 'miss' ? 'MISS ' : 'WRONG'} ${file} · ${field}: ` +
          `expected ${fmt(want)}, got ${fmt(got)}`,
        );
      }
    };

    for (const field of SCORED_FIELDS) {
      if (!(field in expected)) continue;
      const want = expected[field] ?? null;
      const got = extraction[field] ?? null;
      record(field, want === got ? 'exact' : got === null ? 'miss' : 'wrong', want, got);
    }

    // The per-question answers are most of the extraction, and went unscored
    // before: an accuracy figure that ignored them measured three fields out of
    // seven and called it the model's accuracy.
    for (const qid of SCORED_QUESTIONS) {
      if (!expected.answers || !(qid in expected.answers)) continue;
      const want = expected.answers[qid] ?? null;
      const got = extraction.answers.find((a) => a.questionId === qid)?.answer ?? null;
      record(qid, compareAnswer(want, got), want, got);
    }
  }

  const totals = { n: 0, exact: 0, miss: 0, wrong: 0 };
  console.log(`\n  ${'field'.padEnd(18)}${pad('n')}${pad('exact')}${pad('miss')}${pad('wrong')}`);
  console.log('  ' + '─'.repeat(46));
  for (const field of rows) {
    const t = tallies.get(field)!;
    if (t.n === 0) continue;
    totals.n += t.n; totals.exact += t.exact; totals.miss += t.miss; totals.wrong += t.wrong;
    console.log(
      `  ${field.padEnd(18)}${pad(t.n)}${pad(t.exact)}${pad(t.miss)}${pad(t.wrong)}`,
    );
  }
  console.log('  ' + '─'.repeat(46));

  const acc = totals.n ? (totals.exact / totals.n) * 100 : 0;
  console.log(
    `  ${'overall'.padEnd(18)}${pad(totals.n)}${pad(totals.exact)}${pad(totals.miss)}${pad(totals.wrong)}`,
  );
  console.log(
    `\n  accuracy ${acc.toFixed(1)}%  ·  ${cases} transcripts  ·  ` +
    `hallucinated answers caught by the guard: ${hallucinated}`,
  );

  // The two failures are not equal. A miss costs one phone call; a wrong answer
  // costs a wasted Saturday, so it is called out on its own line.
  if (totals.wrong > 0) {
    console.log(`  ${totals.wrong} wrong answer(s) — these actively mislead the tenant.`);
  }

  if (failures.length) {
    console.log('\n  Failures:\n' + failures.join('\n'));
  }

  if (acc < 90) {
    console.log(`\n  Below the 90% gate — extraction is not finished.`);
    process.exit(1);
  }
  console.log('\n  Above the 90% gate.');
}

const pad = (v: unknown) => String(v).padStart(7);
const fmt = (v: unknown) => (v === null || v === undefined ? 'null' : JSON.stringify(v));

main().catch((err: unknown) => {
  console.error('\neval failed:', err);
  process.exit(1);
});
