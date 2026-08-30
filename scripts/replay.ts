/**
 * Re-run extraction over every stored transcript. Places no calls.
 *
 *   npm run replay              # all runs
 *   npm run replay run_abc123   # one run
 *
 * This is the extraction dev loop: dial once with the mock, then iterate on the
 * prompt and the guard as many times as you like against the same transcripts.
 * Needs ANTHROPIC_API_KEY. The server does not have to be running.
 */
import { config } from '../src/config.js';
import { db, getBrief, getExtraction, getTranscript, saveExtraction } from '../src/db.js';
import { extractFromTranscript } from '../src/core/extract.js';

async function main() {
  if (!config.anthropicKey && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error('No credentials. Set ANTHROPIC_API_KEY in .env, then re-run.');
    process.exit(2);
  }

  const runFilter = process.argv[2];
  const rows = db.prepare(
    `SELECT c.id, c.run_id, c.status FROM calls c
     JOIN transcripts t ON t.call_id = c.id
     ${runFilter ? 'WHERE c.run_id = ?' : ''}
     ORDER BY c.rowid ASC`,
  ).all(...(runFilter ? [runFilter] : [])) as
    { id: string; run_id: string; status: string }[];

  if (rows.length === 0) {
    console.error(
      runFilter
        ? `No stored transcripts for ${runFilter}.`
        : 'No stored transcripts. Run `npm start` and `npm run demo` first.',
    );
    process.exit(1);
  }

  console.log(`\n  Re-extracting ${rows.length} transcript(s) · model ${config.extractionModel}\n`);

  let ok = 0;
  let failed = 0;
  let rejectedTotal = 0;

  for (const row of rows) {
    const turns = getTranscript(row.id);
    if (!turns) continue;
    const before = getExtraction(row.id);

    try {
      const { extraction, rejected } = await extractFromTranscript(
        row.id, turns, getBrief(row.run_id), row.status as 'completed',
      );
      saveExtraction(extraction);
      rejectedTotal += rejected.length;
      ok++;

      const changed = before && before.verdict !== extraction.verdict
        ? `  (was ${before.verdict})` : '';
      console.log(
        `  ${row.id.padEnd(22)} ${extraction.verdict.padEnd(12)} ` +
        `${extraction.fieldsPresent}/5 fields` +
        `${rejected.length ? `  ${rejected.length} rejected` : ''}${changed}`,
      );
    } catch (err) {
      failed++;
      console.log(`  ${row.id.padEnd(22)} FAILED  ${String(err).slice(0, 60)}`);
    }
  }

  console.log(
    `\n  ${ok} extracted, ${failed} failed, ` +
    `${rejectedTotal} unsupported field(s) discarded by the guard.\n`,
  );
}

main().catch((err: unknown) => {
  console.error('replay failed:', err);
  process.exit(1);
});
