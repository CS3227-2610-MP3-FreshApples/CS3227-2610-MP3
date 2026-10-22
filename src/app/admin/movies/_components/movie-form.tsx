"use client";

import { FormField, TextField } from "../../../../components/form-primitives";
import { FormFailure, primaryButtonClass } from "../../_components/admin-feedback";
import { failure, type AdminFailure } from "../../_lib/admin-http";
import type { MovieWrite } from "../../_lib/movie-client";
import { movieWriteFromForm, type MovieFormValues } from "../../_lib/movie-form";
import { useAdminForm } from "../../_lib/use-admin-form";

type MovieFormProps = Readonly<{
  initialValues: MovieFormValues;
  submitLabel: string;
  submittingLabel: string;
  /** Sends the converted fields; returns null on success. */
  onSubmit: (movie: MovieWrite) => Promise<AdminFailure | null>;
}>;

/** The writable Movie fields (D-80). Title and synopsis are required; the rest is optional metadata. */
export function MovieForm({ initialValues, onSubmit, submitLabel, submittingLabel }: MovieFormProps) {
  const form = useAdminForm(initialValues);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void form.submit(async (values) => {
      const converted = movieWriteFromForm(values);
      return converted.ok ? onSubmit(converted.value) : failure("validation", converted.fieldErrors);
    });
  }

  return (
    <form className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" method="post" noValidate onSubmit={handleSubmit}>
      <FormFailure details={form.unplacedErrors} message={form.failureMessage} />
      <TextField
        error={form.errorFor("title")}
        hint="Required. Up to 200 characters."
        id="title"
        label="Title"
        onChange={(event) => form.update("title", event.target.value)}
        required
        type="text"
        value={form.values.title}
      />
      <FormField error={form.errorFor("synopsis")} hint="Required. Up to 5,000 characters. Plain text." label="Synopsis" name="synopsis">
        <textarea onChange={(event) => form.update("synopsis", event.target.value)} required rows={6} value={form.values.synopsis} />
      </FormField>
      <TextField
        error={form.errorFor("releaseDate")}
        hint="Optional."
        id="releaseDate"
        label="Release date"
        onChange={(event) => form.update("releaseDate", event.target.value)}
        type="date"
        value={form.values.releaseDate}
      />
      <FormField error={form.errorFor("genres")} hint="Optional. One genre per line, up to 10." label="Genres" name="genres">
        <textarea onChange={(event) => form.update("genres", event.target.value)} rows={3} value={form.values.genres} />
      </FormField>
      <TextField
        error={form.errorFor("director")}
        hint="Optional. Up to 200 characters."
        id="director"
        label="Director"
        onChange={(event) => form.update("director", event.target.value)}
        type="text"
        value={form.values.director}
      />
      <FormField error={form.errorFor("cast")} hint="Optional. One person per line, up to 30." label="Cast" name="cast">
        <textarea onChange={(event) => form.update("cast", event.target.value)} rows={4} value={form.values.cast} />
      </FormField>
      <TextField
        error={form.errorFor("runtimeMinutes")}
        hint="Optional. Whole minutes, 1 to 1,000."
        id="runtimeMinutes"
        inputMode="numeric"
        label="Runtime (minutes)"
        onChange={(event) => form.update("runtimeMinutes", event.target.value)}
        type="text"
        value={form.values.runtimeMinutes}
      />
      <button aria-busy={form.submitting} className={primaryButtonClass} disabled={form.submitting} type="submit">
        {form.submitting ? submittingLabel : submitLabel}
      </button>
    </form>
  );
}
