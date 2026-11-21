import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronsLeft,
  ChevronsRight,
  Command,
  LogOut,
  Pause,
  Play,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SPEEDS, useSim, type Speed } from "@/lib/hermes/store";
import { useHermesBootstrap, useSimLoop } from "@/lib/hermes/bootstrap";
import { audit, qk, useSettings } from "@/lib/hermes/queries";
import { fmtGmt, fmtPct, fmtUsd } from "@/lib/hermes/format";
import { MARKETS } from "@/engine/markets";
import type { Sym } from "@/engine/types";
import { Num, Sparkline } from "./ui";
import { NAV } from "./nav";
import { KillSwitch } from "./KillSwitch";
import { CommandPalette } from "./CommandPalette";

function Rail({
  collapsed,
  setCollapsed,
  email,
}: {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  email: string;
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside
      className={cn(
        "no-print flex shrink-0 flex-col border-r border-line-0 bg-surface-1 transition-[width] duration-200",
        collapsed ? "w-[60px]" : "w-[224px]",
      )}
    >
      <div className="flex h-12 items-center gap-2.5 border-b border-line-0 px-4">
        <div className="grid size-6 shrink-0 place-items-center rounded-[6px] border border-line-gold bg-surface-2 text-[11px] font-bold text-gold-400">
          H
        </div>
        {!collapsed && (
          <div className="font-display text-[15px] font-semibold tracking-[-0.01em]">
            HermesAgents
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 p-2" aria-label="Primary">
        {NAV.map((n) => {
          const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] transition-colors",
                active
                  ? "bg-surface-3 text-ink-0"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink-0",
              )}
              title={collapsed ? n.label : undefined}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-gold-400")} />
              {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
              {!collapsed && (
                <span className="t-mono text-[10px] text-ink-3 opacity-0 group-hover:opacity-100">
                  G {n.key.toUpperCase()}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-line-0 p-2">
        {!collapsed && <div className="truncate px-2.5 pb-1 text-[11px] text-ink-2">{email}</div>}
        <button
          onClick={() => supabase.auth.signOut()}
          className="flex h-8 w-full items-center gap-3 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink-0"
        >
          <LogOut className="size-4" /> {!collapsed && "Sign out"}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-8 w-full items-center gap-3 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink-0"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? (
            <ChevronsRight className="size-4" />
          ) : (
            <>
              <ChevronsLeft className="size-4" /> Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

function StatusBar() {
  useSim((s) => s.version);
  const { engine, running, speed, setRunning, setSpeed, persister } = useSim.getState();
  const qc = useQueryClient();
  if (!engine) {
    return (
      <div className="flex h-12 items-center border-b border-line-0 px-4">
        <div className="h-4 w-80 animate-pulse rounded bg-surface-3" />
      </div>
    );
  }
  const tot = engine.totals();
  const cushion = tot.equity.minus(tot.floor);
  const cushionPct = cushion.div(tot.hwm).toNumber();
  const gold = engine.goldExposure();
  const disarm = async () => {
    engine.disarm();
    await supabase
      .from("operator_settings")
      .update({ kill_armed: false })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await audit("KILL_SWITCH_DISARM", "portfolio", null, { armed: true }, { armed: false });
    qc.invalidateQueries({ queryKey: qk.settings });
    toast.success("Kill switch disarmed — gateway accepting orders again");
  };
  return (
    <div className="no-print glass sticky top-0 z-30 flex h-12 items-center gap-5 border-b border-line-0 px-4">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", persister?.lastError ? "bg-warn" : "bg-pos")} />
        <span className="t-label text-ink-1">SIM</span>
        <span
          className="t-num text-[12px] text-ink-2"
          title={persister?.lastError ?? "Persisting to Lovable Cloud"}
        >
          {persister?.lastError ? "write retry" : "synced"}
        </span>
      </div>
      <div className="t-num text-[13px] text-ink-0">
        {fmtGmt(engine.now, "EEE yyyy-MM-dd HH:mm")}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setRunning(!running)}
          className="grid size-7 place-items-center rounded-md text-ink-1 hover:bg-surface-3 hover:text-ink-0"
          aria-label={running ? "Pause simulation" : "Run simulation"}
        >
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s as Speed)}
            className={cn(
              "t-num h-6 rounded px-1.5 text-[11px]",
              speed === s ? "bg-surface-3 text-gold-400" : "text-ink-2 hover:text-ink-0",
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-5 text-[12px]">
        <div className="flex items-baseline gap-1.5">
          <span className="t-label">Equity</span>
          <Num
            value={fmtUsd(tot.equity.toNumber(), 0)}
            formula="Σ account equity = Σ (start + realised + unrealised)"
            inputs={`HWM ${fmtUsd(tot.hwm.toNumber(), 0)}`}
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="t-label">Cushion</span>
          <Num
            value={fmtPct(cushionPct)}
            className={cushionPct < 0.03 ? "text-warn" : "text-ink-0"}
            formula="(equity − floor) / HWM, floor = HWM × 0.92"
            inputs={`${fmtUsd(cushion.toNumber(), 0)} / ${fmtUsd(tot.hwm.toNumber(), 0)}`}
          />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="t-label">Gold</span>
          <Num
            value={fmtPct(gold, 0)}
            className={gold > 0.5 ? "text-neg" : "text-ink-0"}
            formula="XAUUSD risk at stop / total open risk"
            inputs={`open risk ${fmtUsd(engine.openRisk().toNumber(), 0)}`}
          />
        </div>
        {engine.killArmed ? (
          <button
            onClick={disarm}
            className="flex items-center gap-1.5 rounded-md border border-breach/60 px-2 py-1 text-[11px] font-semibold text-neg hover:bg-breach/10"
          >
            <ShieldAlert className="size-3.5" /> KILL ARMED · disarm
          </button>
        ) : (
          <span className="t-label text-ink-3">kill safe</span>
        )}
        <button
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))
          }
          className="flex items-center gap-1 rounded-md border border-line-1 px-2 py-1 text-ink-2 hover:text-ink-0"
          aria-label="Open command palette"
        >
          <Command className="size-3" /> <span className="t-mono text-[11px]">K</span>
        </button>
      </div>
    </div>
  );
}

const TICKER: Sym[] = ["XAUUSD", "XAGUSD", "DXY", "NAS100", "BTCUSD"];
function Ticker() {
  useSim((s) => s.version);
  const engine = useSim.getState().engine;
  return (
    <div className="no-print glass fixed right-0 bottom-0 left-0 z-30 flex h-10 items-center gap-6 overflow-x-auto border-t border-line-0 px-4">
      {TICKER.map((s) => {
        if (!engine) return <div key={s} className="h-3 w-28 animate-pulse rounded bg-surface-3" />;
        const m = engine.market;
        const series = m
          .m15(s)
          .slice(-64)
          .map((b) => b.c);
        const mid = m.mid(s);
        const d1 = m.d1(s);
        const prev = d1[d1.length - 1]?.c ?? mid;
        const ch = mid / prev - 1;
        return (
          <div key={s} className="flex shrink-0 items-center gap-2">
            <span className="t-label text-ink-1">{s}</span>
            <span className="t-num text-[12px]">{mid.toFixed(MARKETS[s].digits)}</span>
            <span className={cn("t-num text-[11px]", ch >= 0 ? "text-pos" : "text-neg")}>
              {fmtPct(ch, 2, true)}
            </span>
            <Sparkline data={series} width={72} height={20} />
          </div>
        );
      })}
    </div>
  );
}

export function AppShell({
  userId,
  email,
  children,
}: {
  userId: string;
  email: string;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  useHermesBootstrap(userId);
  useSimLoop();
  const settings = useSettings();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = document.documentElement;
    const theme = settings.data?.theme ?? "dark";
    el.classList.toggle("theme-ultra", theme === "ultra");
    el.classList.toggle("theme-light", theme === "light");
    el.classList.toggle("density-compact", settings.data?.density === "compact");
  }, [settings.data?.theme, settings.data?.density]);
  const key = useMemo(() => path.split("/").slice(0, 2).join("/"), [path]);
  return (
    <div className="flex h-screen overflow-hidden bg-surface-0">
      <Rail collapsed={collapsed} setCollapsed={setCollapsed} email={email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <StatusBar />
        <main className="min-h-0 flex-1 overflow-y-auto pb-16">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={key}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? {} : { opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="mx-auto max-w-[1680px] px-6 py-6"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <Ticker />
      <KillSwitch />
      <CommandPalette />
    </div>
  );
}
