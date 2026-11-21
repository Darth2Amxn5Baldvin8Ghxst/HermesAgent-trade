import { createFileRoute } from "@tanstack/react-router";

/**
 * Signal feed for the HermesSignals Expert Advisor running in the operator's MetaTrader 5.
 * Auth: the operator's private feed token (only its SHA-256 hash is stored). Plain-text lines so
 * MQL5 can parse them without a JSON library:
 *   OPEN;key;symbol;side;type;limitOffset;stopDist;targetDist;riskPct;expiresUnix
 *   CLOSE;key
 */
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/mt5/signals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        if (token.length < 32) return new Response("ERR;unauthorized\n", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const hash = await sha256(token);
        const { data: s } = await supabaseAdmin
          .from("operator_settings")
          .select("owner_id, kill_armed")
          .eq("mt5_token_hash", hash)
          .maybeSingle();
        if (!s) return new Response("ERR;unauthorized\n", { status: 401 });
        const lines: string[] = [`OK;${Math.floor(Date.now() / 1000)}`];
        if (s.kill_armed) {
          lines.push("KILL");
          return new Response(lines.join("\n") + "\n", { headers: { "cache-control": "no-store" } });
        }
        const since = new Date(Date.now() - 15 * 60_000).toISOString();
        const [orders, accounts, trades] = await Promise.all([
          supabaseAdmin
            .from("orders")
            .select("client_order_id, account_id, symbol, side, type, qty, limit_px, stop_px, target_px, decision_px, expires_at, state")
            .eq("owner_id", s.owner_id)
            .in("state", ["ACCEPTED", "FILLED"])
            .gte("updated_at", since)
            .limit(200),
          supabaseAdmin.from("accounts").select("id, equity").eq("owner_id", s.owner_id),
          supabaseAdmin
            .from("trades")
            .select("client_order_id")
            .eq("owner_id", s.owner_id)
            .gte("created_at", since)
            .limit(500),
        ]);
        const eq = new Map((accounts.data ?? []).map((a) => [a.id, Number(a.equity)]));
        const closed = new Set((trades.data ?? []).map((t) => t.client_order_id));
        for (const o of orders.data ?? []) {
          if (closed.has(o.client_order_id) || o.stop_px == null) continue;
          const ref = Number(o.limit_px ?? o.decision_px);
          const stopDist = Math.abs(ref - Number(o.stop_px));
          const targetDist = o.target_px == null ? 0 : Math.abs(Number(o.target_px) - ref);
          const equity = eq.get(o.account_id) ?? 0;
          const riskPct = equity > 0 ? (Number(o.qty) * stopDist * 100) / equity : 0;
          const limitOffset = o.type === "LIMIT" && o.state === "ACCEPTED" ? Number(o.limit_px) - Number(o.decision_px) : 0;
          const type = o.type === "LIMIT" && o.state === "ACCEPTED" ? "LIMIT" : "MARKET";
          const exp = o.expires_at ? Math.floor(new Date(o.expires_at).getTime() / 1000) : 0;
          lines.push(
            ["OPEN", o.client_order_id, o.symbol, o.side, type, limitOffset.toFixed(2), stopDist.toFixed(2), targetDist.toFixed(2), riskPct.toFixed(4), exp].join(";"),
          );
        }
        for (const k of closed) lines.push(`CLOSE;${k}`);
        return new Response(lines.join("\n") + "\n", {
          headers: { "content-type": "text/plain", "cache-control": "no-store" },
        });
      },
    },
  },
});
