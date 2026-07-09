import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { loginSchema } from "@gm/shared";
import { authClient } from "../lib/auth.js";
import { AuthCard, Field, FormError, SubmitButton } from "../components/AuthCard.js";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error: authError } = await authClient.signIn.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Sign in failed");
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <AuthCard title="Sign in to your library">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <SubmitButton label="Sign in" busy={busy} />
      </form>
      <p className="mt-6 text-center text-sm text-zinc-400">
        No account?{" "}
        <Link to="/register" className="font-medium text-indigo-400 hover:text-indigo-300">
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
