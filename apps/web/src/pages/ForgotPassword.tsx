import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { requestPasswordResetSchema } from "@gm/shared";
import { api } from "../lib/api.js";
import { AuthCard, Field, FormError, SubmitButton } from "../components/AuthCard.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = requestPasswordResetSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      await api.requestPasswordReset(parsed.data.email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Reset your password">
      {sent ? (
        <>
          <p className="rounded-lg border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
            If an account exists for that address, a reset link is on its way. It expires in 15
            minutes — check your spam folder if it doesn't show up.
          </p>
          <p className="mt-6 text-center text-sm text-zinc-400">
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">
              Back to sign in
            </Link>
          </p>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            Enter your account's email and we'll send you a link to set a new password.
          </p>
          <form onSubmit={onSubmit}>
            <FormError message={error} />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <SubmitButton label="Send reset link" busy={busy} />
          </form>
          <p className="mt-6 text-center text-sm text-zinc-400">
            Remembered it?{" "}
            <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">
              Sign in
            </Link>
          </p>
        </>
      )}
    </AuthCard>
  );
}
