import { open } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import type { MateLine } from '@chess/domain';
import { databaseUrl, loadEnvironment } from './config.js';
import { createPool } from './database.js';
import { createGameService } from './game-service.js';

const usage = 'Usage: npm run adjudication -- list [AFTER_GAME_ID] | show GAME_ID | resolve GAME_ID WITNESS.json';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const square = /^[a-h][1-8]$/;
const maxFileBytes = 32_768;

async function readWitness(path: string): Promise<MateLine> {
  const file = await open(resolve(process.env.INIT_CWD ?? process.cwd(), path), 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error('Use a witness file of at most 32 KiB.');
    const buffer = Buffer.alloc(maxFileBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxFileBytes) throw new Error('Use a witness file of at most 32 KiB.');
    const value: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead));
    if (!Array.isArray(value) || value.length < 1 || value.length > 256 || !value.every(move =>
      move && typeof move === 'object' && !Array.isArray(move)
      && Object.keys(move).every(key => key === 'from' || key === 'to' || key === 'promotion')
      && typeof move.from === 'string' && square.test(move.from)
      && typeof move.to === 'string' && square.test(move.to)
      && (move.promotion === undefined || ['q', 'r', 'b', 'n'].includes(move.promotion)))) {
      throw new Error('Use an array of 1–256 moves with from, to and optional promotion.');
    }
    return value;
  } finally { await file.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  const [command, id, path] = args;
  if (!(command === 'list' && (args.length === 1 || args.length === 2 && id && uuid.test(id))
    || command === 'show' && args.length === 2 && id && uuid.test(id)
    || command === 'resolve' && args.length === 3 && id && uuid.test(id) && path)) throw new Error(usage);

  loadEnvironment();
  const reviewer = userInfo().username;
  if (!process.env.ADJUDICATION_REVIEWERS?.split(',').map(name => name.trim()).includes(reviewer)) {
    throw new Error('This OS user is not authorized for adjudication review.');
  }
  const pool = createPool(databaseUrl(process.env.DATABASE_URL));
  try {
    if (command === 'list') {
      const { rows } = await pool.query(`SELECT a.game_id, a.kind, a.status, a.diagnostic, a.attempts, g.pending, g.fen
        FROM chess.rated_adjudications a JOIN chess.games g ON g.id = a.game_id
        WHERE a.status = 'review' AND ($1::uuid IS NULL OR a.game_id > $1) ORDER BY a.game_id LIMIT 100`, [id ?? null]);
      console.log(JSON.stringify(rows, null, 2));
    } else if (command === 'show') {
      const { rows } = await pool.query(`SELECT a.game_id, a.pending_version, a.kind, a.status, a.diagnostic, a.attempts,
        a.nodes_visited, a.search_ms, a.mate_line, a.decided_by, a.decided_at, a.policy_version,
        g.starting_fen, g.fen, g.pending, g.result, g.flagged_side, g.flagged_at,
        (SELECT row_to_json(r) FROM (SELECT side, version, after_ply FROM chess.game_actions
          WHERE game_id = g.id AND kind = 'resign' AND version = a.pending_version) r) AS resignation,
        (SELECT COALESCE(jsonb_agg(m.record ORDER BY m.ply), '[]') FROM chess.game_moves m WHERE m.game_id = g.id) AS moves
        FROM chess.rated_adjudications a JOIN chess.games g ON g.id = a.game_id WHERE a.game_id = $1`, [id]);
      if (!rows[0]) throw new Error('No adjudication case for this game.');
      console.log(JSON.stringify(rows[0], null, 2));
    } else {
      const applied = await createGameService(pool).finalizeAdjudication(id!, await readWitness(path!), { reviewer });
      if (!applied) throw new Error('This game is not awaiting operator review.');
      console.log('Verified ruling saved.');
    }
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  const message = error instanceof Error && !('code' in error) ? error.message : 'Review operation failed. Check database and file access.';
  console.error(message);
  process.exitCode = 1;
});
