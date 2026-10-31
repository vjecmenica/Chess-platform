import { diagnoseExplorerFile } from './explorer-diagnostic.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Read-only source PGN diagnostics (no database).\nUsage: npm run --silent explorer:diagnose -- --file <PGN> [--samples 0..20] [--limit 1..10000000] [--max-plies 1..80]\nProgress: stderr every 5 seconds; final JSON: stdout. Limit percentages describe only the examined prefix.');
    return;
  }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    if (!['--file', '--samples', '--max-plies', '--limit'].includes(key) || !args[i + 1] || values.has(key))
      throw new Error('Invalid arguments. Use --help.');
    values.set(key, args[i + 1]!);
  }
  if (!values.get('--file')) throw new Error('A PGN file is required. Use --help.');
  const report = await diagnoseExplorerFile(values.get('--file')!, {
    samples: values.has('--samples') ? Number(values.get('--samples')) : 3,
    maxPlies: values.has('--max-plies') ? Number(values.get('--max-plies')) : 24,
    ...(values.has('--limit') ? { limit: Number(values.get('--limit')) } : {}),
    onProgress: progress => console.error(`Examined ${progress.records} records | elapsed ${progress.elapsedSeconds.toFixed(1)}s | ${progress.recordsPerSecond.toFixed(1)} records/s`),
  });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  // Filesystem errors contain paths; neither those nor source/parser details belong in console output.
  console.error('Diagnostic failed. Check file readability and arguments (--help). No data was written.');
  process.exitCode = 1;
});
