<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## HermesAgents architecture
- One deterministic engine in `src/engine/` (pure TS, Decimal.js money, seeded RNG) is shared by the live simulator, backtests, Monte Carlo and validation — so every surface computes identical numbers.
- Heavy runs (Monte Carlo, grids, validation evidence) go through the worker pool in `src/lib/hermes/workerClient.ts`; the live sim ticks on the main thread via the Zustand store — keeps the UI responsive.
- Per-operator data lives in Lovable Cloud tables with owner-scoped RLS; the strategy book text is local in `src/content/book.ts` — it is static reference content.
- Server functions live in `*.functions.ts` under `src/lib/`, never `src/server/` — that folder is blocked from client imports.
- Broker access goes only through the `BrokerAdapter` interface; Live stays an interface that throws until a backend exists — no UI changes needed to swap.
- Real market data comes only from keyless public APIs (Binance data API, Yahoo chart API) via `src/lib/hermes/marketdata.functions.ts`; real gold M1 bars enter the engine as the `historical` feed — one code path for synthetic and real backtests.

## Risk defaults
- `DEFAULT_LIMITS` in `src/engine/gateway.ts` are operator-tightened; the book's original §7 values live in `BOOK_LIMITS` for comparison — tests assert both so neither drifts silently.
- Validation pass marks live in `VALIDATION_BAR` in `src/engine/validation.ts`; step text and checks read the same constants so the screen never disagrees with the logic.
