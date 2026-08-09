import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth.js";

/**
 * Turning two-factor sign-in on and off.
 *
 * TOTP only. An emailed code would be the obvious alternative and is the
 * wrong one here: this instance's mail is optional (Resend's default sender
 * only delivers to the Resend account's own owner), so an operator with no
 * verified domain would be arming a lock whose key never arrives. An
 * authenticator app needs no configuration and nothing to be up at sign-in
 * time.
 *
 * Three deliberate shapes to the flow:
 *
 *  - **Enabling doesn't take effect until a code proves it.** better-auth is
 *    configured without `skipVerificationOnEnable`, so the secret is stored
 *    unverified until the first correct code. Mistyping the key into your
 *    authenticator therefore fails here, in a form you can retry, rather than
 *    at the next sign-in when it's a lockout.
 *  - **Backup codes are shown once per set.** They're the recovery path for a
 *    lost phone, so a set that's been mislaid is no recovery path at all —
 *    "New backup codes" issues a fresh set (and voids the old one) without
 *    disturbing the authenticator app, which is why regenerating skips the
 *    scan step entirely.
 *  - **The password is asked for on every change.** better-auth requires it,
 *    and it's what stops a borrowed unlocked laptop from silently adding or
 *    removing a factor.
 */

/** Renders an otpauth:// URI as an inline SVG QR code. */
function QrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // dynamic import: the encoder is only needed by the handful of people who
    // open this card, so Vite keeps it out of the main bundle
    import("qrcode-generator")
      .then(({ default: qrcode }) => {
        if (cancelled) return;
        // type 0 = pick the smallest version that fits; "M" recovery is the
        // usual choice for on-screen codes, where nothing is smudged
        const qr = qrcode(0, "M");
        qr.addData(value);
        qr.make();
        setSvg(qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) {
    // not fatal: the secret below this is the manual-entry path every
    // authenticator app supports
    return (
      <p className="text-xs text-amber-400">
        Couldn't draw the QR code — enter the setup key below by hand instead.
      </p>
    );
  }
  if (!svg) return <div className="h-44 w-44 animate-pulse rounded-lg bg-zinc-800" />;
  return (
    <div
      // white plate behind it: phone cameras read dark-on-light far more
      // reliably than the inverse, and this card sits on zinc-900
      className="h-44 w-44 rounded-lg bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The `secret=` parameter, pulled back out for manual entry. */
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked (insecure origin) — the text is on screen anyway */
        }
      }}
      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
    >
      {done ? "Copied" : label}
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-indigo-500";

type Step = "idle" | "password" | "scan" | "codes";
/** What the one password field is being asked for. */
type Intent = "enable" | "disable" | "regenerate";

const PASSWORD_PROMPT: Record<Intent, { verb: string; danger: boolean }> = {
  enable: { verb: "Continue", danger: false },
  disable: { verb: "Turn it off", danger: true },
  regenerate: { verb: "Replace my codes", danger: true },
};

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("idle");
  const [intent, setIntent] = useState<Intent>("enable");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("idle");
    setIntent("enable");
    setPassword("");
    setCode("");
    setTotpUri(null);
    setBackupCodes([]);
    setShowSecret(false);
    setError(null);
  }

  function begin(next: Intent) {
    setIntent(next);
    setError(null);
    setStep("password");
  }

  /** Step 1 — the password, in exchange for whatever `intent` asked for. */
  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    if (intent === "disable") {
      const { error: err } = await authClient.twoFactor.disable({ password });
      setBusy(false);
      if (err) {
        setError(err.message ?? "Couldn't turn two-factor off");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["me"] });
      reset();
      return;
    }

    if (intent === "regenerate") {
      const { data, error: err } = await authClient.twoFactor.generateBackupCodes({ password });
      setBusy(false);
      if (err || !data) {
        setError(err?.message ?? "Couldn't make new codes — is that the right password?");
        return;
      }
      setBackupCodes(data.backupCodes);
      setPassword("");
      // straight to the codes: there's no secret to re-scan, the
      // authenticator app is untouched
      setStep("codes");
      return;
    }

    const { data, error: err } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (err || !data) {
      setError(err?.message ?? "Couldn't start setup — is that the right password?");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
    setStep("scan");
  }

  /** Step 2 — a code from the app, which is what actually arms it. */
  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    // this device just proved it holds the secret; asking it for a code again
    // on the next sign-in would be theatre
    const { error: err } = await authClient.twoFactor.verifyTotp({
      code: code.trim(),
      trustDevice: true,
    });
    setBusy(false);
    if (err) {
      setError(err.message ?? "That code didn't match — check your app's clock and try again");
      setCode("");
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["me"] });
    setStep("codes");
  }

  function downloadCodes() {
    const body = [
      "Game Manager — two-factor backup codes",
      "Each code works once. Keep them somewhere other than your phone.",
      "",
      ...backupCodes,
      "",
      `Generated ${new Date().toLocaleString()}`,
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "game-manager-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const secret = totpUri ? secretFromUri(totpUri) : null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Two-factor sign-in</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Ask for a code from an authenticator app when signing in on a device we haven't seen
            before. Your password on its own stops being enough.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${
            enabled
              ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
              : "border-zinc-700 bg-zinc-800 text-zinc-400"
          }`}
        >
          {enabled ? "On" : "Off"}
        </span>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {step === "idle" && (
        <div className="mt-4">
          {enabled ? (
            <>
              <p className="text-sm text-zinc-400">
                A trusted device stays trusted for 30 days. Signing out doesn't clear that —
                clearing the site's cookies does.
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                Lost track of your backup codes? Make a new set. The old ones stop working the
                moment you do.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  onClick={() => begin("regenerate")}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                >
                  New backup codes
                </button>
                <button
                  onClick={() => begin("disable")}
                  className="rounded-lg border border-red-900 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-950"
                >
                  Turn off two-factor
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500">
                You'll need an authenticator app — Google Authenticator, 1Password, Aegis, Ente
                Auth and Bitwarden all work.
              </p>
              <button
                onClick={() => begin("enable")}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Set up two-factor
              </button>
            </>
          )}
        </div>
      )}

      {step === "password" && (
        <form onSubmit={onStart} className="mt-4">
          {intent === "regenerate" && (
            <p className="mb-3 text-sm text-amber-400">
              This replaces every code at once — anything you wrote down or saved before will stop
              working. Your authenticator app is unaffected.
            </p>
          )}
          <label className="block text-sm font-medium text-zinc-300">
            Confirm your password
            <input
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              autoComplete="current-password"
              autoFocus
              required
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
                PASSWORD_PROMPT[intent].danger
                  ? "bg-red-700 hover:bg-red-600"
                  : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {busy ? "…" : PASSWORD_PROMPT[intent].verb}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === "scan" && totpUri && (
        <div className="mt-4">
          <p className="text-sm text-zinc-300">
            Scan this with your authenticator app, then enter the six-digit code it shows.
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-5">
            <QrCode value={totpUri} />
            <div className="min-w-48 flex-1">
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="text-xs text-indigo-400 hover:text-indigo-300"
              >
                {showSecret ? "Hide setup key" : "Can't scan it? Enter a key instead"}
              </button>
              {showSecret && secret && (
                <div className="mt-2">
                  <code className="block break-all rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
                    {secret}
                  </code>
                  <div className="mt-2">
                    <CopyButton text={secret} label="Copy key" />
                  </div>
                </div>
              )}

              <form onSubmit={onVerify} className="mt-4">
                <label className="block text-sm font-medium text-zinc-300">
                  Code from the app
                  <input
                    value={code}
                    onChange={(ev) => setCode(ev.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={8}
                    required
                    className={`mt-1 ${inputClass} [font-variant-numeric:tabular-nums]`}
                  />
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {busy ? "…" : "Verify and turn on"}
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {step === "codes" && (
        <div className="mt-4">
          <p className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
            {intent === "regenerate"
              ? "New backup codes. The old set no longer works — replace anywhere you'd saved them."
              : "Two-factor is on. Save these backup codes now — this is the only time they're shown."}
          </p>
          <p className="mt-3 text-sm text-zinc-400">
            Each one signs you in once if you lose your phone. Keep them somewhere that isn't your
            phone.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-xs text-zinc-300 sm:grid-cols-3">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={backupCodes.join("\n")} label="Copy all" />
            <button
              type="button"
              onClick={downloadCodes}
              className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Download
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500"
            >
              I've saved them
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
