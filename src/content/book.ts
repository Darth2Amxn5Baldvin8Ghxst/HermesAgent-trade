/**
 * HermesAgents — Sonic-Class Gold Strategy Book (Nov 9, 2026).
 * Verbatim text of the source document. Markup conventions understood by the book renderer:
 *  - {{v:key|text}}  engine-verifiable number; hover shows the live computation for `key`.
 *  - :::warning ... ::: red-bordered warning block.
 *  - ```rules ... ``` pseudo-rule block with Copy / Open in Backtest Studio actions.
 */
export interface BookSection {
  slug: string;
  number: number;
  title: string;
  summary: string;
  status: "IMPLEMENTED" | "REFERENCE";
  engineModule: string | null;
  body: string;
}

export const BOOK_META = {
  title: "HermesAgents — Sonic-Class Gold Strategy Book",
  dateLine: "Nov 9, 2026 · @Boudewijn, Balduin, Ghxst, Godwin, Amagi, Sir, Kurajo",
  abstract:
    "Copy Sonic's trading profile, not its product: short-horizon XAUUSD trades with tight, volatility-scaled stops and a hard drawdown floor, run as four independent agents built from the project books. Sonic's 12X/24X amplification and its published stats are not a target; the realistic goal under prop-firm limits is about 1–2% a month at single-digit drawdown, and that is still unproven until the validation gate below is passed.",
};

export const BOOK_SECTIONS: BookSection[] = [
  {
    slug: "sonic-decoded",
    number: 1,
    title: "Sonic, decoded",
    summary: "What Sonic's record implies, the Monte Carlo of tail gaps, and what not to copy.",
    status: "IMPLEMENTED",
    engineModule: "engine/montecarlo.ts",
    body: `Sonic's public record fits a tight-stop gold scalper that wins often and small: {{v:sonic.hitRate|83%}} of trades win, but the average win is only {{v:sonic.payoff|0.70×}} the average loss. The record is unaudited and partly from a "private" period, and it is sold through a venue under regulator warnings. Copy the trade shape; do not copy the leverage or treat the numbers as a benchmark.

| Metric | Sonic, as reported | What it implies (my calculation) |
|---|---|---|
| Instrument | XAUUSD only | Single liquid market, no diversification |
| Trades | 631 (Myfxbook snapshot, 10 Oct 2026); 603 with 500 winners earlier | About {{v:sonic.tradesPerMonth|27}} trades a month over about 23 months |
| Hit rate | 82.9% | High-win, low-payoff profile |
| Profit factor | {{v:sonic.profitFactor|3.39}} | Average win ≈ 0.072% of equity; average loss ≈ 0.103% |
| Average hold | 4 h 04 min | Intraday, session-scale trades |
| Return | +30.34% total, about 1.13% a month | ≈ {{v:sonic.expectancy|0.042%}} expectancy per trade |
| Max drawdown | 0.86%, on the underlying tracked account | Equals about {{v:sonic.ddInLosses|8}} average losses in a row |
| Fee | 30% of profits | Net to follower ≈ 0.8% a month at 1× |

**The record is too smooth to be a target.** If each trade were independent with fixed win and loss sizes, the stats imply a monthly mean of {{v:sonic.monthlyMean|1.15%}}, a monthly SD of {{v:sonic.monthlySd|0.34%}} and an annualised Sharpe of about {{v:sonic.sharpe|11.6}}. Stefanini's best-looking index (equity market neutral, 10.3% a year at 3.0% vol, 1994–2004) sits near a Sharpe of 2–3, and he treats profiles that smooth as a warning sign, not a goal (Stefanini, Ch16 and the split-strike section).

**631 trades cannot rule out rare gap losses.** A Monte Carlo of 20,000 runs of 631 trades with the implied win/loss sizes:

| Scenario | Median max drawdown | P(at least one losing month in 23) |
|---|---|---|
| No tail events (as published) | {{v:mc.NONE.median|0.40%}} | {{v:mc.NONE.pLose|2%}} |
| 1 trade in 300 gaps to 10× the average loss | {{v:mc.10X_1_IN_300.median|1.13%}} | {{v:mc.10X_1_IN_300.pLose|58%}} |
| 1 trade in 300 gaps to 25× the average loss | {{v:mc.25X_1_IN_300.median|2.69%}} | {{v:mc.25X_1_IN_300.pLose|88%}} |

The published 0.86% sits inside the no-tail case, so the record is internally consistent. But a gold gap through a stop roughly once in 300 trades would already break the "zero losing months" claim more often than not. Stefanini's luck arithmetic (8 of 10 positive years happens {{v:stefanini.luck|5.5%}} of the time by chance) and Aldridge's minimum-track-record rule both say the sample is short for the claim being made.

:::warning Do not copy
- **The 12X/24X amplification.** It multiplies every loss by 12 or 24. Sonic's own 0.86% drawdown becomes {{v:sonic.dd12x|10.3%}} of the deposit at 12X and {{v:sonic.dd24x|20.6%}} at 24X, which already breaches a 10% trailing-drawdown floor. Reaching 24% a month by leverage is not a strategy; it is the same strategy with 24× the ruin risk.
- **The record as proof.** About 10 of the 23 logged months are labelled "PRIVATE" testing. Myfxbook shows what the broker's server reports and does not prove routing or capital source. Other Sonic material quotes conflicting totals (about 28.8%, 93.0% and over 100%).
- **The venue risk, unexamined.** TAG Markets trades as T.M. Financials Ltd under a Mauritius FSC licence whose history is disputed. Austria's FMA (Feb 2026), Luxembourg's CSSF (Jun 2026) and Québec's AMF (Sep 2026) have issued authorisation warnings. Distribution runs through a 10-level affiliate plan paying up to about $8.50 per lot. If any HermesAgents account sits at TAG Markets, cap the capital there and spread accounts across brokers (Aldridge, Ch17: counterparty exposure = Σ exposure × probability of default).
:::

**Copy:** one liquid market at a time, holds of hours, many small trades, stops sized to volatility, a hit rate above 70% paired with a payoff near 0.7, and per-trade risk small enough that a losing month is rare. "No losing months" is a result of tiny per-trade risk, never a rule to enforce, because enforcing it means holding losers.`,
  },
  {
    slug: "book-at-a-glance",
    number: 2,
    title: "The book at a glance",
    summary: "Four agents, one shared gateway; G2 and G4 offset G1 and G3's negative skew.",
    status: "IMPLEMENTED",
    engineModule: "engine/agents/*",
    body: `Four agents, each one complete strategy built from several books, each on its own account behind one shared risk gateway. G1 is the Sonic-shaped agent; G2 and G4 have the opposite payoff shape and exist to offset G1's and G3's negative skew, which Stefanini shows is the defining risk of every high-hit-rate relative-value book.

| Agent | Market | Hold | Expected shape (hypothesis, unproven) | Edge source | Main book sources | Feasibility on MT5 CFDs | Build order |
|---|---|---|---|---|---|---|---|
| G2 Macro-release drift | XAUUSD; EURUSD, NAS100 later | 5 min–2 h | Hit 50–60%, payoff above 1.2, 3–8 trades a month | Prices absorb scheduled surprises over minutes to hours, not instantly | Aldridge Ch12; DeFusco Ch7 event study; Kissell Ch12 event days | MEDIUM | 1 |
| G1 Session-liquidity reversion | XAUUSD | 30 min–6 h | Hit 65–75%, payoff 0.7–1.0, 15–30 trades a month | Paid for supplying liquidity at levels where resting orders cluster, only in range regimes | Aldridge Ch6, Ch7, Ch10; Kissell Ch2, Ch11; Stefanini Ch6 | MEDIUM | 2 |
| G3 Gold/silver spread | XAUUSD vs XAGUSD | 4 h–5 days | Hit 60–70%, payoff near 1 | Temporary dislocation in a cointegrated pair | Aldridge Ch13; DeFusco Ch10; Stefanini Ch7, Ch15 | MEDIUM | 3 |
| G4 Vol-targeted trend sleeve | XAUUSD, NAS100, GBPJPY, BTCUSD, EURUSD | Days-weeks | Hit 35–45%, payoff above 2 | Trend premium; long volatility, positive in crises | Stefanini Ch13, Ch16; Aldridge Ch14 | HIGH | 4 |

Build order follows evidence quality and your existing plan (event-driven macro and stat-arb pairs are already planned prototypes). G2 goes first because its edge is the best documented in the corpus and it trades rarely, so it is cheap to run in shadow mode while G1 is researched.`,
  },
  {
    slug: "g1-session-liquidity-reversion",
    number: 3,
    title: "G1 — Gold session-liquidity reversion (the Sonic-shaped agent)",
    summary: "Fade clustered liquidity levels only when the variance ratio says the market ranges.",
    status: "IMPLEMENTED",
    engineModule: "engine/agents/g1.ts",
    body: `G1 buys and sells XAUUSD at levels where resting orders cluster, only when a statistical test says the market is ranging, and exits at a target smaller than its stop. That reproduces Sonic's shape: many trades, a high hit rate, holds of hours. Its edge is the weakest-evidenced of the four, so it ships only after it beats a random-entry baseline.

**Why it should pay.** Aldridge (Ch10) cites Kavajecz and Odders-White (2004): limit orders cluster at technical support and resistance, so those levels mark where liquidity sits, and Aldridge suggests that is why chart levels work in FX, which has no central order book. Supplying liquidity there in a range is paid by impatient takers. The other side wins on trend days, so G1 has a short-option payoff and must be gated by regime.

**Rules (levels are my operationalisation; the book gives the principle, not the levels):**

1. **Regime gate.** Compute the Lo-MacKinlay variance ratio VR(q) of M15 returns over the last 10 sessions (Aldridge Ch7). Trade only if VR(4) < 1 and the 50-bar H1 moving-average slope, divided by H1 volatility, is inside ±0.5. Otherwise the market is trending: G1 stands down and G4 owns it.
2. **Levels.** Prior-day high and low, the Asian-session (00:00–06:00 GMT) high and low, and the last confirmed H1 swing high and low. Merge levels within 0.25 × ATR(H1) into one zone.
3. **Entry.** A passive limit order 0.1 × ATR(H1) in front of the zone, fading the approach. It expires after 60 minutes unfilled, with no chase (Aldridge Ch6, Handa-Schwartz limit entry; Nevmyvaka limit-then-deadline, Ch18).
4. **Stop.** Beyond the zone by k × σ, where σ is an EWMA (λ = 0.94) or Garman-Klass estimate of H1 volatility (Aldridge Ch8; Kissell Ch11). Start k = 1.0.
5. **Target.** 0.8 × the stop distance, or the session midpoint, whichever is nearer. This fixes the payoff near Sonic's 0.7.
6. **Time stop.** Close at 6 hours or at 16:00 GMT, whichever comes first. Stefanini (Ch10) shows annualised edge collapses with holding time; a reversion that has not happened in a session is not the trade you entered.
7. **Session and news filter.** Entries only 07:00–16:00 GMT. None in the first 30 minutes after the 13:30 GMT US cash open (Kissell Ch2: spreads and volatility take 15–45 minutes to settle). None from 30 minutes before to 60 minutes after a tier-1 US release (G2 owns those windows).
8. **Cost gate.** Enter only if the target distance is at least 4× the round-trip cost (spread + commission + expected slippage), with spread modelled by hour from your own logs (Aldridge Ch19; Stefanini Ch2 transaction-cost barrier).
9. **Sizing.** Risk 0.25% of equity per trade at the stop, scaled down by the gateway's drawdown cushion (section 7). Sonic's implied average loss is about 0.10% of equity, so 0.25% is already more aggressive than the strategy being copied.
10. **Session brakes.** Three stop-outs in one session end G1 for the day. Spread above 2× its hourly median blocks new entries.

\`\`\`rules agent=G1
GATE   VR(q=4, M15, 10 sessions) < 1  AND  |slope(MA50_H1) / sigma_H1| < 0.5
LEVELS prior-day H/L, Asian 00:00-06:00 H/L, last H1 swing H/L; merge within 0.25*ATR_H1
ENTRY  LIMIT 0.1*ATR_H1 in front of zone, fade approach, expire 60 min, no chase
STOP   zone -/+ k*sigma_H1 (EWMA lambda=0.94), k=1.0
TARGET min(0.8*stop_distance, session midpoint)
EXIT   time stop 6h or 16:00 GMT
FILTER entries 07:00-16:00 GMT; not 13:30-14:00; not [release-30m, release+60m]
COST   target_distance >= 4 * round_trip_cost
SIZE   0.25% equity at stop * cushion factor
BRAKE  3 stop-outs per session -> done for day; spread > 2*hourly median -> no entry
\`\`\`

**Failure modes.** Trend days that blow through zones (the regime gate is the defence). Weekend and news gaps through the stop. Broker-side stop running: Aldridge (Ch3, Ch16) warns that dealers skew quotes and can widen spreads for persistently profitable clients, so log quoted versus filled prices per broker. Overfitting: accept only parameters that sit on a flat plateau of the grid (Kissell Ch10 sensitivity profiles), never a single peak.

| Parameter | Start | Test grid | Source |
|---|---|---|---|
| Variance-ratio lag q | 4 | 2, 4, 8 | Aldridge Ch7 |
| Stop multiple k | 1.0 σ | 0.75, 1.0, 1.25, 1.5 | Aldridge Ch8, Ch17 |
| Target / stop | 0.8 | 0.6, 0.8, 1.0 | Sonic shape |
| Order life | 60 min | 30, 60, 120 | Aldridge Ch6, Ch18 |
| Time stop | 6 h | 3, 6 h, session end | Stefanini Ch10 |
| Risk per trade | 0.25% | 0.10–0.50% | Gateway rule |`,
  },
  {
    slug: "g2-macro-release-drift",
    number: 4,
    title: "G2 — Gold macro-release drift",
    summary: "Trade the post-spike drift after US CPI and payrolls, sized from history.",
    status: "IMPLEMENTED",
    engineModule: "engine/agents/g2.ts",
    body: `G2 trades XAUUSD for up to an hour after US CPI and payrolls, in the direction that past surprises of the same sign moved gold, entering only after the first-minute spike. It is the best-documented edge in the corpus and the one your plan already names (event-driven macro), so it is built first.

**Why it should pay.** Aldridge (Ch12) collects evidence that prices adjust to scheduled news over minutes to hours, not instantly: futures adjust within a minute but volatility stays high for about 15 minutes (Ederington-Lee 1993); effects last up to 2 hours, and payroll momentum 12 hours or more (Almeida-Goodhart-Payne 1998). The first minute belongs to co-located firms. The drift after it is what a CFD account can reach.

**Rules:**

1. **Calendar.** US CPI and nonfarm payrolls at launch. FOMC is excluded until a separate study, because the statement and press conference are two events 30 minutes apart.
2. **Surprise.** s = (actual – consensus) / SD of past surprises for that release. Consensus must be timestamped before the release; a revised or after-the-fact consensus is look-ahead bias (DeFusco Ch6).
3. **Sign and size from history, not assumed.** For each release and each window (5, 15, 30, 60 minutes), fit R_window = α + β × s on past events and run Aldridge's sign test θ = (N*/N – 0.5) / √(0.25/N). Trade a release only where β is significant after a Bonferroni correction for the number of windows tested. Aldridge's own USD/CAD table skipped that correction; do not repeat it.
4. **Entry.** At release + 3 minutes, only if |s| ≥ 1 and the spread is back under 2× its normal median for that hour. Direction = sign(β × s). (The 3-minute delay and spread check are my additions to keep out of the co-located window.)
5. **Stop.** 1.5 × the median absolute 60-minute post-release move for that release, measured on past events.
6. **Exit.** At the window with the strongest out-of-sample β, capped at 60 minutes (Aldridge reports 30–60 minutes as typical), or at the stop.
7. **Sizing.** 0.25% of equity at risk per event, through the gateway. One position per event.

\`\`\`rules agent=G2
EVENTS  US CPI, US NFP (FOMC excluded)
SURPRISE s = (actual - consensus) / SD(past surprises); consensus_ts < release_ts else VOID
FIT     for w in {5,15,30,60}: R_w = a + b*s ; theta = (N+/N - 0.5)/sqrt(0.25/N)
GATE    trade w only if p(b) < 0.05/4 (Bonferroni)
ENTRY   release + 3 min, |s| >= 1, spread <= 2*hourly median; dir = sign(b*s)
STOP    1.5 * median(|60-min post-release move|)
EXIT    best OOS window, cap 60 min
SIZE    0.25% equity per event, one position per event
\`\`\`

**Inputs.** A release-time feed of actual and consensus values with timestamps; tick or M1 XAUUSD with bid and ask. Open question: which consensus source you will license. Scraping a calendar site raises terms-of-service risk.

**Constraints to check before building.** Many prop firms forbid opening or closing trades within a set number of minutes of tier-1 news. Confirm each firm's rule; G2 may be legal only on your own accounts.

**Statistical power is the real limit.** CPI and payrolls give about {{v:g2.eventsPerYear|24}} events a year, so 10 years is about 240. DeFusco's sample-size rule n = (t × s / E)² means a small per-event edge will not reach significance on that count. Treat G2 as a small, low-frequency sleeve, and use DeFusco's event-study method (abnormal return, z-test, positive/negative count) and an F-test of event-day versus normal-day variance before going live.`,
  },
  {
    slug: "g3-gold-silver-spread",
    number: 5,
    title: "G3 — Gold/silver spread reversion",
    summary: "Trade the cointegrated XAU/XAG residual at ±2σ while the Engle–Granger gate holds.",
    status: "IMPLEMENTED",
    engineModule: "engine/agents/g3.ts",
    body: `G3 trades the residual between gold and silver when it stretches two standard deviations, but only while a cointegration test says the pair is still tied together; the moment the test fails, it closes and stands down. It covers your planned stat-arb prototype and removes most of the outright gold direction that G1 and G2 carry.

**Why it should pay.** Temporary flow into one leg pushes a stable relation out of line and it relaxes back (Aldridge Ch13). Stefanini (Ch15) maps precious metals to the same monetary and haven factors, which is why a gold-silver tie is plausible. Plausible is not proven: whether XAUUSD and XAGUSD are cointegrated on your sample is decided by the test in rule 1, not assumed.

**Rules:**

1. **Gate (DeFusco Ch10, Engle-Granger).** Dickey-Fuller test on ln(XAU) and ln(XAG) daily closes over the last 500 days (Aldridge's preferred length). Both must have a unit root. Regress ln(XAU) on ln(XAG) for the hedge ratio b, then Dickey-Fuller test the residual with Engle-Granger critical values. Not cointegrated at 5% = no trading. Re-run weekly.
2. **Hidden-direction check (Stefanini Ch7).** Regress daily residual changes on the dollar index change. A material R² means the "spread" is a disguised dollar bet: reject the pair.
3. **Signal.** z = (residual − 20-day mean) / 20-day SD, updated on H1 closes with the weekly b.
4. **Entry.** |z| ≥ 2.0: sell the rich leg, buy the cheap leg, notional ratio set by b. Send both legs together; never leave one leg working alone (Kissell Ch15).
5. **Exit.** z back to ±0.5, before the mean, following Stefanini's enter-wide, exit-early band. Stop at |z| ≥ 3.5. Time stop at 5 trading days, because overnight swap is paid on both legs.
6. **Sizing.** 0.5% of equity at risk across both legs, measured at the z = 3.5 stop.

\`\`\`rules agent=G3
GATE   ADF(ln XAU), ADF(ln XAG) unit root over 500d; OLS ln XAU = a + b ln XAG;
       ADF(residual) < Engle-Granger 5% critical value; weekly
CHECK  R^2(d residual ~ d DXY) <= 0.25 else reject pair
SIGNAL z = (resid - mean20d) / sd20d on H1 closes
ENTRY  |z| >= 2.0: sell rich leg, buy cheap leg, ratio b, both legs atomically
EXIT   |z| <= 0.5 ; STOP |z| >= 3.5 ; TIME 5 trading days
SIZE   0.5% equity across both legs at z = 3.5
\`\`\`

**Inputs.** Daily and H1 bid/ask for both metals; both legs' swap rates at each broker.

**Failure modes.** Structural breaks: silver carries industrial demand gold does not, so the tie can break for months; the weekly gate is the defence. Swap on two legs can exceed the edge on slow reversions. DeFusco shows FX correlations shifting a lot between 2000–06 and 2007–13, so hedge ratios must be re-estimated, not fixed.

**If the gate fails on gold/silver,** run the same agent unchanged on the other pairs the books suggest: NAS100 vs US500, and AUDNZD (Stefanini Ch14). Do not use XAUUSD vs XAUEUR: that "spread" is just EURUSD (Aldridge).`,
  },
  {
    slug: "g4-vol-targeted-trend",
    number: 6,
    title: "G4 — Vol-targeted trend sleeve",
    summary: "Three moving-average horizons, equal-vol sizing, 6% annualised portfolio target.",
    status: "IMPLEMENTED",
    engineModule: "engine/agents/g4.ts",
    body: `G4 holds each market long or short according to three moving-average horizons, sized so every market contributes equal volatility, and targets about 6% annualised portfolio volatility. It loses more trades than it wins, and that is the point: it makes money in the trending and crisis months that hurt G1 and G3.

**Why it should pay.** Stefanini (Ch13) identifies trend behaviour across markets as managed futures' structural source of return. It is the only near-symmetric return stream in his data: 7.0% a year at 12.2% volatility, skew +0.03, worst drawdown −17.7% (1994–2004), correlation near zero or negative to every relative-value strategy, and positive in 70% of the 20 worst MSCI World months. That is evidence for the strategy class, not for these exact rules.

**Rules:**

1. **Universe.** XAUUSD, NAS100, GBPJPY, BTCUSD, EURUSD; add US500, GER40, USDJPY, XAGUSD and oil if the broker lists them. Stefanini's CTAs trade 100+ markets; 5–10 gives much weaker diversification, so expect deeper drawdowns than the index.
2. **Signal.** For each of 20, 50 and 180 days, +1 if the daily close is above its moving average and −1 if below (Stefanini's 15/50/180 MAs and 50/180 crossover). Signal = the average of the three, in {−1, −⅓, ⅓, 1}.
3. **Sizing.** Position = signal × (per-market volatility budget / EWMA forecast volatility, λ = 0.94). Set the budget so the portfolio forecast is 6% a year. Scaling Stefanini's index from 12.2% to 6% volatility scales its −17.7% drawdown to about {{v:g4.scaledDd|−8.7%}} (my arithmetic), inside a 10% floor before the gateway's further cut.
4. **Rebalance band.** Recompute daily, but trade only when the target differs from the current position by more than 25%. This is Kissell's re-optimise-only-outside-a-band rule (Ch13), and it cuts churn and swap.
5. **Exits.** A sign flip of the signal closes or reverses the position. A daily loss beyond 3 × forecast daily volatility on one market halves that position (Stefanini's gradual de-sizing of losers).

\`\`\`rules agent=G4
UNIVERSE XAUUSD, NAS100, GBPJPY, BTCUSD, EURUSD
SIGNAL   mean(sign(close - MA20), sign(close - MA50), sign(close - MA180)) in {-1,-1/3,1/3,1}
SIZE     signal * (vol_budget / EWMA_vol(lambda=0.94)), portfolio forecast 6%/yr
BAND     trade only if |target - current| > 25% of current
EXIT     sign flip closes/reverses; daily loss > 3*forecast daily vol halves position
\`\`\`

**Failure modes.** Sideways and low-volatility regimes produce whipsaw; Stefanini traces the 2004 drawdown to exactly that. Sharp reversals hit before the signal turns. Swap on multi-week CFD holds can be material, especially on BTCUSD and high-carry crosses, so include broker swap in every backtest.

**How it ties to G1.** G1's regime gate stands G1 down when the market trends; G4 is long or short in the same conditions. The overseer reads their correlation as the main diversification check.`,
  },
  {
    slug: "risk-gateway",
    number: 7,
    title: "Shared risk and execution gateway",
    summary: "Nine deterministic checks in fixed order; first failure rejects the order.",
    status: "IMPLEMENTED",
    engineModule: "engine/gateway.ts",
    body: `Every order from every agent passes the same deterministic checks, in this order, and any failure rejects the order. No language model can change these limits; only you can, in code, outside trading hours. Aldridge (Ch17) is explicit that losing managers escalate risk, so limits and breach procedures are written before the first trade.

1. **Drawdown floor (TIPP form of Aldridge's CPPI, Ch14).** Internal floor = high-water mark × 0.92, two points inside the prop firm's 10%. Cushion = equity – floor. The floor ratchets up with every new high-water mark and never down.
2. **Per-trade risk cap.** Risk at the stop ≤ min(the agent's request, 1.5% of equity, cushion / 8). At a fresh high the cushion is 8%, so the cap is {{v:gateway.capFresh|1.0%}}; after a 4% drawdown it is {{v:gateway.cap4dd|0.5%}}. Risk shrinks automatically as the floor nears.
3. **Total open risk.** The sum of risk at stops across open positions ≤ cushion / 3, so three simultaneous full stop-outs cannot breach the floor.
4. **Loss brakes.** Daily loss of 2% or weekly loss of 4% flattens the account and locks it until the next period.
5. **Order hygiene.** Every order carries a stop at submission. No adding to a losing position, no grid and no martingale: these are the mechanics that make high-hit-rate products look smooth until they fail. Symbol whitelist per agent. Size within broker and prop limits.
6. **Market checks.** Spread ≤ 2× its hourly median. No entries in news blackout windows except G2's own. No new risk in the 30 minutes before the weekend close.
7. **Execution.** Idempotent client order IDs so a retry cannot double a position. High-water mark, open positions and limits saved by atomic checkpoint (write to a temp file, sync, rename) so a restart cannot reset the floor (Rust for Scientific Computing, Ch14).
8. **Logging.** For every order: decision price, arrival mid, fill price, unfilled size and the price at the holding horizon. That is Kissell's implementation-shortfall split (Ch3): delay cost, execution cost and missed-fill cost per agent, and the first place broker-side slippage shows up.
9. **Kill switch.** One human-only switch flattens every account. Aldridge (Ch16) makes this the human's one live role.`,
  },
  {
    slug: "overseer",
    number: 8,
    title: "Overseer rules (DeepSeek)",
    summary:
      "Budget allocation that can cut risk on judgement but never raise it beyond the rules.",
    status: "IMPLEMENTED",
    engineModule: "engine/overseer.ts",
    body: `The overseer sets each agent's risk budget from measured performance and may cut risk on its own judgement, but it can never raise risk beyond what the deterministic rules below allow and never places orders. This asymmetry keeps a model error from turning into a loss larger than the gateway permits.

- **Report card per agent, weekly.** Stefanini's template (Ch1): return, volatility, % positive months, best/worst month, skew, kurtosis, max drawdown with duration and recovery, historical VaR. Plus Kissell's cost split from the gateway log.
- **Start equal, shrink toward equal.** Each live agent starts with an equal risk budget. Aldridge (Ch14) shows mean-variance weights are unstable beyond a handful of strategies; use shrinkage toward equal weights and an ambiguity penalty that down-weights agents with uncertain edge.
- **Probation by track-record length.** A new agent runs at 25% of its budget until its live Sharpe is significant for its sample length. Aldridge's Jobson–Korkie table: an annual Sharpe of 1 needs about {{v:overseer.jk1|32}} months of daily data; a Sharpe of 2 needs about {{v:overseer.jk2|8}}.
- **Cut fast, add slowly.** In DeFusco's European fund data, losers stayed losers 84.5% of the time and winners stayed winners 65.5%. Halve an agent's budget when its realised-versus-expected P&L z-score falls below −1; raise it by at most 25% when the z-score exceeds +1 after probation.
- **Act only outside a band.** Reallocate only when that z-score leaves ±1, never on a fixed clock, and do not reverse when it drifts back (Kissell Ch13 hysteresis). This stops churn.
- **Pay for skill, not for gold.** Regress each agent's returns on gold, the dollar index and NAS100 (DeFusco Ch11). Judge skill on the residual. An agent that only made money because gold rose is a gold beta, not an edge.
- **Cap shared exposure.** G1, G2 and G4 all trade gold. Gold may contribute at most 50% of total portfolio risk, measured with short-horizon covariance (slow correlations, fast EWMA volatilities; Kissell Ch15).
- **Penalise tails.** Rank agents on drawdown and skew, not volatility alone. Stefanini's indices show high-hit-rate books hide fat left tails that volatility does not see.
- **Every LLM decision is logged** with its inputs and stated reason, so you can audit what it saw and why it acted.`,
  },
  {
    slug: "validation-gate",
    number: 9,
    title: "Validation gate before real capital",
    summary: "Ten ordered steps; a failure sends the agent back to research.",
    status: "IMPLEMENTED",
    engineModule: "engine/validation.ts",
    body: `No agent trades real money until it passes all ten steps in order; a failure sends it back to research, not to a parameter tweak. The pass bar: out-of-sample Sharpe significant at 5% after costs, and a median max drawdown under 6% in the tail-injected Monte Carlo.

1. **Pre-register.** Write the hypothesis, rules, parameter grid and the number of variants you will try before running anything. Report every variant tried (DeFusco Ch6: test 100 useless rules and about {{v:validation.falsePositives|5}} look significant).
2. **Clean data.** Bid and ask from the broker you will trade, spreads varying by hour and volatility, real swap rates, last-quote sampling only. No interpolation between quotes and no revised macro data: both are look-ahead (Aldridge Ch9; DeFusco Ch6).
3. **One codebase.** The backtest and live bot run the same code; only the data source changes (Aldridge Ch16). Same-timestamp events ordered by (time, sequence id), random seeds logged (Rust book, Ch7).
4. **Out-of-sample.** At least 2 years held out and never touched during design (Aldridge Ch15), then walk-forward.
5. **Beat a random baseline.** Compare against random entries with the same stop, target and hold on the same bars, using a paired t-test (DeFusco Ch7). Aldridge's EUR/USD stop/target grid shows how much a stop/target rule earns from drift alone.
6. **Honest statistics.** Newey-West standard errors on any alpha (DeFusco Ch9: correcting them flipped a "significant" result). Joint F-test when an agent uses several conditional rules. Block bootstrap for confidence intervals on Sharpe and drawdown. Binomial test on the hit rate.
7. **Robustness.** Parameters must sit on a flat plateau of the grid (Kissell Ch10). Rerun at 2× spread. Inject a gap loss of 10× the average loss once every 300 trades, as in section 1.
8. **Simulation recovery.** Feed the pipeline synthetic prices with a known planted edge and confirm it recovers that edge with the right sign. Kissell (Ch18) shows short samples can return the wrong sign.
9. **Shadow live.** At least 3 months of paper trading on live prices with full cost logging. Test live versus backtest trade distributions with Mann-Whitney and Kolmogorov-Smirnov (Kissell Ch3).
10. **Probation.** Go live at 25% of budget under the overseer's probation rule (section 8).`,
  },
  {
    slug: "corpus-coverage",
    number: 10,
    title: "Corpus coverage",
    summary: "Which of the seven project books supplied what, and their limits.",
    status: "REFERENCE",
    engineModule: null,
    body: `Three books supply almost all the trading content (Aldridge, Stefanini, DeFusco), Kissell supplies execution and allocation, and three contribute little or nothing. All seven texts were extracted in full and covered line by line into line-referenced notes. For this document I re-checked the specific passages the rules rest on against the source text, and read Miller in full again.

| Book | What it contributed here | Used in | Limits |
|---|---|---|---|
| Aldridge, High-Frequency Trading (2010) | Support/resistance as liquidity, limit entry, variance-ratio test, event arbitrage, 2σ spread rules on 500 observations, CPPI floor, Jobson-Korkie, cost taxonomy | G1, G2, G3, gateway, overseer | Evidence mostly pre-2009; several formula errors; true HFT strategies infeasible on CFDs |
| Stefanini, Investment Strategies of Hedge Funds (2006) | Trend-following rules and statistics, cross-strategy skew and correlation evidence, conditional-drift test, enter-wide/exit-early bands, report card | G3, G4, overseer | 1994–2004 index data, survivorship-inflated by 2.5–3.5% a year by its own account; no backtested rules |
| DeFusco et al., Quantitative Investment Analysis 3e | Data-mining and look-ahead discipline, event study, Engle–Granger test, Newey–West, factor attribution, loser persistence | G2, G3, overseer, validation | Textbook; no strategies; samples end around 2013 |
| Kissell, Algorithmic Trading Methods 2e (EPUB) | Implementation-shortfall logging, band-based re-optimisation, short-horizon covariance, simulation-recovery test, session effects | G1, G4, gateway, overseer, validation | Built for institutional equity orders; many misprinted formulas; no alpha |
| Rosenbaum & Pearl, Investment Banking | Nothing used: merger mechanics only fit Polymarket deal markets, outside this plan | — | No trading content |
| Rust for Scientific Computing | Atomic checkpointing, deterministic event ordering, seeded randomness | Gateway, validation | No finance; about 25 code listings do not compile |
| Miller, Trading Smarter with AI | Only the drawdown-recovery arithmetic (−20% needs {{v:miller.recover20|+25%}}; −50% needs {{v:miller.recover50|+100%}}) | — | A 27-page Deriv affiliate pamphlet with no strategy |

The four other covers in your uploads (*Crossley's Rust for Algorithmic Trading Projects*, *Stallard's Build AI Trading Bots with Claude*, *Cartea-Jaimungal-Penalva's Algorithmic and High-Frequency Trading*, *Clark's The AI Trading Manager*) are images only; their text is not in the project. Cartea-Jaimungal-Penalva would add the most: rigorous treatments of execution, market making and statistical arbitrage.

### Sources

Web pages opened 9 Nov 2026 (third-party and promotional; none independently audited):

- SONIC AI official site: instrument, 24X example, 30% fee, performance log with "PRIVATE" months
- Sonic AI gold guide: Myfxbook snapshot of 10 Oct 2026 (631 trades, +30.34%, profit factor 3.39, 0.86% drawdown, 4 h 04 min average hold)
- TAG Markets Exposed (De Hek, Substack): 603 trades / 500 winners, drawdown liquidation limits, licence history, FMA/CSSF/AMF warnings
- Sonic AI investigation (Tapscape): affiliate per-lot payments and profit split

Books: the seven project texts listed in section 10, cited by chapter.

Calculations: implied win/loss sizes, Sharpe and the 20,000-run Monte Carlo were computed from the reported figures under the stated assumptions (independent trades, fixed win and loss sizes).`,
  },
];
