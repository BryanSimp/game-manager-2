import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { loginSchema } from "@gm/shared";
import { authClient } from "../lib/auth.js";
import { AuthCard, Field, FormError, SubmitButton } from "../components/AuthCard.js";

/**
 * Sign in, in one or two steps.
 *
 * The second step only appears for accounts with two-factor turned on, and
 * only on a device that hasn't been trusted in the last 30 days — the whole
 * point of "Trust this device" below. It's rendered in place rather than on
 * its own route: better-auth offers a `twoFactorPage` redirect and warns that
 * it forces a full page reload, which would throw away the email that's
 * already typed to gain nothing.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // second factor
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    const { data, error: authError } = await authClient.signIn.email(parsed.data);
    setBusy(false);
    if (authError) {
      setError(authError.message ?? "Sign in failed");
      return;
    }
    // The password was right, but the account wants a code as well. No
    // session exists yet — one is issued by the verify call below.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setNeedsCode(true);
      return;
    }
    navigate({ to: "/" });
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const entered = code.trim();
    if (!entered) {
      setError("Enter the code from your authenticator app");
      return;
    }
    setBusy(true);
    const { error: verifyError } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: entered, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code: entered, trustDevice });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "That code didn't work");
      setCode("");
      return;
    }
    navigate({ to: "/" });
  }

  if (needsCode) {
    return (
      <AuthCard title="One more step">
        <form onSubmit={onVerify}>
          <FormError message={error} />
          <p className="mb-4 text-sm text-zinc-400">
            {useBackupCode
              ? "Enter one of the backup codes you saved when you turned two-factor on. Each one works once."
              : "This device hasn't signed in before, so we need the six-digit code from your authenticator app."}
          </p>
          <Field
            label={useBackupCode ? "Backup code" : "Authentication code"}
            type="text"
            value={code}
            onChange={setCode}
            autoFocus
            // browsers and iOS offer the code straight from the keyboard bar
            autoComplete="one-time-code"
            inputMode={useBackupCode ? "text" : "numeric"}
            placeholder={useBackupCode ? "xxxxx-xxxxx" : "123456"}
          />
          <label className="mb-4 flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(ev) => setTrustDevice(ev.target.checked)}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 accent-indigo-500"
            />
            Trust this device for 30 days
          </label>
          <SubmitButton label="Verify" busy={busy} />
        </form>
        <p className="mt-6 text-center text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => {
              setUseBackupCode(!useBackupCode);
              setCode("");
              setError(null);
            }}
            className="font-medium text-indigo-400 hover:text-indigo-300"
          >
            {useBackupCode ? "Use my authenticator app instead" : "Lost your phone? Use a backup code"}
          </button>
        </p>
        <p className="mt-2 text-center text-sm text-zinc-400">
          <button
            type="button"
            onClick={() => {
              setNeedsCode(false);
              setCode("");
              setPassword("");
              setError(null);
            }}
            className="text-zinc-500 hover:text-zinc-300"
          >
            ← Sign in as someone else
          </button>
        </p>
      </AuthCard>
    );
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
      <p className="mt-2 text-center text-sm text-zinc-400">
        <Link to="/forgot-password" className="font-medium text-indigo-400 hover:text-indigo-300">
          Forgot your password?
        </Link>
      </p>
    </AuthCard>
  );
}
