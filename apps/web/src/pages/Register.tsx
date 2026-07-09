import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { registerSchema } from "@gm/shared";
import { authClient } from "../lib/auth.js";
import { AuthCard, Field, FormError, SubmitButton } from "../components/AuthCard.js";

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { error: authError } = await authClient.signUp.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Registration failed");
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit}>
        <FormError message={error} />
        <Field label="Display name" type="text" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field
          label="Password (8+ characters)"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <SubmitButton label="Create account" busy={busy} />
      </form>
      <p className="mt-6 text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-indigo-400 hover:text-indigo-300">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
