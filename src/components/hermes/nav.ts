import {
  Activity,
  BookOpen,
  Bot,
  Dices,
  FlaskConical,
  Gauge,
  Globe,
  ListOrdered,
  CalendarClock,
  Settings,
  ShieldCheck,
  Scale,
} from "lucide-react";

export const NAV = [
  { to: "/", label: "Command Center", icon: Gauge, key: "c" },
  { to: "/agents", label: "Agents", icon: Bot, key: "a" },
  { to: "/book", label: "Strategy Book", icon: BookOpen, key: "b" },
  { to: "/gateway", label: "Risk Gateway", icon: ShieldCheck, key: "r" },
  { to: "/overseer", label: "Overseer", icon: Scale, key: "o" },
  { to: "/validation", label: "Validation Gate", icon: Activity, key: "v" },
  { to: "/montecarlo", label: "Monte Carlo Lab", icon: Dices, key: "m" },
  { to: "/markets", label: "Real Markets", icon: Globe, key: "k" },
  { to: "/backtest", label: "Backtest Studio", icon: FlaskConical, key: "s" },
  { to: "/planned", label: "Trade Pipeline", icon: CalendarClock, key: "p" },
  { to: "/trades", label: "Trade Log", icon: ListOrdered, key: "t" },
  { to: "/settings", label: "Settings", icon: Settings, key: "," },
] as const;
