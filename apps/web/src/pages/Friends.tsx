import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FriendRequest } from "@gm/shared";
import { api } from "../lib/api.js";
import { Shell } from "../components/Shell.js";

/**
 * Friends: your code, requests in both directions, and who you're friends
 * with. Adding someone is a request they have to accept — a code on its own
 * never exposes a library.
 */
export function FriendsPage() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const friends = useQuery({ queryKey: ["friends"], queryFn: () => api.getFriends() });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["friends"] });

  const send = useMutation({
    mutationFn: (c: string) => api.sendFriendRequest(c),
    onSuccess: (res) => {
      setError(null);
      setCode("");
      setNotice(
        res.status === "accepted"
          ? `You and ${res.name} are now friends — they'd already sent you a request.`
          : `Request sent to ${res.name}. You'll see their library once they accept.`,
      );
      invalidate();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  const accept = useMutation({
    mutationFn: (id: string) => api.acceptFriendRequest(id),
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelFriendRequest(id),
    onSuccess: invalidate,
  });
  const unfriend = useMutation({
    mutationFn: (userId: string) => api.removeFriend(userId),
    onSuccess: invalidate,
  });

  const data = friends.data;

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.friendCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked (insecure origin, denied permission) — the code is
      // on screen to read anyway
      setCopied(false);
    }
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold">Friends</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Share your code so people can add you. Requests need accepting before anyone sees your
        library, and your notes are never shared.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-semibold text-zinc-300">Your friend code</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-lg tracking-widest text-indigo-300">
              {data?.friendCode ?? "…"}
            </code>
            <button
              onClick={copyCode}
              disabled={!data}
              className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-sm font-semibold text-zinc-300">Add a friend</p>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (code.trim()) send.mutate(code.trim());
            }}
            className="mt-2 flex gap-2"
          >
            <input
              value={code}
              onChange={(ev) => setCode(ev.target.value)}
              placeholder="GM-XXXX-XXXX"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm uppercase tracking-widest outline-none placeholder:normal-case placeholder:tracking-normal focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!code.trim() || send.isPending}
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
            >
              {send.isPending ? "Sending…" : "Send request"}
            </button>
          </form>
          {notice && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}
          {error && <p className="mt-2 text-xs text-amber-400">{error}</p>}
        </div>
      </div>

      {(data?.incoming.length ?? 0) > 0 && (
        <Section title="Requests for you">
          {data!.incoming.map((r) => (
            <RequestRow key={r.id} request={r}>
              <button
                onClick={() => accept.mutate(r.id)}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold hover:bg-indigo-500"
              >
                Accept
              </button>
              <button
                onClick={() => cancel.mutate(r.id)}
                className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Decline
              </button>
            </RequestRow>
          ))}
        </Section>
      )}

      {(data?.outgoing.length ?? 0) > 0 && (
        <Section title="Waiting on them">
          {data!.outgoing.map((r) => (
            <RequestRow key={r.id} request={r}>
              <button
                onClick={() => cancel.mutate(r.id)}
                className="rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
              >
                Withdraw
              </button>
            </RequestRow>
          ))}
        </Section>
      )}

      <Section title={`Friends${data ? ` (${data.friends.length})` : ""}`}>
        {data?.friends.length === 0 && (
          <p className="text-sm text-zinc-500">
            No friends yet — send someone your code and they can add you.
          </p>
        )}
        {data?.friends.map((f) => (
          <div
            key={f.userId}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-200">{f.name}</p>
              <p className="text-xs text-zinc-500">
                {f.libraryCount} games · <span className="text-indigo-400">{f.gamesInCommon}</span>{" "}
                in common
              </p>
            </div>
            <Link
              to="/friends/$userId"
              params={{ userId: f.userId }}
              className="shrink-0 rounded-lg border border-indigo-500/50 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/20"
            >
              View library
            </Link>
            <button
              onClick={() => {
                if (confirm(`Remove ${f.name} from your friends?`)) unfriend.mutate(f.userId);
              }}
              className="shrink-0 text-xs text-zinc-600 hover:text-red-400"
            >
              Remove
            </button>
          </div>
        ))}
      </Section>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <p className="mb-2 text-sm font-semibold text-zinc-300">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function RequestRow({
  request,
  children,
}: {
  request: FriendRequest;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
      <p className="min-w-0 flex-1 truncate text-sm text-zinc-200">{request.name}</p>
      {children}
    </div>
  );
}
