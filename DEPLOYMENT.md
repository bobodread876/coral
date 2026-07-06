# Deployment: the Coral pilot

Coral's library is transport-agnostic. The intended runtime is
[NanoClaw](https://github.com/qwibitai/nanoclaw) over Baileys (WhatsApp Web
protocol) — same rationale as hustle-link's DEPLOYMENT.md: no Meta business
verification, group support, sits in chat like a person. Same risk too:
unofficial protocol, ban possible. **Pilot on a dedicated burner number.**

Coral gets its **own number**, separate from Hustle Link — different trust
postures (newcomer-facing concierge vs. vendor order desk). Shared infra,
separate identities.

## Wiring

1. NanoClaw instance with the WhatsApp channel, paired to the Coral number.
2. Clone this repo into the container mount; `npm install && npm run build`.
3. Install `skill/SKILL.md` as the skill for the Coral context; it drives
   `src/cli.ts` for state, verification, and metrics.
4. Register an **ops group** (community volunteers). Escalations are posted
   there with the user's step, history, and reason.
5. Env: `CORAL_DATA` (event log path — mount it on persistent storage),
   `CORAL_TREASURY` (see below), `CORAL_SPEND_SATS` (default 21).

## The treasury address (first-spend verification)

First-spend is proven by the newcomer paying a small invoice issued against
`CORAL_TREASURY`. Settlement is polled via LUD-21 `verify` — which **Flash
does not expose yet**, so for the pilot the treasury address must live on a
LUD-21-capable provider (Alby and coinos both qualify). Sats accumulating
there are community funds; sweep them to the community Flash wallet
periodically.

**Strategic note for Flash:** shipping LUD-21 on `flashapp.me` would make
both Coral's spend verification and Hustle Link's payment confirmation fully
credential-free on Flash rails. Small server change, two ventures unblocked.

## Starter sats (first-receive)

Disabled in v0.1-beta (`NoopFaucet`). The pilot's first-receive moment is a
human — the meetup buddy zaps the newcomer a few hundred sats, and Coral
confirms manually after the newcomer describes the received payment. This is
deliberate: the faucet is the abuse surface (SIM farms), and the pilot's
referral-gated cohort doesn't need it automated. Automating it is a budget +
credential decision (see asks below).

## Safety posture

- Coral never asks for seed phrases, private keys, money, or documents — and
  says so in the greeting. The seed-phrase guard warns + escalates on every
  message that touches the topic, unconditionally.
- Referral-gated intake for the pilot: QR at meetups, vendor stickers, warm
  intros. No cold inbound.
- Every action is answerable: the JSONL event log is append-only; "why did
  Coral do X" always has a logged answer.

## Pilot design (one Island Bitcoin cycle, ~4 weeks)

Cohort: next Island Bitcoin Jamaica meetup + referrals. Target 30 newcomers.

**Pass bars** (defined before launch, per pipeline discipline):

| Metric | Pass |
| --- | --- |
| Reach `first_receive` (wallet verified) | ≥ 50% of contacts |
| Reach `first_spend` verified | ≥ 25% of contacts |
| Escalation rate | < 30% of contacts |
| Scam-report incidents | 0 |
| Cost per onboarded user (LLM + ops time) | < ~$3 |

**Kill criteria:** escalation rate stays > 50% after prompt iteration; the
number gets banned despite the burner posture; funnel completion worse than
human-only onboarding. Park it, keep the learnings for Hustle Link.

**Instrumentation:** `coral metrics` (funnel conversion), `coral stalled`
(re-engagement queue), the event log for time-in-step analysis.

## Open resource asks (approvals needed before go-live)

1. **Dedicated WhatsApp number** (burner SIM) for the Coral identity.
2. **Treasury address** on a LUD-21 provider (Alby/coinos — free) + whose
   account it is.
3. **Faucet decision**: keep manual for the pilot (recommended), or approve
   a funded sender (Flash API grant / NWC / LNbits) + budget (~10k sats per
   100 users at 100 sats each).
4. **Ops volunteers**: 2–3 community members in the escalation group with a
   response-time expectation (< 2h daytime).
5. **Go-live**: which meetup date anchors the cohort; patoo pipeline status
   flip idea → building.
