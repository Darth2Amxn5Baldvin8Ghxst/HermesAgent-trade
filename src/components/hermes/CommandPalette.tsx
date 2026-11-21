import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Pin, PinOff } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { BOOK_SECTIONS } from "@/content/book";
import { REJECTION_CODES } from "@/engine/rejectionCodes";
import { mcQ, ordersQ, reportsQ, tradesQ, useAgents } from "@/lib/hermes/queries";
import { NAV } from "./nav";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  go: () => void;
}
const LS_RECENT = "hermes.cmdk.recent";
const LS_PIN = "hermes.cmdk.pinned";
const read = (k: string): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const nav = useNavigate();
  const agents = useAgents();
  const trades = useQuery({ ...tradesQ, enabled: open });
  const orders = useQuery({ ...ordersQ, enabled: open });
  const mc = useQuery({ ...mcQ, enabled: open });
  const reports = useQuery({ ...reportsQ, enabled: open });

  useEffect(() => {
    setRecent(read(LS_RECENT));
    setPinned(read(LS_PIN));
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement | null)?.isContentEditable
      )
        return;
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        gPressed = Date.now();
        return;
      }
      if (Date.now() - gPressed < 900) {
        const hit = NAV.find((n) => n.key === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          nav({ to: hit.to });
        }
        gPressed = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = NAV.map((n) => ({
      id: `route:${n.to}`,
      group: "Routes",
      label: n.label,
      hint: `G ${n.key.toUpperCase()}`,
      go: () => nav({ to: n.to }),
    }));
    for (const a of agents.data ?? [])
      out.push({
        id: `agent:${a.code}`,
        group: "Agents",
        label: `${a.code} · ${a.name}`,
        hint: a.status,
        go: () => nav({ to: "/agents/$code", params: { code: a.code } }),
      });
    for (const s of BOOK_SECTIONS)
      out.push({
        id: `book:${s.slug}`,
        group: "Strategy Book",
        label: `§${s.number} ${s.title}`,
        go: () => nav({ to: "/book/$slug", params: { slug: s.slug } }),
      });
    for (const [code, v] of Object.entries(REJECTION_CODES))
      out.push({
        id: `code:${code}`,
        group: "Gateway rejection codes",
        label: `${code} — ${v.title}`,
        go: () => nav({ to: "/gateway", search: { code } }),
      });
    for (const t of (trades.data ?? []).slice(0, 200))
      out.push({
        id: `trade:${t.id}`,
        group: "Trades",
        label: `${t.symbol} ${t.side} ${Number(t.net_pnl).toFixed(2)} · ${t.client_order_id ?? t.id.slice(0, 8)}`,
        hint: t.exit_reason,
        go: () => nav({ to: "/trades", search: { id: t.id } }),
      });
    for (const o of (orders.data ?? []).slice(0, 200))
      out.push({
        id: `order:${o.id}`,
        group: "Orders",
        label: `${o.client_order_id} ${o.side} ${o.symbol}`,
        hint: o.state,
        go: () => nav({ to: "/gateway", search: { order: o.client_order_id } }),
      });
    for (const r of mc.data ?? [])
      out.push({
        id: `mc:${r.id}`,
        group: "Monte Carlo runs",
        label: `seed ${r.seed} · ${r.tail_scenario} · ${r.n_runs.toLocaleString()} runs`,
        hint: `${Number(r.median_max_dd_pct ?? 0).toFixed(2)}%`,
        go: () =>
          nav({ to: "/montecarlo", search: { seed: Number(r.seed), tail: r.tail_scenario } }),
      });
    for (const r of reports.data ?? []) {
      const a = agents.data?.find((x) => x.id === r.agent_id);
      out.push({
        id: `rc:${r.id}`,
        group: "Report cards",
        label: `${a?.code ?? "?"} report card ${r.period_start} → ${r.period_end}`,
        go: () => nav({ to: "/overseer" }),
      });
    }
    return out;
  }, [agents.data, trades.data, orders.data, mc.data, reports.data, nav]);

  const run = (it: Item) => {
    const r = [it.id, ...recent.filter((x) => x !== it.id)].slice(0, 6);
    setRecent(r);
    localStorage.setItem(LS_RECENT, JSON.stringify(r));
    setOpen(false);
    it.go();
  };
  const togglePin = (id: string) => {
    const p = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    setPinned(p);
    localStorage.setItem(LS_PIN, JSON.stringify(p));
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  const groups = [...new Set(items.map((i) => i.group))];
  const row = (it: Item, key: string) => (
    <CommandItem
      key={key}
      value={`${it.group} ${it.label}`}
      onSelect={() => run(it)}
      className="group"
    >
      <span className="truncate">{it.label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          togglePin(it.id);
        }}
        className="ml-auto hidden text-ink-2 hover:text-gold-400 group-data-[selected=true]:block"
        aria-label={pinned.includes(it.id) ? "Unpin" : "Pin"}
      >
        {pinned.includes(it.id) ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      </button>
      {it.hint && <CommandShortcut className="t-mono">{it.hint}</CommandShortcut>}
    </CommandItem>
  );
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a route, agent, trade, order, rejection code, book section, Monte Carlo run…" />
      <CommandList className="max-h-[460px]">
        <CommandEmpty>No match.</CommandEmpty>
        {pinned.length > 0 && (
          <CommandGroup heading="Pinned">
            {pinned
              .map((id) => byId.get(id))
              .filter((x): x is Item => !!x)
              .map((it) => row(it, `p-${it.id}`))}
          </CommandGroup>
        )}
        {recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent
              .map((id) => byId.get(id))
              .filter((x): x is Item => !!x)
              .map((it) => row(it, `r-${it.id}`))}
          </CommandGroup>
        )}
        <CommandSeparator />
        {groups.map((g) => (
          <CommandGroup key={g} heading={g}>
            {items.filter((i) => i.group === g).map((it) => row(it, it.id))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
