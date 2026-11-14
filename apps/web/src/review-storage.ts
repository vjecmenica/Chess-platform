import type { GameReadResponse } from '@chess/contracts';
import { defaultSearchLimits, searchCommand, validEvaluation, type EngineEvaluation } from './engine-analysis';
import { effectiveThreads, engineDescription, fullEngine, fullSingleEngine, liteEngine } from './engine-builds';
import { accuracyMethodVersion } from './game-accuracy';
import { buildGameReview, reviewMethodVersion, type GameReview } from './game-review';

const databaseName = 'chess-game-reviews';
const storeName = 'reviews';
const version = 1;
const retention = 20;
const profile = searchCommand(defaultSearchLimits);
const variants = [liteEngine, fullSingleEngine, fullEngine];
const bookLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export interface ReviewEngine {
  readonly variant: string;
  readonly threads: number;
}

export interface StoredBook {
  readonly criteria: string;
  readonly checkedAt: number;
  readonly plies: number;
}

interface StoredReview {
  readonly key: string;
  readonly version: number;
  readonly method: string;
  readonly accuracyMethod: string;
  readonly profile: string;
  readonly savedAt: number;
  readonly engine: ReviewEngine;
  readonly evaluations: readonly EngineEvaluation[];
  readonly book?: StoredBook;
}

// Local imports can receive a new runtime ID each time the same PGN is opened.
export function reviewStorageIdentity(game: GameReadResponse, sessionOnly: boolean): string {
  if (game.status !== 'finished' || game.history.length === 0) return '';
  const source = sessionOnly && game.id.startsWith('import-') ? 'local-pgn' : game.id;
  return JSON.stringify([source, game.history[0]!.beforeFen, game.history.map(move => move.uci), game.position.fen]);
}

export async function reviewStorageKey(identity: string): Promise<string | null> {
  if (!identity) return null;
  try {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

export function reviewEngineLabel(engine: ReviewEngine): string | null {
  const variant = variants.find(item => item.id === engine.variant);
  return variant && Number.isInteger(engine.threads) && effectiveThreads(variant, engine.threads, 4) === engine.threads
    ? engineDescription(variant, engine.threads) : null;
}

export function validStoredBook(book: StoredBook | undefined, criteria: string, limit: number,
  now = Date.now()): book is StoredBook {
  return !!book && book.criteria === criteria && Number.isSafeInteger(book.checkedAt)
    && book.checkedAt <= now && now - book.checkedAt <= bookLifetimeMs
    && Number.isInteger(book.plies) && book.plies >= 0 && book.plies <= limit;
}

export function restoreReviewRecord(value: unknown, key: string, game: GameReadResponse) {
  if (!value || typeof value !== 'object' || game.status !== 'finished' || game.history.length === 0) return null;
  const record = value as Partial<StoredReview>;
  if (record.key !== key || record.version !== version || record.method !== reviewMethodVersion
    || record.accuracyMethod !== accuracyMethodVersion || record.profile !== profile
    || !Number.isSafeInteger(record.savedAt)
    || !record.engine || !reviewEngineLabel(record.engine) || !Array.isArray(record.evaluations)
    || record.evaluations.length !== game.history.length + 1) return null;
  const label = reviewEngineLabel(record.engine);
  if (!record.evaluations.every(item => validEvaluation(item)
    && (item.engine === undefined || item.engine === label))) return null;
  try {
    return { review: buildGameReview(game, record.evaluations), engine: record.engine };
  } catch { return null; }
}

let connection: Promise<IDBDatabase> | undefined;
function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Game Review storage unavailable.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
  }).catch((error: unknown) => { connection = undefined; throw error; });
  return connection;
}

async function loadRecord(key: string): Promise<StoredReview | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as StoredReview | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function updateRecord(key: string, update: (previous: StoredReview | undefined) => StoredReview | undefined,
  prune = false): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    const store = transaction.objectStore(storeName);
    const read = store.get(key);
    read.onsuccess = () => {
      const next = update(read.result as StoredReview | undefined);
      if (!next) return;
      const write = store.put(next);
      if (!prune) return;
      write.onsuccess = () => {
        let kept = 0;
        const ordered = store.index('savedAt').openCursor(null, 'prev');
        ordered.onsuccess = () => {
          const cursor = ordered.result;
          if (!cursor) return;
          if (++kept > retention) cursor.delete();
          cursor.continue();
        };
      };
    };
  });
}

export async function loadCompletedReview(key: string, game: GameReadResponse) {
  try { return restoreReviewRecord(await loadRecord(key), key, game); } catch { return null; }
}

export async function saveCompletedReview(key: string, review: GameReview, engine: ReviewEngine): Promise<void> {
  try {
    await updateRecord(key, previous => ({
      key, version, method: review.method, accuracyMethod: accuracyMethodVersion, profile,
      savedAt: Date.now(), engine, evaluations: review.evaluations.map(item => ({
        fen: item.fen, depth: item.depth, score: item.score, bestMove: item.bestMove,
        variation: item.variation.slice(0, 32),
        ...(item.engine === undefined ? {} : { engine: item.engine }),
      })), ...(previous?.book ? { book: previous.book } : {}),
    }), true);
  } catch { /* The completed review remains usable without storage. */ }
}

export async function loadReviewBook(key: string): Promise<StoredBook | undefined> {
  try { return (await loadRecord(key))?.book; } catch { return undefined; }
}

export async function saveReviewBook(key: string, book: StoredBook): Promise<void> {
  try { await updateRecord(key, previous => previous ? { ...previous, book } : undefined); }
  catch { /* Book recognition still works in memory. */ }
}
