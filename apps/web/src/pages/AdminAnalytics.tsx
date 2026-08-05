import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import * as Plot from "@observablehq/plot";
import type { AdminAnalyticsOverview } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { AdminFeedbackPanel } from "../components/AdminFeedbackPanel.js";

type Tab = "overview" | "feedback";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "feedback", label: "Feedback" },
];

// Chart palette (dark-only, matching the app's zinc surfaces). The funnel's
// ordinal ramp is validated against the zinc-900 card surface — see the
// dataviz palette rules before changing these.
const ACCENT = "#3987e5";
const FUNNEL_RAMP = ["#6da7ec", "#3987e5", "#256abf", "#184f95"];
const SURFACE = "#18181b"; // zinc-900
const GRID = "#27272a"; // zinc-800
const AXIS_INK = "#a1a1aa"; // zinc-400
const LABEL_INK = "#e4e4e7"; // zinc-200

/** Renders an Observable Plot figure, rebuilt on data change and resize. */
function PlotFigure({ render }: { render: (width: number) => SVGSVGElement | HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // measure immediately — ResizeObserver only fires with the render loop,
    // which a backgrounded tab throttles, and the first paint shouldn't wait
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.floor(w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || width === 0) return;
    const plot = render(width);
    el.append(plot);
    return () => plot.remove();
  }, [render, width]);

  return <div ref={ref} className="w-full" />;
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
  aside,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          {subtitle ? <p className="text-xs text-zinc-500">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

export function AdminAnalyticsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const isAdmin = me.data?.role === "admin";
  const [tab, setTab] = useState<Tab>("overview");

  const overview = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: () => api.getAdminAnalytics(),
    enabled: isAdmin && tab === "overview",
    placeholderData: keepPreviousData,
  });

  const renderDau = useCallback(
    (width: number) => {
      const data = (overview.data?.dau ?? []).map((d) => ({
        date: new Date(`${d.day}T00:00:00Z`),
        users: d.users,
      }));
      const max = Math.max(1, ...data.map((d) => d.users));
      return Plot.plot({
        width,
        height: 220,
        style: { background: "transparent", color: AXIS_INK, fontSize: "11px" },
        x: { type: "utc", label: null },
        y: {
          grid: true,
          label: null,
          domain: [0, Math.max(2, Math.ceil(max * 1.2))],
          tickFormat: (d: number) => (Number.isInteger(d) ? String(d) : ""),
        },
        marks: [
          Plot.gridY({ stroke: GRID, strokeOpacity: 1 }),
          Plot.areaY(data, {
            x: "date",
            y: "users",
            fill: ACCENT,
            fillOpacity: 0.1,
            curve: "monotone-x",
          }),
          Plot.lineY(data, {
            x: "date",
            y: "users",
            stroke: ACCENT,
            strokeWidth: 2,
            curve: "monotone-x",
          }),
          Plot.ruleY([0], { stroke: GRID }),
          Plot.tip(
            data,
            Plot.pointerX({
              x: "date",
              y: "users",
              fill: SURFACE,
              stroke: GRID,
            }),
          ),
        ],
      });
    },
    [overview.data?.dau],
  );

  const renderFunnel = useCallback(
    (width: number) => {
      const funnel = overview.data?.funnel ?? [];
      const first = funnel[0]?.users ?? 0;
      const steps = funnel.map((f) => f.step);
      return Plot.plot({
        width,
        height: 200,
        marginLeft: 140,
        marginRight: 90,
        style: { background: "transparent", color: AXIS_INK, fontSize: "11px" },
        x: { axis: null },
        y: { domain: steps, label: null, tickSize: 0, padding: 0.35 },
        color: { domain: steps, range: FUNNEL_RAMP },
        marks: [
          Plot.barX(funnel, { y: "step", x: "users", fill: "step", rx2: 4, tip: true }),
          Plot.text(funnel, {
            y: "step",
            x: "users",
            text: (d: { users: number }) =>
              first > 0 ? `${d.users} · ${Math.round((d.users / first) * 100)}%` : String(d.users),
            dx: 8,
            textAnchor: "start",
            fill: LABEL_INK,
            fontWeight: 600,
          }),
          Plot.ruleX([0], { stroke: GRID }),
        ],
      });
    },
    [overview.data?.funnel],
  );

  if (me.data && !isAdmin) {
    return (
      <Shell>
        <p className="text-zinc-400">Admin access required.</p>
      </Shell>
    );
  }

  const eng = overview.data?.engagement;

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-zinc-100">Analytics</h1>
        <p className="text-sm text-zinc-500">
          User behavior and system health, from the background event log — and what people have
          told us directly.
        </p>
      </div>

      <div className="mb-5 flex gap-1 border-b border-zinc-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "border-indigo-500 text-indigo-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "feedback" ? <AdminFeedbackPanel /> : null}

      <div className={tab === "overview" ? "" : "hidden"}>
      {overview.isError ? (
        <p className="text-sm text-red-400">Couldn't load analytics — is the API up?</p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Active today" value={String(eng?.dauToday ?? "—")} />
        <StatTile label="Active this week" value={String(eng?.wau ?? "—")} />
        <StatTile label="Active this month" value={String(eng?.mau ?? "—")} hint="last 30 days" />
        <StatTile
          label="Avg games per user"
          value={eng ? eng.avgGamesPerUser.toFixed(1) : "—"}
          hint={eng ? `${eng.totalLibraryEntries} games · ${eng.totalUsers} users` : undefined}
        />
        <StatTile
          label="Avg session"
          value={eng ? formatDuration(eng.avgSessionMinutes) : "—"}
          hint="30-min idle gap ends a session"
        />
        <StatTile label="Sessions" value={String(eng?.sessions30d ?? "—")} hint="last 30 days" />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Sign-up funnel"
          subtitle="Distinct users who ever reached each step, % of sign-ups"
        >
          <PlotFigure render={renderFunnel} />
        </Card>
        <Card title="Daily active users" subtitle="Last 30 days">
          <PlotFigure render={renderDau} />
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">
              View as table
            </summary>
            <div className="mt-2 max-h-40 overflow-y-auto">
              <table className="w-full text-xs text-zinc-400 [font-variant-numeric:tabular-nums]">
                <tbody>
                  {(overview.data?.dau ?? []).map((d) => (
                    <tr key={d.day} className="border-t border-zinc-800">
                      <td className="py-1">{d.day}</td>
                      <td className="py-1 text-right">{d.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
      </div>
      </div>
    </Shell>
  );
}
