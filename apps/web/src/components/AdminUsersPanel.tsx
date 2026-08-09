import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ADMIN_USER_FILTERS,
  ADMIN_USER_FILTER_LABELS,
  ADMIN_USER_SORTS,
  ADMIN_USER_SORT_LABELS,
  type AdminUserFilter,
  type AdminUserQuery,
  type AdminUserRow,
  type AdminUserSort,
} from "@gm/shared";
import { api } from "../lib/api.js";

/**
 * The account list.
 *
 * It sits on the analytics page because it answers the other half of the same
 * question: the charts say how much the app is used, this says by whom. The
 * numbers per row are the ones that tell you whether an account is a person
 * using the thing or a row that signed up and left — games, collections,
 * friends, and when they were last seen.
 *
 * Read-only. Bans, role changes and forced resets each need a confirmation
 * flow and an audit story, and belong in the admin panel that's still open in
 * phase 6 rather than behind a table row on a dashboard.
 */

const selectClass =
  "rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500";

/** How many rows one page shows — the server caps this at 200. */
const PAGE_SIZE = 50;

/** "3 days ago", give or take. Precise dates are in the title attribute. */
function relative(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
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

/** A small pill saying something notable about an account. */
function Flag({ label, tone, title }: { label: string; tone: string; title?: string }) {
  return (
    <span
      title={title}
      className={`rounded-full border px-1.5 py-px text-[10px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function UserRow({ user }: { user: AdminUserRow }) {
  return (
    <tr className="border-t border-zinc-800 hover:bg-zinc-800/40">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-zinc-200">{user.name}</span>
          {user.role === "admin" && (
            <Flag label="ADMIN" tone="border-indigo-700 bg-indigo-950/60 text-indigo-300" />
          )}
          {user.isDemo && (
            <Flag
              label="DEMO"
              tone="border-amber-700 bg-amber-950/60 text-amber-300"
              title="Seeded showcase account behind /demo — not a person, and left out of every average"
            />
          )}
          {user.banned && (
            <Flag
              label="BANNED"
              tone="border-red-800 bg-red-950/60 text-red-300"
              title={user.banReason ?? "No reason recorded"}
            />
          )}
          {user.isPremium && (
            <Flag label="PREMIUM" tone="border-emerald-800 bg-emerald-950/60 text-emerald-300" />
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          {/* demo accounts have no `account` row and so no real inbox */}
          {user.isDemo ? (
            user.email
          ) : (
            <a href={`mailto:${user.email}`} className="hover:text-zinc-300 hover:underline">
              {user.email}
            </a>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-center [font-variant-numeric:tabular-nums]">{user.games}</td>
      <td className="px-3 py-2 text-center [font-variant-numeric:tabular-nums]">
        {user.collections}
      </td>
      <td className="px-3 py-2 text-center [font-variant-numeric:tabular-nums]">{user.friends}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {user.twoFactorEnabled && (
            <Flag
              label="2FA"
              tone="border-emerald-800 bg-emerald-950/60 text-emerald-300"
              title="Two-factor sign-in is on"
            />
          )}
          {user.steamLinked && (
            <Flag
              label="STEAM"
              tone="border-sky-800 bg-sky-950/60 text-sky-300"
              title="Has linked a Steam account"
            />
          )}
          {!user.emailVerified && !user.isDemo && (
            <Flag
              label="UNVERIFIED"
              tone="border-zinc-700 bg-zinc-800 text-zinc-400"
              title="Email never verified — verification isn't enforced yet"
            />
          )}
        </div>
      </td>
      <td
        className="px-3 py-2 whitespace-nowrap"
        title={new Date(user.createdAt).toLocaleString()}
      >
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
      <td
        className="px-3 py-2 whitespace-nowrap"
        title={user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : "No activity logged"}
      >
        {relative(user.lastActiveAt)}
      </td>
      <td
        className="px-3 py-2 text-center [font-variant-numeric:tabular-nums]"
        title="Unexpired sessions — roughly how many devices are signed in"
      >
        {user.sessions}
      </td>
    </tr>
  );
}

export function AdminUsersPanel() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<AdminUserFilter>("all");
  const [sort, setSort] = useState<AdminUserSort>("newest");
  const [page, setPage] = useState(0);

  const query: AdminUserQuery = {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(filter !== "all" ? { filter } : {}),
    sort,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };

  const users = useQuery({
    queryKey: ["admin-users", query],
    queryFn: () => api.getAdminUsers(query),
    placeholderData: keepPreviousData,
  });

  /** Any change to what's being matched resets to the first page. */
  function narrow(update: () => void) {
    update();
    setPage(0);
  }

  const rows = users.data?.users ?? [];
  const counts = users.data?.counts;
  const total = users.data?.total ?? 0;
  const filtered = !!(q.trim() || filter !== "all");

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ADMIN_USER_FILTERS.map((f) => (
          <Tile
            key={f}
            label={ADMIN_USER_FILTER_LABELS[f]}
            value={counts?.[f] ?? 0}
            onClick={() => narrow(() => setFilter(filter === f ? "all" : f))}
            active={filter === f}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(ev) => narrow(() => setQ(ev.target.value))}
          placeholder="Search names and emails…"
          className="min-w-48 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
        />
        <select
          value={filter}
          onChange={(ev) => narrow(() => setFilter(ev.target.value as AdminUserFilter))}
          className={selectClass}
        >
          {ADMIN_USER_FILTERS.map((f) => (
            <option key={f} value={f}>
              {ADMIN_USER_FILTER_LABELS[f]}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(ev) => narrow(() => setSort(ev.target.value as AdminUserSort))}
          className={selectClass}
        >
          {ADMIN_USER_SORTS.map((s) => (
            <option key={s} value={s}>
              {ADMIN_USER_SORT_LABELS[s]}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            onClick={() =>
              narrow(() => {
                setQ("");
                setFilter("all");
              })
            }
            className="rounded-lg border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            Clear
          </button>
        )}
      </div>

      {users.isError ? (
        <p className="text-sm text-red-400">Couldn't load the account list — is the API up?</p>
      ) : null}

      <p className="mb-2 text-xs text-zinc-500">
        {users.data ? `${total} account${total === 1 ? "" : "s"}` : "Loading…"}
        {total > PAGE_SIZE ? ` · showing ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}` : ""}
      </p>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-zinc-950/50 text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 text-center font-medium">Games</th>
              <th className="px-3 py-2 text-center font-medium">Collections</th>
              <th className="px-3 py-2 text-center font-medium">Friends</th>
              <th className="px-3 py-2 font-medium">Set up</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 font-medium">Last active</th>
              <th className="px-3 py-2 text-center font-medium">Sessions</th>
            </tr>
          </thead>
          <tbody className="text-zinc-400">
            {rows.length === 0 && !users.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-600">
                  {filtered ? "No accounts match these filters." : "No accounts yet."}
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          <span>
            Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      <p className="mt-3 text-[11px] text-zinc-600">
        "Last active" comes from the activity log, so an account that hasn't opened the app since
        logging was switched on shows a dash rather than a date we'd be guessing at. Demo accounts
        are listed here but excluded from every average on the Overview tab.
      </p>
    </div>
  );
}
