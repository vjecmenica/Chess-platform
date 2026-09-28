export type ReadinessResponse =
  | { status: 'ok'; database: 'connected' }
  | { status: 'error'; database: 'unavailable' };
