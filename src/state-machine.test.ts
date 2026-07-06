import { describe, expect, it } from 'vitest';

import { CoralTransitionError, newUser, transition } from './state-machine.js';
import type { CoralEvent, CoralUser } from './types.js';

const T = '2026-07-06T12:00:00.000Z';

function drive(user: CoralUser, events: CoralEvent[]): CoralUser {
  return events.reduce((u, e) => transition(u, e, T).user, user);
}

describe('coral state machine', () => {
  it('walks the full happy path to graduated', () => {
    const user = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'WALLET_CLAIMED', username: 'andre' },
      { type: 'WALLET_VERIFIED', lnAddress: 'andre@flashapp.me' },
      { type: 'RECEIVE_CONFIRMED', source: 'manual' },
      { type: 'SPEND_INVOICE_ISSUED', pr: 'lnbc1', verifyUrl: 'https://v', sats: 21 },
      { type: 'SPEND_VERIFIED', source: 'lud21' },
      { type: 'COMMUNITY_JOINED' },
    ]);
    expect(user.state).toBe('graduated');
    expect(user.lnAddress).toBe('andre@flashapp.me');
    expect(user.receiveSource).toBe('manual');
    expect(user.spendSource).toBe('lud21');
  });

  it('rejects skipping steps', () => {
    const user = newUser('u1', T);
    expect(() =>
      transition(user, { type: 'RECEIVE_CONFIRMED', source: 'manual' }, T),
    ).toThrow(CoralTransitionError);
    expect(() => transition(user, { type: 'COMMUNITY_JOINED' }, T)).toThrow(
      CoralTransitionError,
    );
  });

  it('allows correcting a mistyped username without leaving wallet_setup', () => {
    const user = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'WALLET_CLAIMED', username: 'andrre' },
      { type: 'WALLET_CLAIMED', username: 'andre' },
    ]);
    expect(user.state).toBe('wallet_setup');
    expect(user.username).toBe('andre');
  });

  it('counts verification failures and resets on success', () => {
    let user = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'WALLET_CLAIMED', username: 'x' },
      { type: 'VERIFY_FAILED', step: 'wallet' },
      { type: 'VERIFY_FAILED', step: 'wallet' },
    ]);
    expect(user.failedAttempts).toBe(2);
    user = transition(user, { type: 'WALLET_VERIFIED', lnAddress: 'x@flashapp.me' }, T).user;
    expect(user.failedAttempts).toBe(0);
    expect(user.state).toBe('first_receive');
  });

  it('escalates from any active state and resumes to where it left off', () => {
    let user = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'WALLET_CLAIMED', username: 'andre' },
      { type: 'WALLET_VERIFIED', lnAddress: 'andre@flashapp.me' },
      { type: 'ESCALATED', reason: 'asked for human' },
    ]);
    expect(user.state).toBe('escalated');
    expect(user.resumeState).toBe('first_receive');
    expect(user.escalations).toBe(1);

    user = transition(user, { type: 'RESUMED' }, T).user;
    expect(user.state).toBe('first_receive');
    expect(user.resumeState).toBeUndefined();
  });

  it('cannot double-escalate or escalate terminal states', () => {
    const escalated = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'ESCALATED', reason: 'x' },
    ]);
    expect(() => transition(escalated, { type: 'ESCALATED', reason: 'y' }, T)).toThrow(
      CoralTransitionError,
    );

    const out = drive(newUser('u2', T), [{ type: 'OPTED_OUT' }]);
    expect(() => transition(out, { type: 'ESCALATED', reason: 'z' }, T)).toThrow(
      CoralTransitionError,
    );
    expect(() => transition(out, { type: 'OPTED_OUT' }, T)).toThrow(CoralTransitionError);
  });

  it('opt-out works from every active state', () => {
    const user = drive(newUser('u1', T), [
      { type: 'GREET_SENT' },
      { type: 'WALLET_CLAIMED', username: 'a' },
      { type: 'OPTED_OUT' },
    ]);
    expect(user.state).toBe('opted_out');
  });

  it('records funnel records with from/to on every transition', () => {
    const { record } = transition(newUser('u1', T), { type: 'GREET_SENT' }, T);
    expect(record).toEqual({
      at: T,
      userId: 'u1',
      event: { type: 'GREET_SENT' },
      from: 'new',
      to: 'greeted',
    });
  });
});
