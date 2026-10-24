# Coral

**AI onboarding concierge that turns Bitcoin curiosity into action.**

Every Bitcoin community has one exhausted person doing 1-on-1 hand-holding
for newcomers. Coral is that person, cloned, in WhatsApp, 24/7. It hands
off to a human when it should.

v0.1-beta prototype for the venture assessed at
[patoo.ai/ideas](https://patoo.ai/ideas). Framing: **a Flash activation
product first**, standalone SaaS later (if ever). The metric that matters is
cost per activated wallet vs. what acquisition otherwise costs.

## How it works

Onboarding is a **funnel state machine** with per-step scripts. Deterministic
code owns progression and verification; the LLM owns conversation *within*
a step.

```
new → greeted → wallet_setup → first_receive → first_spend → community → graduated
         │            │              │               │
         └── escalated (paused for a human, resumes where it left off)
         └── opted_out
```

| Step verified | How (zero credentials, no custody) |
| --- | --- |
| Wallet exists | LNURL-pay lookup on `username@flashapp.me` (live-tested ✓) |
| First receive | Meetup buddy zaps the newcomer; manual confirm (faucet interface ready, disabled) |
| First spend | Coral issues a small treasury invoice; LUD-21 `verify` polls settlement |
| Every message | Safety screen: seed-phrase topics always warn + escalate |

The design follows [hustle-link](../hustle-link)'s no-custody, no-API-keys
principle: every Flash username is a lightning address, and that is enough
surface to verify an onboarding.

## Try it

```bash
npm install && npm run build

# End-to-end demo: full funnel + escalation + verification, no network
npx tsx src/cli.ts sim

# Real check against Flash (zero-cred GET)
npx tsx src/cli.ts contact demo-user
npx tsx src/cli.ts greet demo-user
npx tsx src/cli.ts claim demo-user <flash-username>
npx tsx src/cli.ts verify-wallet demo-user

# Funnel numbers
npx tsx src/cli.ts metrics
```

`coral status <user>` returns the state **plus the step script**. That is
the contract with the agent runtime: look up where the user is, follow the
script, call the CLI to advance.

## Layout

| Path | What |
| --- | --- |
| `src/state-machine.ts` | Pure funnel transitions + guards |
| `src/store.ts` | Append-only JSONL event log; state derived by replay |
| `src/escalate.ts` | Safety/escalation policy (seed-phrase guard, frustration, stalls) |
| `src/verify.ts` | LNURL wallet checks + LUD-21 spend settlement |
| `src/faucet.ts` | Starter-sats interface (Noop in beta, see DEPLOYMENT.md) |
| `src/coral.ts` | Orchestrator + per-step agent guidance |
| `src/cli.ts` | Agent tool surface + operator commands + `sim` |
| `skill/SKILL.md` | NanoClaw persona: tone, guardrails, ops-group escalation |
| `DEPLOYMENT.md` | Pilot design, pass bars, kill criteria, open resource asks |

Run `npm test`. 29 tests cover transitions, policy, replay, verification,
and the full orchestrated funnel.
