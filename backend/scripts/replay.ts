import { config } from '../config.js';
import { getBrief, getExtraction, getTranscript, saveExtraction } from '../db.js';
import { firestore } from '../firebase.js';
import { extractFromTranscript } from '../core/extract.js';

async function main() {
  if (!config.groqKey) {
    console.error('No credentials. Set GROQ_API_KEY in .env, then re-run.');
    process.exit(2);
  }

  const runFilter = process.argv[2];
  let query = firestore.collection('calls').orderBy('created_at', 'asc') as FirebaseFirestore.Query;
  if (runFilter) query = query.where('run_id', '==', runFilter);
  const snap = await query.get();

  const rows: { id: string; run_id: string; status: string }[] = [];
  for (const doc of snap.docs) {
    const transcript = await firestore.collection('transcripts').doc(doc.id).get();
    if (!transcript.exists) continue;
    const d = doc.data();
    rows.push({ id: doc.id, run_id: d.run_id, status: d.status });
  }

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
    const turns = await getTranscript(row.id);
    if (!turns) continue;
    const before = await getExtraction(row.id);

    try {
      const { extraction, rejected } = await extractFromTranscript(
        row.id, turns, await getBrief(row.run_id), row.status as 'completed',
      );
      await saveExtraction(extraction);
      rejectedTotal += rejected.length;
      ok++;

      const changed = before && before.verdict !== extraction.verdict
        ? `  (was ${before.verdict})` : '';
      console.log(
        `  ${row.id.padEnd(22)} ${extraction.verdict.padEnd(12)} ` +
        `${extraction.matchScore}/${extraction.totalQuestions} answers` +
        `${rejected.length ? `  ${rejected.length} rejected` : ''}${changed}`,
      );
    } catch (err) {
      failed++;
      console.log(`  ${row.id.padEnd(22)} FAILED  ${String(err).slice(0, 60)}`);
    }
  }

  console.log(
    `\n  ${ok} extracted, ${failed} failed, ` +
    `${rejectedTotal} unsupported answer(s) discarded by the guard.\n`,
  );
}

main().catch((err: unknown) => {
  console.error('replay failed:', err);
  process.exit(1);
});
