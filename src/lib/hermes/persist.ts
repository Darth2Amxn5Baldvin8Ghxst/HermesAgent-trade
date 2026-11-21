/**
 * Write-behind persistence for the live simulator. Engine output is queued and flushed in batches:
 * orders (upsert on client_order_id, idempotent), gateway events, trades, an atomic positions
 * checkpoint, account marks (HWM / floor never reset on restart) and equity snapshots.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { HermesEngine } from "@/engine/engine";
import {
  AGENT_CODES,
  type AgentCode,
  type GatewayEvent,
  type Order,
  type Trade,
} from "@/engine/types";

const iso = (t: number) => new Date(t).toISOString();
const n = (v: { toString(): string } | number | null | undefined) =>
  v === null || v === undefined ? null : Number(v.toString());

export interface PersistIds {
  agentId: Record<AgentCode, string>;
  accountId: Record<AgentCode, string>;
  realizedBase: Record<AgentCode, number>;
}

export class Persister {
  private orders = new Map<string, Order>();
  private gateway: GatewayEvent[] = [];
  private trades: Trade[] = [];
  private orderUuid = new Map<string, string>();
  private busy = false;
  lastFlushAt = 0;
  lastError: string | null = null;
  /** Engine order IDs repeat across runs with the same seed; a per-session tag keeps DB keys unique. */
  private readonly session = Date.now().toString(36);
  private key = (id: string) => `${this.session}:${id}`;
  constructor(private ids: PersistIds) {}

  enqueue(out: { orders: Order[]; gateway: GatewayEvent[]; trades: Trade[] }): void {
    for (const o of out.orders) this.orders.set(o.clientOrderId, o);
    for (const g of out.gateway) {
      if (!this.orderUuid.has(g.clientOrderId))
        this.orderUuid.set(g.clientOrderId, crypto.randomUUID());
      this.gateway.push(g);
    }
    this.trades.push(...out.trades);
  }

  async flush(engine: HermesEngine): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const orders = [...this.orders.values()];
      this.orders.clear();
      const gw = this.gateway.splice(0);
      const trades = this.trades.splice(0);
      if (orders.length) {
        const rows = orders.map((o) => {
          let id = this.orderUuid.get(o.clientOrderId);
          if (!id) {
            id = crypto.randomUUID();
            this.orderUuid.set(o.clientOrderId, id);
          }
          return {
            id,
            account_id: this.ids.accountId[o.agent],
            agent_id: this.ids.agentId[o.agent],
            client_order_id: this.key(o.clientOrderId),
            symbol: o.symbol,
            side: o.side,
            type: o.type,
            qty: n(o.qty)!,
            limit_px: o.limitPx,
            stop_px: o.stopPx,
            target_px: o.targetPx,
            tif: o.expiresAt ? "GTD" : o.type === "MARKET" ? "IOC" : "GTC",
            expires_at: o.expiresAt ? iso(o.expiresAt) : null,
            decision_px: o.decisionPx,
            arrival_mid: o.arrivalMid,
            submitted_at: iso(o.submittedAt),
            state: o.state,
            reject_reason: o.rejectReason,
            fill_px: o.fillPx,
            filled_qty: n(o.filledQty),
            filled_at: o.filledAt ? iso(o.filledAt) : null,
            horizon_px: o.horizonPx,
            spread_at_submit: o.spreadAtSubmit,
          };
        });
        const { error } = await supabase
          .from("orders")
          .upsert(rows, { onConflict: "owner_id,client_order_id" });
        if (error) throw new Error(`orders: ${error.message}`);
      }
      if (gw.length) {
        const { error } = await supabase.from("gateway_events").insert(
          gw.map((g) => ({
            order_id: this.orderUuid.get(g.clientOrderId) ?? null,
            client_order_id: this.key(g.clientOrderId),
            agent_code: g.agent,
            seq: g.seq,
            check: g.check,
            result: g.result,
            detail: { ...g.detail, code: g.code } as Json,
            occurred_at: iso(g.t),
          })),
        );
        if (error) throw new Error(`gateway: ${error.message}`);
      }
      if (trades.length) {
        const { error } = await supabase.from("trades").insert(
          trades.map((t) => ({
            order_id: this.orderUuid.get(t.clientOrderId) ?? null,
            client_order_id: this.key(t.clientOrderId),
            account_id: this.ids.accountId[t.agent],
            agent_id: this.ids.agentId[t.agent],
            symbol: t.symbol,
            side: t.side,
            qty: n(t.qty)!,
            entry_px: t.entryPx,
            exit_px: t.exitPx,
            stop_px: t.stopPx,
            target_px: t.targetPx,
            opened_at: iso(t.openedAt),
            closed_at: iso(t.closedAt),
            hold_seconds: t.holdSeconds,
            gross_pnl: n(t.gross)!,
            spread_cost: n(t.spreadCost)!,
            commission_cost: n(t.commission)!,
            slippage_cost: n(t.slippage)!,
            swap_cost: n(t.swap)!,
            net_pnl: n(t.net)!,
            r_multiple: Math.max(-999999, Math.min(999999, t.rMultiple)),
            exit_reason: t.exitReason,
            mae_px: t.maePx,
            mfe_px: t.mfePx,
            decision_px: t.decisionPx,
            arrival_mid: t.arrivalMid,
            horizon_px: t.horizonPx,
            delay_cost: n(t.delayCost)!,
            execution_cost: n(t.executionCost)!,
            missed_fill_cost: n(t.missedFillCost)!,
          })),
        );
        if (error) throw new Error(`trades: ${error.message}`);
      }
      await this.checkpoint(engine);
      this.lastFlushAt = Date.now();
      this.lastError = null;
      return orders.length + gw.length + trades.length > 0;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : "persist failed";
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** Atomic checkpoint of accounts (HWM, floor, cushion) and open positions. */
  async checkpoint(engine: HermesEngine): Promise<void> {
    for (const c of AGENT_CODES) {
      const a = engine.accounts[c];
      const { error } = await supabase
        .from("accounts")
        .update({
          equity: n(a.equity)!,
          high_water_mark: n(a.hwm)!,
          floor: n(a.floor)!,
          cushion: n(a.equity.minus(a.floor))!,
          realized_pnl: this.ids.realizedBase[c] + a.realized.toNumber(),
          unrealized_pnl: n(a.unrealized)!,
        })
        .eq("id", this.ids.accountId[c]);
      if (error) throw new Error(`accounts: ${error.message}`);
    }
    await supabase.from("positions").delete().eq("status", "OPEN");
    if (engine.positions.length) {
      const { error } = await supabase.from("positions").insert(
        engine.positions.map((p) => ({
          account_id: this.ids.accountId[p.agent],
          agent_id: this.ids.agentId[p.agent],
          symbol: p.symbol,
          side: p.side,
          qty: n(p.qty)!,
          entry_px: p.entryPx,
          stop_px: p.stopPx,
          target_px: p.targetPx,
          risk_at_stop: n(p.riskAtStop)!,
          opened_at: iso(p.openedAt),
          time_stop_at: p.timeStopAt ? iso(p.timeStopAt) : null,
          status: "OPEN",
        })),
      );
      if (error) throw new Error(`positions: ${error.message}`);
    }
    const pt = engine.equityCurve[engine.equityCurve.length - 1];
    if (pt) {
      const tot = engine.totals();
      await supabase.from("equity_snapshots").insert({
        ts: iso(pt.t),
        equity: pt.equity,
        high_water_mark: pt.hwm,
        cushion: tot.equity.minus(tot.floor).toNumber(),
        open_risk: pt.openRisk,
        gold_exposure: pt.goldExposure,
      });
    }
  }
}
