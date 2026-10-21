"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { resolveAuthDestination, submitLogin } from "../../../components/auth-client";
import { TextField } from "../../../components/form-primitives";
import { LiveRegion, StatusMessage } from "../../../components/status-primitives";

export default function SignInPage() {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;

    const form = new FormData(event.currentTarget);
    const email = form.get("email");
    const password = form.get("password");
    if (typeof email !== "string" || typeof password !== "string") return;

    submissionInFlight.current = true;
    setSubmitting(true);
    setMessage("Signing in…");
    try {
      const result = await submitLogin({ email, password });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      const destination = resolveAuthDestination(result.account);
      if (destination === null) {
        setMessage("We couldn’t sign you in. Check your email and password.");
        return;
      }
      window.location.assign(destination);
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto max-w-md py-8 sm:py-12">
      <div className="space-y-8">
        <header className="space-y-3">
          <p className="text-sm font-medium text-blue-700">FreshApples Movie Reviews</p>
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p>Use your account to write reviews and manage your activity.</p>
        </header>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <LiveRegion message={message} />
          {message && !message.endsWith("…") ? <StatusMessage status="error">{message}</StatusMessage> : null}
          <form className="mt-6 space-y-6" method="post" onSubmit={handleSubmit}>
            <TextField autoComplete="email" id="email" label="Email address" required type="email" />
            <TextField autoComplete="current-password" id="password" label="Password" required type="password" />
            <button
              aria-busy={submitting}
              className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p>
          New to FreshApples? <Link href="/register">Create an account</Link>.
        </p>
      </div>
    </section>
  );
}
