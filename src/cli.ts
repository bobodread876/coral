#!/usr/bin/env node
import { Coral, getGuidance } from './coral.js';
import type { FetchLike } from './lnaddress.js';
import type { CoralState } from './types.js';

/**
 * Coral CLI — the tool surface the NanoClaw agent drives from inside the
 * container, and the operator's window into the funnel.
 *
 *   coral contact <user>                first contact (registers user)
 *   coral status <user>                 state + step guidance for the agent
 *   coral greet <user>                  record greeting delivered
 *   coral claim <user> <username>       record claimed Flash username
 *   coral verify-wallet <user>          LNURL lookup; advances or fails
 *   coral confirm-receive <user>        manual first-receive confirmation
 *   coral spend-invoice <user>          issue first-spend invoice (treasury)
 *   coral check-spend <user>            poll LUD-21 for settlement
 *   coral confirm-spend <user>          manual spend confirmation (ops policy)
 *   coral joined <user>                 record community join
 *   coral screen <user> <message...>    safety screen an inbound message
 *   coral escalate <user> <reason...>   pause for a human
 *   coral resume <user>                 human resolved; resume the funnel
 *   coral opt-out <user>                stop contact
 *   coral metrics                       funnel conversion table
 *   coral stalled                       users stuck past the stall window
 *   coral sim                           scripted end-to-end demo (no network)
 *
 * Env: CORAL_DATA (default ./coral-data/events.jsonl),
 *      CORAL_TREASURY (lightning address for first-spend invoices),
 *      CORAL_WALLET_DOMAIN (default flashapp.me),
 *      CORAL_SPEND_SATS (default 21)
 */

const args = process.argv.slice(2);
const cmd = args[0];

function coral(fetchFn?: FetchLike): Coral {
  return new Coral({
    dataPath: process.env.CORAL_DATA ?? './coral-data/events.jsonl',
    config: {
      treasuryAddress: process.env.CORAL_TREASURY,
      walletDomain: process.env.CORAL_WALLET_DOMAIN ?? 'flashapp.me',
      spendSats: process.env.CORAL_SPEND_SATS ? Number(process.env.CORAL_SPEND_SATS) : 21,
    },
    fetchFn,
  });
}

function out(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function userLine(u: { id: string; state: string; username?: string; enteredStateAt: string }) {
  return { id: u.id, state: u.state, username: u.username, since: u.enteredStateAt };
}

async function main(): Promise<void> {
  const c = coral();
  const user = args[1];

  switch (cmd) {
    case 'contact': {
      out(userLine(c.contact(req(user))));
      return;
    }
    case 'status': {
      const u = c.status(req(user)) ?? c.contact(req(user));
      out({ ...userLine(u), failedAttempts: u.failedAttempts, guidance: getGuidance(u.state) });
      return;
    }
    case 'greet': {
      out(userLine(c.greeted(req(user))));
      return;
    }
    case 'claim': {
      const username = req(args[2], 'username');
      out(userLine(c.claimWallet(req(user), username)));
      return;
    }
    case 'verify-wallet': {
      const result = await c.verifyWallet(req(user));
      out({ ok: result.ok, reason: result.reason, ...userLine(result.user) });
      return;
    }
    case 'confirm-receive': {
      out(userLine(c.confirmReceive(req(user), 'manual')));
      return;
    }
    case 'spend-invoice': {
      const { user: u, pr } = await c.startSpendCheck(req(user));
      out({ pr, sats: u.spendSats, verify: Boolean(u.spendVerifyUrl), ...userLine(u) });
      return;
    }
    case 'check-spend': {
      const { user: u, settled } = await c.pollSpend(req(user));
      out({ settled, ...userLine(u) });
      return;
    }
    case 'confirm-spend': {
      out(userLine(c.confirmSpendManual(req(user))));
      return;
    }
    case 'joined': {
      out(userLine(c.joinedCommunity(req(user))));
      return;
    }
    case 'screen': {
      const message = args.slice(2).join(' ');
      const result = c.screen(req(user), req(message, 'message'));
      out({ escalated: result.escalated, warn: result.warn, ...userLine(result.user) });
      return;
    }
    case 'escalate': {
      const reason = args.slice(2).join(' ') || 'operator request';
      out(userLine(c.escalate(req(user), reason)));
      return;
    }
    case 'resume': {
      out(userLine(c.resume(req(user))));
      return;
    }
    case 'opt-out': {
      out(userLine(c.optOut(req(user))));
      return;
    }
    case 'metrics': {
      out(c.metrics());
      return;
    }
    case 'stalled': {
      out(c.stalled().map(userLine));
      return;
    }
    case 'guidance': {
      out({ state: user, guidance: getGuidance(req(user) as CoralState) });
      return;
    }
    case 'sim': {
      await sim();
      return;
    }
    default:
      console.error(
        'Usage: coral <contact|status|greet|claim|verify-wallet|confirm-receive|' +
          'spend-invoice|check-spend|confirm-spend|joined|screen|escalate|resume|' +
          'opt-out|metrics|stalled|guidance|sim> ...',
      );
      process.exit(1);
  }
}

function req(value: string | undefined, what = 'user id'): string {
  if (!value) {
    console.error(`Missing ${what}`);
    process.exit(1);
  }
  return value;
}

/**
 * Scripted end-to-end onboarding with a fake LNURL server — proves the full
 * funnel (including verification wiring) with zero network and zero sats.
 */
async function sim(): Promise<void> {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  let settledAfterPolls = 2;
  const fakeFetch: FetchLike = async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => {
      if (url.includes('.well-known/lnurlp/')) {
        return {
          tag: 'payRequest',
          callback: 'https://sim.local/cb',
          minSendable: 1000,
          maxSendable: 100000000,
          commentAllowed: 64,
          metadata: '[]',
        };
      }
      if (url.startsWith('https://sim.local/cb')) {
        return { pr: 'lnbc210n1SIMULATED', verify: 'https://sim.local/verify/abc' };
      }
      if (url.includes('/verify/')) {
        settledAfterPolls -= 1;
        return { settled: settledAfterPolls <= 0, preimage: null };
      }
      return { status: 'ERROR', reason: `sim has no route for ${url}` };
    },
  });

  const dataPath = join(mkdtempSync(join(tmpdir(), 'coral-sim-')), 'events.jsonl');
  const c = new Coral({
    dataPath,
    config: { treasuryAddress: 'treasury@sim.local' },
    fetchFn: fakeFetch,
  });

  const id = 'sim-newcomer';
  const step = (label: string, state: string) =>
    console.log(`  ${label.padEnd(42)} -> ${state}`);

  console.log('Coral onboarding simulation (no network, no sats)\n');
  step('first contact', c.contact(id).state);
  step('greeting + anti-scam pledge delivered', c.greeted(id).state);

  const screened = c.screen(id, 'someone asked me for my seed phrase??');
  console.log(`\n  [safety screen] escalated=${screened.escalated}`);
  console.log(`  [warning sent]  ${screened.warn?.slice(0, 60)}...`);
  step('human resolves, resumes funnel', c.resume(id).state);

  step('claims Flash username "andre_2026"', c.claimWallet(id, 'andre_2026').state);
  const verified = await c.verifyWallet(id);
  step(`wallet verified (${verified.user.lnAddress})`, verified.user.state);
  step('buddy zaps first sats, confirmed', c.confirmReceive(id, 'manual').state);

  const { pr } = await c.startSpendCheck(id);
  console.log(`\n  [first-spend invoice] ${pr}`);
  let poll = await c.pollSpend(id);
  console.log(`  [poll 1] settled=${poll.settled}`);
  poll = await c.pollSpend(id);
  console.log(`  [poll 2] settled=${poll.settled}`);
  step('spend verified via LUD-21', poll.user.state);

  step('joined the community group', c.joinedCommunity(id).state);

  console.log('\nFunnel metrics:');
  out(c.metrics());
  console.log(`\nEvent log: ${dataPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
