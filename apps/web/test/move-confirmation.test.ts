import { describe, expect, it } from 'vitest';
import { confirmMoveWithRetry } from '../src/move-confirmation';

describe('move confirmation retries', () => {
  it('repeats an unconfirmed move with the same request ID until the server confirms it', async () => {
    const requestId = 'one-move';
    const sent: string[] = [];
    let notices = 0;
    const result = await confirmMoveWithRetry(async () => {
      sent.push(requestId);
      if (sent.length < 3) throw new Error('receipt_pending');
      return { accepted: true };
    }, error => error instanceof Error && error.message === 'receipt_pending',
    () => { notices += 1; }, async () => {});
    expect(result).toEqual({ accepted: true });
    expect(sent).toEqual([requestId, requestId, requestId]);
    expect(notices).toBe(2);
  });

  it('does not retry a rejected move and leaves persistent uncertainty for manual recovery', async () => {
    let attempts = 0;
    await expect(confirmMoveWithRetry(async () => {
      attempts += 1;
      throw new Error('illegal_move');
    }, error => error instanceof Error && error.message === 'receipt_pending',
    () => {}, async () => {})).rejects.toThrow('illegal_move');
    expect(attempts).toBe(1);

    attempts = 0;
    await expect(confirmMoveWithRetry(async () => {
      attempts += 1;
      throw new Error('receipt_pending');
    }, () => true, () => {}, async () => {})).rejects.toThrow('receipt_pending');
    expect(attempts).toBe(5);
  });
});
