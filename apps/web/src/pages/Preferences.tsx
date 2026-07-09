import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GAME_STATUSES, type GameStatus, type Preferences } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";
import { STATUS_META } from "../lib/format.js";

const DEFAULT_HEX: Record<GameStatus, string> = {
  wishlist: "#38bdf8",
  backlog: "#fbbf24",
  playing: "#818cf8",
  finished: "#34d399",
  dropped: "#fb7185",
};

export function PreferencesPage() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ["preferences"], queryFn: () => api.getPreferences() });

  const save = useMutation({
    mutationFn: (patch: Partial<Preferences>) => api.savePreferences(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["preferences"] }),
  });

  const p = prefs.data;

  function setStatusColor(status: GameStatus, hex: string) {
    save.mutate({ statusColors: { ...(p?.statusColors ?? {}), [status]: hex } });
  }

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-bold">Preferences</h1>

      <section className="mb-6 max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <h2 className="text-lg font-semibold">Status colors</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Pick your own color for each status — used on cards, badges, and the dashboard.
        </p>
        <div className="mt-4 space-y-3">
          {GAME_STATUSES.map((s) => {
            const current = p?.statusColors?.[s] ?? DEFAULT_HEX[s];
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
                  {STATUS_META[s].label}
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

      <section className="max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
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
        </div>
      </section>
    </Shell>
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
