"use client";

import { useRef, useState } from "react";

import type { AdminFailure, FieldErrors } from "./admin-http";

/**
 * Text-only form state for the Admin editors. Values are never cleared by a failed submission, so the
 * Admin's text survives any recoverable error (product 5.3). `run` returns null on success.
 */
export function useAdminForm<V extends Readonly<Record<string, string>>>(initialValues: V) {
  const [values, setValues] = useState<V>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failureMessage, setFailureMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  function update(field: keyof V & string, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function submit(run: (values: V) => Promise<AdminFailure | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFailureMessage("");
    try {
      const failure = await run(values);
      if (failure !== null) {
        setFailureMessage(failure.message);
        setFieldErrors(failure.fieldErrors ?? {});
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  /** The error text for one field, or undefined; ties the message to its control through FormField. */
  function errorFor(field: keyof V & string): string | undefined {
    return fieldErrors[field]?.join(" ");
  }

  /** Field errors the form has no control for (for example `request`), shown in the form summary. */
  const unplacedErrors = Object.entries(fieldErrors)
    .filter(([field]) => !(field in initialValues))
    .map(([field, messages]) => `${field}: ${messages.join(" ")}`);

  return { values, update, submit, submitting, errorFor, failureMessage, unplacedErrors } as const;
}
