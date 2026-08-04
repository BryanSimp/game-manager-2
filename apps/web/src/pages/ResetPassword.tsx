import { useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { resetPasswordSchema } from "@gm/shared";
import { api } from "../lib/api.js";
import { AuthCard, Field, FormError, SubmitButton } from "../components/AuthCard.js";

export function ResetPasswordPage() {
  const { token } = useSearch({ from: "/reset-password" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(parsed.data.token, parsed.data.password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Set a new password">
        <p className="rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          This page needs the link from your reset email — it seems incomplete.
        </p>
        <p className="mt-6 text-center text-sm text-zinc-400">
          <Link to="/forgot-password" className="font-medium text-indigo-400 hover:text-indigo-300">
            Request a new link
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set a new password">
      {done ? (
        <>
          <p className="rounded-lg border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
            Password updated. You've been signed out everywhere — sign in with the new one.
          </p>
          <p className="mt-6 text-center text-sm text-zinc-400">
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">
              Go to sign in
            </Link>
          </p>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          <FormError message={error} />
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
          <Field
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          <SubmitButton label="Reset password" busy={busy} />
        </form>
      )}
    </AuthCard>
  );
}
