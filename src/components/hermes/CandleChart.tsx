import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "@/engine/types";

export interface Level {
  price: number;
  label: string;
  color: string;
}
/** TradingView Lightweight Charts candle view with entry/exit/stop/target levels and markers. */
export function CandleChart({
  bars,
  levels,
  markers,
  height = 260,
}: {
  bars: Bar[];
  levels: Level[];
  markers: { t: number; label: string; color: string; above: boolean }[];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !bars.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const chart: IChartApi = createChart(ref.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: v("--surface-1") },
        textColor: v("--ink-2"),
        fontFamily: "JetBrains Mono",
      },
      grid: { vertLines: { color: v("--border-0") }, horzLines: { color: v("--border-0") } },
      timeScale: { timeVisible: true, borderColor: v("--border-1") },
      rightPriceScale: { borderColor: v("--border-1") },
      autoSize: true,
    });
    const s = chart.addSeries(CandlestickSeries, {
      upColor: v("--pos"),
      downColor: v("--neg"),
      wickUpColor: v("--pos"),
      wickDownColor: v("--neg"),
      borderVisible: false,
    });
    s.setData(
      bars.map((b) => ({
        time: Math.floor(b.t / 1000) as UTCTimestamp,
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      })),
    );
    for (const l of levels)
      s.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.label,
      });
    createSeriesMarkers(
      s,
      markers
        .map((m) => ({
          time: (Math.floor(m.t / 1000 / 900) * 900) as UTCTimestamp,
          position: m.above ? ("aboveBar" as const) : ("belowBar" as const),
          color: m.color,
          shape: m.above ? ("arrowDown" as const) : ("arrowUp" as const),
          text: m.label,
        }))
        .sort((a, b) => a.time - b.time),
    );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, levels, markers, height]);
  return <div ref={ref} style={{ height }} className="w-full" />;
}
