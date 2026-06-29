# Scaling Capacity Check — CB Edge

Goal: scale cleanly without adding failure modes. Watch these signals, act in this order. Don't add a box until a cheaper step is exhausted.

## What to watch (current box)

| Signal | How to check | Healthy | Warning | Act now |
|---|---|---|---|---|
| CPU load | `htop` / `uptime` (1m load avg) | < 0.7 × vCPU | 0.7–1.0 × vCPU | sustained > 1.0 × vCPU |
| RAM | `free -h`, `htop` | > 25% free | 10–25% free | < 10% free or swapping |
| Swap activity | `vmstat 1` (si/so cols) | si/so ≈ 0 | occasional | continuous si/so > 0 |
| PG connections | `SELECT count(*) FROM pg_stat_activity;` | < 50% of max | 50–80% | > 80% of max, or pool churn |
| PG slow queries | `pg_stat_statements` mean_time | stable | creeping up | p95 > 100ms on hot paths |
| Outbound bandwidth | Render/Hetzner dashboard (NOT app logs) | flat per-client | rising w/o new users | GB/hr, climbing |
| WS clients | server-v2 connection count | — | — | broadcast cost scales w/ this |
| Event-loop lag | Node `perf_hooks` monitorEventLoopDelay | < 20ms | 20–100ms | > 100ms sustained |
| Disk | `df -h`, PG data dir | < 70% | 70–85% | > 85% |

Note: the bandwidth leak you hit logs **nothing** in app logs — only the provider's Outbound Bandwidth graph shows it. Watch that graph, not stdout.

## Escalation order

**Step 1 — Vertical scale (do first).**
Trigger: sustained CPU > 1.0 × vCPU OR RAM < 10% free / swapping, with no code-level leak to blame.
Action: bump the Hetzner box one tier. Zero architecture change, no new latency, no new failure mode. Exhaust this before anything horizontal.

**Step 2 — Fix fan-out, not ingest.**
Trigger: outbound bandwidth or event-loop lag rises **as users connect** (feeds are fixed cost; broadcast is not).
Action: this is your real scaling wall. Throttle WS frames, skip-if-unchanged, idle-pause / lifecycle gating. All code, no new box. You've already built most of this — verify it's active under load.

**Step 3 — Separate processes, same box.**
Trigger: one workload starves another (e.g. options writer spikes, Next.js stalls) but the box still has headroom overall.
Action: isolate into independent processes/containers with their own resource limits — options writer, ES writer, Next.js, PG. Isolation without cross-box basis-math latency.

**Step 4 — Move PG off-box.**
Trigger: DB I/O is the bottleneck (high PG connection count, pool churn, slow queries) while app CPU is fine.
Action: managed Postgres or a dedicated DB VPS. Better *first* horizontal split than splitting feeds — the DB is shared state and scales independently.

**Step 5 — Horizontal feeds (last).**
Trigger: a single box genuinely can't host both feeds + PG + Next.js after steps 1–4.
Action: same Hetzner datacenter, private vSwitch (sub-ms inter-box), and keep the **basis consumer co-located with options data** — pull candles/futures over the wire, never the reverse. Accept the new failure mode (one box down = half-rendered surfaces) only because you've run out of cheaper options.

## Load-test before adding infra

The biggest risks aren't capacity — they're failure modes already seen: the `/ws/gex` bandwidth leak, PG pool churn, WS auth/lifecycle edges. Before provisioning anything:

1. Simulate N concurrent WS clients (k6 / artillery / custom node) and watch outbound bandwidth + event-loop lag scale with N.
2. Kill PG mid-session, confirm pool recovers without uncaughtException.
3. Background/idle clients — confirm lifecycle gating actually pauses them.
4. Re-run after each change; the throttle only counts if it holds under load.

## One-line rule

Capacity is the easy problem and is mostly vertical. The thing that breaks first under real load is per-user fan-out, and it's fixed in code. Add a second VPS only after steps 1–4, and only in the same datacenter on a private vSwitch.
