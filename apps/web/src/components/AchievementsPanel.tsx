import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

/** Steam achievements + playtime for a library entry. Renders nothing until synced. */
export function AchievementsPanel({ entryId }: { entryId: string }) {
  const achievements = useQuery({
    queryKey: ["achievements", entryId],
    queryFn: () => api.getEntryAchievements(entryId),
  });

  const data = achievements.data;
  if (!data || (data.total === 0 && data.steamPlaytimeMinutes == null)) return null;

  const pct = data.total > 0 ? Math.round((data.unlocked / data.total) * 100) : 0;

  return (
    <div className="mt-6 max-w-2xl">
      <div className="mb-2 flex items-center gap-3">
        <p className="text-sm font-semibold text-zinc-300">Steam</p>
        {data.steamPlaytimeMinutes != null && data.steamPlaytimeMinutes > 0 && (
          <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-300">
            ⏱ {formatPlaytime(data.steamPlaytimeMinutes)} played
          </span>
        )}
        {data.total > 0 && (
          <span className="text-xs text-zinc-500">
            {data.unlocked}/{data.total} achievements ({pct}%)
          </span>
        )}
      </div>

      {data.total > 0 && (
        <>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.achievements.map((a) => {
              const icon = a.unlocked ? a.iconUrl : (a.iconGrayUrl ?? a.iconUrl);
              return (
                <div
                  key={a.id}
                  title={`${a.name}${a.description ? ` — ${a.description}` : ""}${
                    a.unlockedAt ? `\nUnlocked ${new Date(a.unlockedAt).toLocaleDateString()}` : ""
                  }`}
                  className={`h-10 w-10 overflow-hidden rounded-md border ${
                    a.unlocked ? "border-emerald-700" : "border-zinc-800 opacity-40"
                  } bg-zinc-800`}
                >
                  {icon ? (
                    <img src={icon} alt={a.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-500">
                      🏆
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
