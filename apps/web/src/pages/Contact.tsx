import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { contactMessageSchema } from "@gm/shared";
import { api } from "../lib/api.js";
import { MarketingLayout } from "../components/marketing/MarketingLayout.js";
import { SITE_URL, useSeo } from "../lib/seo.js";

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";

const REASONS = [
  {
    title: "Something's broken",
    body: "A match that came back wrong, an import that stalled, a page that won't load. Tell us what you did and what happened — a screenshot helps more than anything.",
  },
  {
    title: "A feature you want",
    body: "Most of what's in the app started as somebody describing a problem they had with their own collection. Platform gaps and import sources are especially welcome.",
  },
  {
    title: "Your data",
    body: "Requests for a copy of your data, or for your account and everything in it to be deleted. We'll confirm by email before anything is removed.",
  },
];

export function ContactPage() {
  useSeo({
    title: "Contact us",
    description:
      "Get in touch with the Game Manager team about a bug, a feature request, a data request, or anything else. Messages go to a person, not a ticket queue.",
    path: "/contact",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "ContactPage",
      name: "Contact Game Manager",
      url: `${SITE_URL}/contact`,
    },
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  // Honeypot — hidden from people, irresistible to bots.
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.sendContactMessage({ name, email, subject, message, website }),
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : "Something went wrong — please try again."),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Validate with the same schema the API uses, so the message you get for a
    // too-short body is identical on both sides.
    const parsed = contactMessageSchema.safeParse({ name, email, subject, message, website });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    send.mutate();
  }

  return (
    <MarketingLayout>
      <div className="mx-auto max-w-3xl">
        <header>
          <p className="text-xs font-semibold tracking-widest text-indigo-400 uppercase">Contact</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-100 sm:text-4xl">
            Get in touch
          </h1>
          <p className="mt-4 text-base leading-7 text-zinc-400">
            Questions, bug reports, feature requests and data requests all arrive in the same
            place, and a person reads them. Include as much detail as you can — for anything that
            went wrong, what you were doing just before it happened is usually the most useful
            sentence in the message.
          </p>
        </header>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {REASONS.map((reason) => (
            <div key={reason.title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">{reason.title}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">{reason.body}</p>
            </div>
          ))}
        </div>

        {send.isSuccess ? (
          <div className="mt-10 rounded-2xl border border-emerald-900 bg-emerald-950/40 p-6">
            <h2 className="text-lg font-semibold text-emerald-200">Message sent</h2>
            <p className="mt-2 text-sm leading-6 text-emerald-100/80">{send.data.message}</p>
            <Link
              to="/guides"
              className="mt-4 inline-block rounded-lg border border-emerald-800 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-900/40"
            >
              Read the guides while you wait
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
            <h2 className="text-lg font-semibold text-zinc-100">Send a message</h2>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-300">Your name</span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-300">Your email</span>
                <input
                  className={inputClass}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={200}
                  required
                />
              </label>
            </div>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">Subject</span>
              <input
                className={inputClass}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
                required
              />
            </label>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium text-zinc-300">Message</span>
              <textarea
                className={`${inputClass} min-h-40 resize-y`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                required
              />
              <span className="mt-1 block text-xs text-zinc-500">
                {message.trim().length} / 4000 characters
              </span>
            </label>

            {/* Honeypot: off-screen rather than display:none, which some bots
                check for, and excluded from tab order and the a11y tree. */}
            <div className="absolute left-[-9999px]" aria-hidden="true">
              <label>
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={send.isPending}
              className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {send.isPending ? "Sending…" : "Send message"}
            </button>

            <p className="mt-4 text-xs leading-5 text-zinc-500">
              We use your email address only to reply to this message. See the{" "}
              <Link to="/privacy" className="underline hover:text-zinc-300">
                Privacy Policy
              </Link>{" "}
              for how that's handled.
            </p>
          </form>
        )}
      </div>
    </MarketingLayout>
  );
}
