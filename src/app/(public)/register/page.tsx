"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { submitRegistration, type RegistrationInput } from "../../../components/auth-client";
import { TextField } from "../../../components/form-primitives";
import { LiveRegion, StatusMessage } from "../../../components/status-primitives";

export default function RegisterPage() {
  const [values, setValues] = useState<RegistrationInput>({ displayName: "", email: "", password: "", confirmPassword: "" });
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const submissionInFlight = useRef(false);

  function updateValue(field: keyof RegistrationInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;

    submissionInFlight.current = true;
    setSubmitting(true);
    setCreated(false);
    setFieldErrors({});
    setMessage("Creating your account…");
    try {
      const result = await submitRegistration(values);
      if (!result.ok) {
        setMessage(result.message ?? "Please correct the highlighted fields and try again.");
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      setValues((current) => ({ ...current, password: "" }));
      setCreated(true);
      setMessage("Your account is ready.");
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
          <h1 className="text-3xl font-semibold tracking-tight">Create an account</h1>
          <p>Join the community to share thoughtful movie reviews.</p>
        </header>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <LiveRegion message={message} />
          {created ? (
            <StatusMessage status="success">
              Account created. <Link href="/sign-in">Sign in</Link> to continue.
            </StatusMessage>
          ) : (
            <form className="space-y-6" method="post" onSubmit={handleSubmit}>
            {message && !message.endsWith("…") ? <StatusMessage status="error">{message}</StatusMessage> : null}
            <TextField
              autoComplete="name"
              error={fieldErrors.displayName?.join(" ")}
              id="displayName"
              label="Display name"
              onChange={(event) => updateValue("displayName", event.target.value)}
              required
              type="text"
              value={values.displayName}
            />
            <TextField
              autoComplete="email"
              error={fieldErrors.email?.join(" ")}
              id="email"
              label="Email address"
              onChange={(event) => updateValue("email", event.target.value)}
              required
              type="email"
              value={values.email}
            />
            <TextField
              autoComplete="new-password"
              error={fieldErrors.password?.join(" ")}
              hint="12–128 characters, including at least one number and one special character."
              id="password"
              label="Password"
              onChange={(event) => updateValue("password", event.target.value)}
              required
              type="password"
              value={values.password}
            />
            <TextField
              autoComplete="new-password"
              error={fieldErrors.confirmPassword?.join(" ")}
              id="confirmPassword"
              label="Repeat password"
              onChange={(event) => updateValue("confirmPassword", event.target.value)}
              required
              type="password"
              value={values.confirmPassword}
            />
            <button
              aria-busy={submitting}
              className="min-h-11 rounded-lg bg-blue-700 px-4 py-2 font-medium text-white transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {submitting ? "Creating account…" : "Create account"}
            </button>
            </form>
          )}
        </div>

        <p>
          Already have an account? <Link href="/sign-in">Sign in</Link>.
        </p>
      </div>
    </section>
  );
}
