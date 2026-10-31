import { diagnoseExplorerFile } from './explorer-diagnostic.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Read-only source PGN diagnostics (no database).\nUsage: npm run --silent explorer:diagnose -- --file <PGN> [--samples 0..20] [--max-plies 1..80]');
    return;
  }
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    if (!['--file', '--samples', '--max-plies'].includes(key) || !args[i + 1] || values.has(key))
      throw new Error('Invalid arguments. Use --help.');
    values.set(key, args[i + 1]!);
  }
  if (!values.get('--file')) throw new Error('A PGN file is required. Use --help.');
  const report = await diagnoseExplorerFile(values.get('--file')!, {
    samples: values.has('--samples') ? Number(values.get('--samples')) : 3,
    maxPlies: values.has('--max-plies') ? Number(values.get('--max-plies')) : 24,
  });
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => {
  // Filesystem errors contain paths; neither those nor source/parser details belong in console output.
  console.error('Diagnostic failed. Check file readability and arguments (--help). No data was written.');
  process.exitCode = 1;
});
