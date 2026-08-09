import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BUILTIN_CATEGORIES, type CategoryView, type Preferences } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { SteamCard } from "../components/SteamCard.js";
import { TwoFactorCard } from "../components/TwoFactorCard.js";
import { ConsoleSelect } from "../components/ConsolePicker.js";
import { useCategories } from "../lib/categories.js";
import { statusChip } from "../lib/format.js";

const DEFAULT_HEX: Record<string, string> = Object.fromEntries(
  BUILTIN_CATEGORIES.map((c) => [c.key, c.color]),
);

export function PreferencesPage() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.getPreferences() });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const categories = useCategories();
  const [newCategory, setNewCategory] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const createCategory = useMutation({
    mutationFn: (name: string) => api.createCategory({ name }),
    onSuccess: () => {
      setNewCategory("");
      setCategoryError(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: Error) => setCategoryError(err.message),
  });

  const save = useMutation({
    mutationFn: (patch: Partial<Preferences>) => api.savePreferences(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const p = prefs.data;

  function setStatusColor(status: string, hex: string) {
    save.mutate({ statusColors: { ...(p?.statusColors ?? {}), [status]: hex } });
  }

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-bold">Preferences</h1>

      {/* two panels to a row on a wide screen — one below `lg` */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SteamCard />

        {/* hidden on the demo tour: it has no credentials to add a factor to,
            and every write there is refused anyway */}
        {me.data && !me.data.isDemo ? (
          <TwoFactorCard enabled={me.data.twoFactorEnabled} />
        ) : null}

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">Categories</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Built-in categories can be recoloured but not removed. Add your own for anything
            else you want to track.
          </p>

          <div className="mt-4 space-y-2">
            {(categories ?? [])
              .filter((c) => !c.builtIn)
              .map((c) => (
                <CustomCategoryRow key={c.key} id={c.key} name={c.label} count={c.count} />
              ))}
          </div>

          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (newCategory.trim()) createCategory.mutate(newCategory.trim());
            }}
            className="mt-3 flex gap-2"
          >
            <input
              value={newCategory}
              onChange={(ev) => setNewCategory(ev.target.value)}
              placeholder="+ new category (e.g. Replaying)"
              className="min-w-0 flex-1 rounded-lg border border-dashed border-zinc-700 bg-transparent px-3 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-indigo-500"
            />
            {newCategory.trim() && (
              <button
                type="submit"
                disabled={createCategory.isPending}
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold hover:bg-indigo-500"
              >
                Add
              </button>
            )}
          </form>
          {categoryError && <p className="mt-2 text-xs text-amber-400">{categoryError}</p>}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">New game defaults</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Where a game lands when you add one without saying otherwise — including from
            quick add, imports and barcode scans.
          </p>

          <label className="mt-4 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            Category
            <select
              value={p?.defaultStatus ?? "backlog"}
              onChange={(e) => save.mutate({ defaultStatus: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            >
              {(categories ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            Platform
            <ConsoleSelect
              value={p?.defaultPlatformId ?? null}
              onChange={(platformId) => save.mutate({ defaultPlatformId: platformId })}
              placeholder="Don't set one"
            />
            {p?.defaultPlatformId && (
              <button
                onClick={() =>
                  save.mutate({
                    defaultPlatformFormat:
                      p.defaultPlatformFormat === "digital" ? "physical" : "digital",
                  })
                }
                title="Toggle physical/digital"
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                {p.defaultPlatformFormat === "physical" ? "📦 Physical" : "💾 Digital"}
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">Category colors</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Pick your own color for each category — used on cards, badges, and the dashboard.
          </p>
          <div className="mt-4 space-y-3">
            {(categories ?? []).map((cat) => {
              const s = cat.key;
              const current = p?.statusColors?.[s] ?? cat.color ?? DEFAULT_HEX[s] ?? "#71717a";
              return (
                <div key={s} className="flex items-center gap-3">
                  <input
                    type="color"
                    value={current}
                    onChange={(e) => setStatusColor(s, e.target.value)}
                    className="h-8 w-12 cursor-pointer rounded border border-zinc-700 bg-transparent"
                  />
                  <span
                    className="rounded-full border px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      backgroundColor: `${current}26`,
                      color: current,
                      borderColor: `${current}66`,
                    }}
                  >
                    {cat.label}
                  </span>
                </div>
              );
            })}
          </div>
          {p?.statusColors && (
            <button
              onClick={() => save.mutate({ statusColors: null })}
              className="mt-4 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Reset to defaults
            </button>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-lg font-semibold">Library cards</h2>
          <div className="mt-4 space-y-3">
            <Toggle
              label="Show time-to-beat badge"
              checked={p?.showTimeBadge ?? true}
              onChange={(v) => save.mutate({ showTimeBadge: v })}
            />
            <Toggle
              label="Show platform names"
              checked={p?.showPlatformBadge ?? true}
              onChange={(v) => save.mutate({ showPlatformBadge: v })}
            />
            <Toggle
              label="Show your star rating"
              checked={p?.showRating ?? true}
              onChange={(v) => save.mutate({ showRating: v })}
            />
          </div>

          <BadgeOpacity
            value={p?.badgeOpacity ?? 100}
            categories={categories ?? []}
            prefs={p}
            onChange={(badgeOpacity) => save.mutate({ badgeOpacity })}
          />
        </section>
      </div>
    </Shell>
  );
}

/**
 * How see-through category badges are, everywhere they render. The slider is
 * local while dragging and only saves on release — otherwise every pixel of
 * movement is a PUT.
 */
function BadgeOpacity({
  value,
  categories,
  prefs,
  onChange,
}: {
  value: number;
  categories: CategoryView[];
  prefs: Preferences | undefined;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const current = draft ?? value;
  // preview with the dragged value rather than the saved one
  const preview: Preferences | undefined = prefs
    ? { ...prefs, badgeOpacity: current }
    : undefined;
  const samples = categories.filter((c) => c.key !== "uncategorized").slice(0, 4);

  return (
    <div className="mt-5 border-t border-zinc-800 pt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-300">Category badge opacity</span>
        <span className="text-xs text-zinc-500">{current}%</span>
      </div>
      <input
        type="range"
        min={20}
        max={100}
        step={5}
        value={current}
        onChange={(ev) => setDraft(Number(ev.target.value))}
        onPointerUp={() => {
          if (draft !== null && draft !== value) onChange(draft);
          setDraft(null);
        }}
        onKeyUp={() => {
          if (draft !== null && draft !== value) onChange(draft);
          setDraft(null);
        }}
        className="mt-2 w-full accent-indigo-500"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {samples.map((cat) => {
          const chip = statusChip(cat.key, preview, categories);
          return (
            <span
              key={cat.key}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${chip.className}`}
              style={chip.style}
            >
              {cat.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between">
      <span className="text-sm text-zinc-300">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`h-6 w-11 rounded-full p-0.5 transition ${checked ? "bg-indigo-600" : "bg-zinc-700"}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`}
        />
      </button>
    </label>
  );
}


/** One custom category: rename in place, or delete it. */
function CustomCategoryRow({ id, name, count }: { id: string; name: string; count: number }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(name);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };

  const rename = useMutation({
    mutationFn: (next: string) => api.updateCategory(id, { name: next }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCategory(id),
    onSuccess: refresh,
  });

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next && next !== name) rename.mutate(next);
          else if (!next) setDraft(name);
        }}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") ev.currentTarget.blur();
          if (ev.key === "Escape") setDraft(name);
        }}
        className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
      />
      <span className="shrink-0 text-xs text-zinc-600">{count} games</span>
      <button
        onClick={() => {
          const msg =
            count > 0
              ? `Delete "${name}"? Its ${count} game(s) move to Uncategorized.`
              : `Delete "${name}"?`;
          if (confirm(msg)) remove.mutate();
        }}
        className="shrink-0 px-1 text-xs text-zinc-600 hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}
