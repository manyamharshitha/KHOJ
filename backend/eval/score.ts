import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { extractFromTranscript } from '../core/extract.js';
import type { Brief, Turn } from '../types.js';

const SCORED_FIELDS = ['available', 'baitPivot', 'rentActual'] as const;
type ScoredField = (typeof SCORED_FIELDS)[number];

type Golden = Partial<Record<ScoredField, unknown>>;

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

  const goldens = JSON.parse(readFileSync('eval/goldens.json', 'utf8')) as
    Record<string, Golden>;

  const tallies = new Map<ScoredField, Tally>(
    SCORED_FIELDS.map((f) => [f, { n: 0, exact: 0, miss: 0, wrong: 0 }]),
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

    for (const field of SCORED_FIELDS) {
      if (!(field in expected)) continue;
      const want = expected[field] ?? null;
      const got = extraction[field] ?? null;
      const t = tallies.get(field)!;
      t.n++;

      if (want === got) {
        t.exact++;
      } else if (got === null) {
        t.miss++;
        failures.push(`  MISS  ${file} · ${field}: expected ${fmt(want)}, got null`);
      } else {
        t.wrong++;
        failures.push(`  WRONG ${file} · ${field}: expected ${fmt(want)}, got ${fmt(got)}`);
      }
    }
  }

  const totals = { n: 0, exact: 0, miss: 0, wrong: 0 };
  console.log(`\n  ${'field'.padEnd(18)}${pad('n')}${pad('exact')}${pad('miss')}${pad('wrong')}`);
  console.log('  ' + '─'.repeat(46));
  for (const field of SCORED_FIELDS) {
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
    `hallucinated fields caught by the guard: ${hallucinated}`,
  );

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
const fmt = (v: unknown) => (v === null ? 'null' : JSON.stringify(v));

main().catch((err: unknown) => {
  console.error('\neval failed:', err);
  process.exit(1);
});
