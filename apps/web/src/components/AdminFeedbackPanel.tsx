import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FEEDBACK_AREAS,
  FEEDBACK_AREA_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_SORTS,
  FEEDBACK_SORT_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type AdminFeedbackQuery,
  type FeedbackArea,
  type FeedbackItem,
  type FeedbackKind,
  type FeedbackSort,
  type FeedbackStatus,
} from "@gm/shared";
import { api } from "../lib/api.js";
import { StatusBadge } from "./FeedbackStatusBadge.js";

/**
 * The feedback queue: everything users have filed, filtered, sorted, triaged
 * and exportable.
 *
 * It lives on the analytics page rather than in its own admin section because
 * it answers the same question the charts do — what are people actually doing
 * with this, and where does it fall over — and because a queue nobody passes
 * daily is a queue nobody reads.
 */

const selectClass =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500";

/** Escapes text on its way into the printable document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * "Export as PDF" without a PDF library: a printable document in a new
 * window, straight into the browser's own print dialog, where "Save as PDF"
 * is a destination. It renders the filtered set as it stands, not the page —
 * printing the app itself would carry the nav and the charts with it.
 */
function printAsPdf(items: FeedbackItem[], describe: string): void {
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked — the CSV link is right next to this

  const rows = items
    .map(
      (i) => `<tr>
        <td class="when">${escapeHtml(new Date(i.createdAt).toLocaleString())}</td>
        <td>${escapeHtml(FEEDBACK_KIND_LABELS[i.kind])}</td>
        <td>${escapeHtml(FEEDBACK_AREA_LABELS[i.area])}</td>
        <td>${escapeHtml(FEEDBACK_STATUS_LABELS[i.status])}</td>
        <td>
          <strong>${escapeHtml(i.subject)}</strong>
          <div class="msg">${escapeHtml(i.message)}</div>
          ${i.adminNote ? `<div class="note">Note: ${escapeHtml(i.adminNote)}</div>` : ""}
        </td>
        <td>${escapeHtml(i.authorName ?? "—")}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Game Manager feedback — ${escapeHtml(new Date().toLocaleDateString())}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 11px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #18181b; margin: 24px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.meta { margin: 0 0 16px; color: #52525b; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
       color: #52525b; border-bottom: 1px solid #a1a1aa; padding: 0 6px 4px; }
  td { vertical-align: top; padding: 6px; border-bottom: 1px solid #e4e4e7; }
  td.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
  .msg { margin-top: 3px; white-space: pre-wrap; color: #3f3f46; }
  .note { margin-top: 3px; color: #7c2d12; }
  tr { break-inside: avoid; }
  @page { margin: 14mm; }
</style></head><body>
<h1>Game Manager — feedback</h1>
<p class="meta">${escapeHtml(describe)} · ${items.length} item${items.length === 1 ? "" : "s"} · exported ${escapeHtml(new Date().toLocaleString())}</p>
<table>
  <thead><tr><th>Submitted</th><th>Kind</th><th>Area</th><th>Status</th><th>Report</th><th>From</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="6">Nothing matches these filters.</td></tr>`}</tbody>
</table>
</body></html>`);
  win.document.close();
  win.focus();
  // let the document lay out before the dialog freezes it
  win.setTimeout(() => win.print(), 250);
}

export function AdminFeedbackPanel() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<FeedbackKind | "">("");
  const [area, setArea] = useState<FeedbackArea | "">("");
  const [status, setStatus] = useState<FeedbackStatus | "">("");
  const [sort, setSort] = useState<FeedbackSort>("newest");
  const [openId, setOpenId] = useState<string | null>(null);

  const query: AdminFeedbackQuery = {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(kind ? { kind } : {}),
    ...(area ? { area } : {}),
    ...(status ? { status } : {}),
    sort,
  };

  const feedback = useQuery({
    queryKey: ["admin-feedback", query],
    queryFn: () => api.getAdminFeedback(query),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-feedback"] });

  const triage = useMutation({
    mutationFn: ({ id, ...input }: { id: string; status?: FeedbackStatus; adminNote?: string }) =>
      api.updateFeedback(id, input),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFeedback(id),
    onSuccess: refresh,
  });

  const items = feedback.data?.items ?? [];
  const totals = feedback.data?.totals;
  const filtered = !!(q.trim() || kind || area || status);

  /** What the export header says these rows are. */
  const describe = filtered
    ? [
        kind ? FEEDBACK_KIND_LABELS[kind] : null,
        area ? FEEDBACK_AREA_LABELS[area] : null,
        status ? FEEDBACK_STATUS_LABELS[status] : null,
        q.trim() ? `matching "${q.trim()}"` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "All feedback";

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="All feedback" value={totals?.all ?? 0} />
        {FEEDBACK_STATUSES.map((s) => (
          <Tile
            key={s}
            label={FEEDBACK_STATUS_LABELS[s]}
            value={totals?.byStatus[s] ?? 0}
            onClick={() => setStatus(status === s ? "" : s)}
            active={status === s}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="Search titles and messages…"
          className="min-w-48 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
        />
        <select
          value={kind}
          onChange={(ev) => setKind(ev.target.value as FeedbackKind | "")}
          className={selectClass}
        >
          <option value="">Any kind</option>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {FEEDBACK_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={area}
          onChange={(ev) => setArea(ev.target.value as FeedbackArea | "")}
          className={selectClass}
        >
          <option value="">Any area</option>
          {FEEDBACK_AREAS.map((a) => (
            <option key={a} value={a}>
              {FEEDBACK_AREA_LABELS[a]}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(ev) => setStatus(ev.target.value as FeedbackStatus | "")}
          className={selectClass}
        >
          <option value="">Any status</option>
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FEEDBACK_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(ev) => setSort(ev.target.value as FeedbackSort)}
          className={selectClass}
        >
          {FEEDBACK_SORTS.map((s) => (
            <option key={s} value={s}>
              {FEEDBACK_SORT_LABELS[s]}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            onClick={() => {
              setQ("");
              setKind("");
              setArea("");
              setStatus("");
            }}
            className="rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Clear
          </button>
        )}

        <span className="ml-auto flex items-center gap-2">
          {/* a link, not a fetch — the browser downloads it with its filename,
              and the session cookie rides along on a same-origin request */}
          <a
            href={api.feedbackExportUrl(query)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            ⬇ Export CSV
          </a>
          <button
            onClick={() => printAsPdf(items, describe)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            🖨 Export PDF
          </button>
        </span>
      </div>

      <p className="mb-2 text-xs text-zinc-500">
        {feedback.data ? `${feedback.data.total} matching` : "Loading…"}
        {feedback.data && feedback.data.total > items.length
          ? ` · showing the first ${items.length}`
          : ""}
      </p>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-950/50 text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Area</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">From</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="text-zinc-400">
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-600">
                  {filtered
                    ? "Nothing matches these filters."
                    : "No feedback yet — it lands here as people send it."}
                </td>
              </tr>
            )}
            {items.map((item) => (
              <FeedbackRow
                key={item.id}
                item={item}
                open={openId === item.id}
                onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                onStatus={(next) => triage.mutate({ id: item.id, status: next })}
                onNote={(note) => triage.mutate({ id: item.id, adminNote: note })}
                onDelete={() => {
                  if (confirm(`Delete "${item.subject}"? This can't be undone.`)) {
                    remove.mutate(item.id);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: number;
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-zinc-100">{value}</div>
    </>
  );
  if (!onClick) {
    return <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">{body}</div>;
  }
  return (
    <button
      onClick={onClick}
      title={active ? "Click to clear this filter" : `Show only "${label}"`}
      className={`rounded-xl border p-4 text-left transition ${
        active
          ? "border-indigo-500 bg-indigo-950/40"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
      }`}
    >
      {body}
    </button>
  );
}

/** One report: a summary row, and the whole thing plus triage when expanded. */
function FeedbackRow({
  item,
  open,
  onToggle,
  onStatus,
  onNote,
  onDelete,
}: {
  item: FeedbackItem;
  open: boolean;
  onToggle: () => void;
  onStatus: (status: FeedbackStatus) => void;
  onNote: (note: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(item.adminNote ?? "");

  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/40"
      >
        <td className="px-3 py-2 whitespace-nowrap [font-variant-numeric:tabular-nums]">
          {new Date(item.createdAt).toLocaleDateString()}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{FEEDBACK_KIND_LABELS[item.kind]}</td>
        <td className="px-3 py-2 whitespace-nowrap">{FEEDBACK_AREA_LABELS[item.area]}</td>
        <td className="px-3 py-2 text-zinc-200">
          <span className="mr-1.5 text-zinc-600">{open ? "▾" : "▸"}</span>
          {item.subject}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{item.authorName ?? "—"}</td>
        <td className="px-3 py-2">
          <StatusBadge status={item.status} />
        </td>
      </tr>
      {open && (
        <tr className="border-t border-zinc-800 bg-zinc-950/40">
          <td colSpan={6} className="px-3 py-3">
            <p className="whitespace-pre-wrap text-sm text-zinc-300">{item.message}</p>
            {item.authorEmail && (
              <p className="mt-2 text-xs text-zinc-600">
                From {item.authorName} ·{" "}
                <a href={`mailto:${item.authorEmail}`} className="underline hover:text-zinc-400">
                  {item.authorEmail}
                </a>
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
              <span className="text-xs text-zinc-500">Status</span>
              <select
                value={item.status}
                onChange={(ev) => onStatus(ev.target.value as FeedbackStatus)}
                className={selectClass}
              >
                {FEEDBACK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {FEEDBACK_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>

              <input
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                onBlur={() => {
                  if (note !== (item.adminNote ?? "")) onNote(note);
                }}
                placeholder="Private note (never shown to the sender)"
                className="min-w-56 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
              />

              <button
                onClick={onDelete}
                className="rounded-lg border border-red-900 px-2 py-1.5 text-xs text-red-400 hover:bg-red-950"
              >
                Delete
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
