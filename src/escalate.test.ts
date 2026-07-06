import { describe, expect, it } from 'vitest';

import { assessMessage, isStalled, SEED_WARNING, shouldEscalateOnFailure } from './escalate.js';
import { newUser } from './state-machine.js';
import { DEFAULT_CONFIG } from './types.js';

const T = '2026-07-06T12:00:00.000Z';

describe('escalation policy', () => {
  it('always escalates + warns on seed phrase topics', () => {
    const user = newUser('u1', T);
    for (const text of [
      'the app is asking for my seed phrase?',
      'someone on whatsapp want mi recovery words',
      'should I send my private key to support',
      'him ask fi di 12 words dem',
    ]) {
      const result = assessMessage(text, user);
      expect(result.escalate, text).toBe(true);
      expect(result.warn, text).toBe(SEED_WARNING);
    }
  });

  it('escalates money disputes and human requests', () => {
    const user = newUser('u1', T);
    expect(assessMessage('mi sats gone missing from the wallet', user).escalate).toBe(true);
    expect(assessMessage('I never got the payment you said', user).escalate).toBe(true);
    expect(assessMessage('can I talk to a real person please', user).escalate).toBe(true);
    expect(assessMessage('is this a bot?', user).escalate).toBe(true);
  });

  it('escalates frustration only after a failed attempt', () => {
    const fresh = newUser('u1', T);
    expect(assessMessage("this doesn't work", fresh).escalate).toBe(false);

    const struggling = { ...fresh, failedAttempts: 2 };
    expect(assessMessage("this doesn't work", struggling).escalate).toBe(true);
    expect(assessMessage('mi cyaan get it fi work', struggling).escalate).toBe(true);
  });

  it('leaves normal onboarding chatter alone', () => {
    const user = newUser('u1', T);
    for (const text of [
      'ok downloading the app now',
      'mi username is andre_2026',
      'wha di next step?',
      'received! 500 sats reach mi wallet',
    ]) {
      expect(assessMessage(text, user).escalate, text).toBe(false);
    }
  });

  it('auto-escalates after max failed attempts', () => {
    const user = { ...newUser('u1', T), failedAttempts: 3 };
    expect(shouldEscalateOnFailure(user, DEFAULT_CONFIG)).toBe(true);
    expect(shouldEscalateOnFailure({ ...user, failedAttempts: 2 }, DEFAULT_CONFIG)).toBe(false);
  });

  it('flags stalled users but never terminal/escalated ones', () => {
    const old = new Date('2026-07-01T00:00:00.000Z').toISOString();
    const now = new Date('2026-07-06T00:00:00.000Z');
    const stuck = { ...newUser('u1', old), state: 'wallet_setup' as const, enteredStateAt: old };
    expect(isStalled(stuck, DEFAULT_CONFIG, now)).toBe(true);
    expect(isStalled({ ...stuck, state: 'graduated' }, DEFAULT_CONFIG, now)).toBe(false);
    expect(isStalled({ ...stuck, state: 'escalated' }, DEFAULT_CONFIG, now)).toBe(false);
    expect(isStalled({ ...stuck, enteredStateAt: now.toISOString() }, DEFAULT_CONFIG, now)).toBe(
      false,
    );
  });
});
