import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        <h1 className="mb-1 text-center text-2xl font-bold tracking-tight">
          🎮 Game Manager
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-400">{title}</p>
        {children}
      </div>
      <p className="mt-4 max-w-sm text-center text-xs text-zinc-600">
        By continuing you confirm you are 13 or older and agree to the{" "}
        <Link to="/terms" className="underline hover:text-zinc-400">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link to="/privacy" className="underline hover:text-zinc-400">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}

export function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm font-medium text-zinc-300">{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        required
      />
    </label>
  );
}

export function SubmitButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
    >
      {busy ? "…" : label}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="mb-4 rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}
