// Glickman's Glicko-2 specification, March 2022: https://www.glicko.net/glicko/glicko2.pdf
export const ratingParameters = Object.freeze({
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  tau: 0.5,
  convergenceTolerance: 0.000001,
  provisionalRd: 110,
  inactivityPeriodMs: 24 * 60 * 60 * 1000,
});

const scale = 173.7178;
const maxIterations = 100;
const maxRatedGames = 2_147_483_647; // PostgreSQL integer
const maxTimestampMs = 8.64e15; // JavaScript Date's upper bound

export interface RatingValues {
  readonly rating: number;
  readonly rd: number;
  readonly volatility: number;
}

export interface RatingState extends RatingValues {
  readonly ratedGames: number;
  /** UTC milliseconds since the Unix epoch. The stored RD is anchored at this instant. */
  readonly lastRatedAtMs: number | null;
}

export type RatingScore = 0 | 0.5 | 1;

export interface RatingResult {
  readonly opponent: Pick<RatingValues, 'rating' | 'rd'>;
  readonly score: RatingScore;
}

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maxTimestampMs;
}

function validRatingAndDeviation(values: RatingResult['opponent']): boolean {
  return Number.isFinite(values.rating) && Number.isFinite(values.rd) && values.rd > 0;
}

function validValues(values: RatingValues): boolean {
  return validRatingAndDeviation(values) && Number.isFinite(values.volatility) && values.volatility > 0;
}

export function isRatingState(value: unknown): value is RatingState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as RatingState;
  return validValues(state) && state.rd <= ratingParameters.initialRd
    && Number.isInteger(state.ratedGames) && state.ratedGames >= 0 && state.ratedGames <= maxRatedGames
    && (state.ratedGames === 0 ? state.lastRatedAtMs === null
      : state.lastRatedAtMs !== null && validTimestamp(state.lastRatedAtMs));
}

export function initialRatingState(): RatingState {
  return {
    rating: ratingParameters.initialRating,
    rd: ratingParameters.initialRd,
    volatility: ratingParameters.initialVolatility,
    ratedGames: 0,
    lastRatedAtMs: null,
  };
}

function nextVolatility(volatility: number, phi: number, variance: number, delta: number): number {
  const { tau, convergenceTolerance } = ratingParameters;
  const logVariance = 2 * Math.log(volatility);
  const deltaSquared = delta ** 2;
  const base = phi ** 2 + variance;
  const f = (x: number) => {
    const exp = Math.exp(x);
    const denominator = base + exp;
    // Divide before multiplying to avoid squaring a potentially large denominator.
    return (exp / denominator) * (deltaSquared / denominator - 1) / 2 - (x - logVariance) / tau ** 2;
  };
  let a = logVariance;
  let b = deltaSquared > base ? Math.log(deltaSquared - base) : a - tau;
  let fa = f(a);
  let fb = f(b);
  if (deltaSquared <= base) {
    for (let step = 2; step <= maxIterations && fb < 0; step++) {
      b = a - step * tau;
      fb = f(b);
    }
  }
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || Math.sign(fa) * Math.sign(fb) > 0) {
    throw new RangeError('Glicko-2 volatility could not be bracketed.');
  }
  if (fa === 0) return volatility;
  if (fb === 0) return Math.exp(b / 2);

  // Illinois false-position iteration from step 5 of the specification.
  for (let step = 0; step < maxIterations; step++) {
    if (Math.abs(b - a) <= convergenceTolerance) return Math.exp(a / 2);
    const interpolated = a + (a - b) * (fa / (fb - fa));
    // An extreme mismatch can round the interpolation to an endpoint. Bisect to make progress.
    const next = interpolated === a || interpolated === b ? (a + b) / 2 : interpolated;
    const fNext = f(next);
    if (!Number.isFinite(fNext)) break;
    if (fNext === 0) return Math.exp(next / 2);
    if (Math.sign(fNext) !== Math.sign(fb)) {
      a = b;
      fa = fb;
    } else {
      fa /= 2;
    }
    b = next;
    fb = fNext;
  }
  throw new RangeError('Glicko-2 volatility did not converge.');
}

function updateRating(player: RatingValues, results: readonly RatingResult[], fullPeriod: boolean): RatingValues {
  if (!validValues(player)) throw new RangeError('Invalid Glicko-2 rating values.');
  const phi = player.rd / scale;
  if (results.length === 0) {
    const idle = { rating: player.rating, rd: Math.hypot(phi, player.volatility) * scale, volatility: player.volatility };
    if (!validValues(idle)) throw new RangeError('Glicko-2 produced invalid rating values.');
    return idle;
  }

  let information = 0;
  let gradient = 0;
  for (const { opponent, score } of results) {
    if (!validRatingAndDeviation(opponent) || (score !== 0 && score !== 0.5 && score !== 1)) {
      throw new RangeError('Invalid Glicko-2 opponent or score.');
    }
    const g = 1 / Math.hypot(1, (Math.sqrt(3) / Math.PI) * (opponent.rd / scale));
    const logOdds = g * (player.rating / scale - opponent.rating / scale);
    const tail = Math.exp(-Math.abs(logOdds));
    const denominator = 1 + tail;
    // Compute the small probability directly, even when its complement rounds to 1.
    information += g ** 2 * tail / denominator ** 2;
    gradient += g * (logOdds >= 0 ? (score - 1) + tail / denominator : score - tail / denominator);
  }

  const variance = 1 / information;
  const delta = variance * gradient;
  if (!Number.isFinite(variance) || !Number.isFinite(delta ** 2)) {
    throw new RangeError('Glicko-2 results exceed the supported numerical range.');
  }
  const volatility = nextVolatility(player.volatility, phi, variance, delta);
  const priorPhi = fullPeriod ? Math.hypot(phi, volatility) : phi;
  const newPhi = 1 / Math.hypot(1 / priorPhi, Math.sqrt(information));
  const updated = { rating: player.rating + scale * newPhi ** 2 * gradient, rd: scale * newPhi, volatility };
  if (!validValues(updated)) throw new RangeError('Glicko-2 produced invalid rating values.');
  return updated;
}

/** Official batch algorithm. An empty period increases RD by one period of process variance. */
export function calculateGlicko2Period(player: RatingValues, results: readonly RatingResult[]): RatingValues {
  return updateRating(player, results, true);
}

/** Effective RD at an explicit time. This read does not advance the stored RD or its anchor. */
export function effectiveRatingDeviation(state: RatingState, atMs: number): number {
  if (!isRatingState(state)) throw new RangeError('Invalid account rating state.');
  if (!validTimestamp(atMs) || (state.lastRatedAtMs !== null && atMs < state.lastRatedAtMs)) {
    throw new RangeError('Invalid rating activity timestamp.');
  }
  if (state.lastRatedAtMs === null || atMs === state.lastRatedAtMs) return state.rd;
  const elapsedPeriods = (atMs - state.lastRatedAtMs) / ratingParameters.inactivityPeriodMs;
  const deviation = Math.hypot(state.rd, scale * state.volatility * Math.sqrt(elapsedPeriods));
  return Math.min(ratingParameters.initialRd, deviation);
}

export function isProvisionalRating(state: RatingState, atMs: number): boolean {
  return effectiveRatingDeviation(state, atMs) > ratingParameters.provisionalRd;
}

/** Apply one game's results to both pre-result states. Only elapsed time contributes process variance. */
export function rateGame(first: RatingState, second: RatingState, firstScore: RatingScore, atMs: number):
  readonly [RatingState, RatingState] {
  const firstPrior = { ...first, rd: effectiveRatingDeviation(first, atMs) };
  const secondPrior = { ...second, rd: effectiveRatingDeviation(second, atMs) };
  const update = (player: RatingState, opponent: RatingState, score: RatingScore): RatingState => {
    const values = updateRating(player, [{ opponent, score }], false);
    const state = { ...values, rd: Math.min(ratingParameters.initialRd, values.rd),
      ratedGames: player.ratedGames + 1, lastRatedAtMs: atMs };
    if (!isRatingState(state)) throw new RangeError('Glicko-2 produced an invalid account rating state.');
    return state;
  };
  return [update(firstPrior, secondPrior, firstScore), update(secondPrior, firstPrior, (1 - firstScore) as RatingScore)];
}
