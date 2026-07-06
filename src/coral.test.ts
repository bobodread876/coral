import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { Coral } from './coral.js';
import type { FetchLike } from './lnaddress.js';

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'coral-e2e-')), 'events.jsonl');
}

function simFetch(opts: { walletExists?: boolean; settleAfterPolls?: number } = {}): FetchLike {
  const { walletExists = true } = opts;
  let polls = opts.settleAfterPolls ?? 1;
  return async (url: string) => {
    if (url.includes('.well-known/lnurlp/')) {
      if (!walletExists && url.includes('lnurlp/ghost')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag: 'payRequest',
          callback: 'https://sim.local/cb',
          minSendable: 1000,
          maxSendable: 100000000,
          metadata: '[]',
        }),
      };
    }
    if (url.startsWith('https://sim.local/cb')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ pr: 'lnbc21n1sim', verify: 'https://sim.local/v/1' }),
      };
    }
    if (url.includes('/v/')) {
      polls -= 1;
      return { ok: true, status: 200, json: async () => ({ settled: polls <= 0 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('Coral orchestrator end-to-end', () => {
  it('runs the full onboarding funnel with verification', async () => {
    const c = new Coral({
      dataPath: tempPath(),
      config: { treasuryAddress: 'treasury@sim.local' },
      fetchFn: simFetch({ settleAfterPolls: 2 }),
    });

    c.contact('andre-jid');
    c.greeted('andre-jid');
    c.claimWallet('andre-jid', 'andre_2026');

    const verified = await c.verifyWallet('andre-jid');
    expect(verified.ok).toBe(true);
    expect(verified.user.lnAddress).toBe('andre_2026@flashapp.me');
    expect(verified.user.state).toBe('first_receive');

    c.confirmReceive('andre-jid', 'manual');

    const { pr } = await c.startSpendCheck('andre-jid');
    expect(pr).toBe('lnbc21n1sim');

    expect((await c.pollSpend('andre-jid')).settled).toBe(false);
    const second = await c.pollSpend('andre-jid');
    expect(second.settled).toBe(true);
    expect(second.user.state).toBe('community');

    const done = c.joinedCommunity('andre-jid');
    expect(done.state).toBe('graduated');

    const m = c.metrics();
    expect(m.total).toBe(1);
    expect(m.reached['graduated']).toBe(1);
    expect(m.conversionPct['graduated']).toBe(100);
  });

  it('auto-escalates after repeated wallet verification failures', async () => {
    const c = new Coral({
      dataPath: tempPath(),
      config: { maxFailedAttempts: 3 },
      fetchFn: simFetch({ walletExists: false }),
    });
    c.contact('u');
    c.greeted('u');
    c.claimWallet('u', 'ghost');

    await c.verifyWallet('u');
    await c.verifyWallet('u');
    const third = await c.verifyWallet('u');
    expect(third.ok).toBe(false);
    expect(third.user.state).toBe('escalated');
    expect(third.user.resumeState).toBe('wallet_setup');
  });

  it('screens messages: seed phrase escalates with warning, chatter does not', () => {
    const c = new Coral({ dataPath: tempPath() });
    c.contact('u');
    c.greeted('u');

    const fine = c.screen('u', 'ok mi download di app');
    expect(fine.escalated).toBe(false);

    const danger = c.screen('u', 'support ask fi mi seed phrase');
    expect(danger.escalated).toBe(true);
    expect(danger.warn).toMatch(/never share your seed phrase/i);
    expect(danger.user.state).toBe('escalated');

    // While escalated, further screening does not double-escalate.
    const again = c.screen('u', 'hello? anyone there');
    expect(again.escalated).toBe(false);
  });

  it('falls back to manual spend confirmation without a treasury', async () => {
    const c = new Coral({ dataPath: tempPath(), fetchFn: simFetch() });
    c.contact('u');
    c.greeted('u');
    c.claimWallet('u', 'andre');
    await c.verifyWallet('u');
    c.confirmReceive('u');

    await expect(c.startSpendCheck('u')).rejects.toThrow(/treasuryAddress/);
    const confirmed = c.confirmSpendManual('u');
    expect(confirmed.state).toBe('community');
    expect(confirmed.spendSource).toBe('manual');
  });

  it('metrics report funnel drop-off correctly', () => {
    const c = new Coral({ dataPath: tempPath() });
    for (const id of ['a', 'b', 'c']) {
      c.contact(id);
      c.greeted(id);
    }
    c.claimWallet('a', 'a1');
    c.optOut('b');

    const m = c.metrics();
    expect(m.total).toBe(3);
    expect(m.reached['greeted']).toBe(3);
    expect(m.reached['wallet_setup']).toBe(1);
    expect(m.optedOut).toBe(1);
    expect(m.conversionPct['greeted']).toBe(100);
  });
});
