"use client";

import { useState } from "react";

import { FormField, TextField } from "../../../../components/form-primitives";
import { FormFailure, primaryButtonClass, secondaryButtonClass } from "../../_components/admin-feedback";
import type { AdminFailure } from "../../_lib/admin-http";
import { announcementWriteFromForm, type AnnouncementContentWrite } from "../../_lib/announcement-client";
import { useAdminForm } from "../../_lib/use-admin-form";

export type AnnouncementFormValues = Readonly<{
  title: string;
  body: string;
  movieId: string;
}>;

/** One submit button. Each action sends the form's content in its own request; null means success. */
export type AnnouncementFormAction = Readonly<{
  label: string;
  submittingLabel: string;
  run: (content: AnnouncementContentWrite) => Promise<AdminFailure | null>;
}>;

type AnnouncementFormProps = Readonly<{
  actions: readonly AnnouncementFormAction[];
  initialValues: AnnouncementFormValues;
}>;

/** FR-07 title, body and optional Movie reference. The first action is the default (Enter key). */
export function AnnouncementForm({ actions, initialValues }: AnnouncementFormProps) {
  const form = useAdminForm(initialValues);
  const [activeAction, setActiveAction] = useState<number | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const index = Number(submitter?.getAttribute("data-action") ?? "0");
    const action = actions[index] ?? actions[0];
    if (action === undefined) return;
    setActiveAction(index);
    void form.submit((values) => action.run(announcementWriteFromForm(values))).finally(() => setActiveAction(null));
  }

  return (
    <form className="space-y-6" method="post" noValidate onSubmit={handleSubmit}>
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
      <FormField error={form.errorFor("body")} hint="Required. Up to 5,000 characters. Plain text." label="Body" name="body">
        <textarea onChange={(event) => form.update("body", event.target.value)} required rows={8} value={form.values.body} />
      </FormField>
      <TextField
        error={form.errorFor("movieId")}
        hint="Optional. The ID shown on the movie’s edit page. Leave empty for no movie."
        id="movieId"
        label="Related movie ID"
        onChange={(event) => form.update("movieId", event.target.value)}
        spellCheck={false}
        type="text"
        value={form.values.movieId}
      />
      <div className="flex flex-wrap gap-3">
        {actions.map((action, index) => (
          <button
            aria-busy={activeAction === index}
            className={index === 0 ? primaryButtonClass : secondaryButtonClass}
            data-action={index}
            disabled={form.submitting}
            key={action.label}
            type="submit"
          >
            {activeAction === index ? action.submittingLabel : action.label}
          </button>
        ))}
      </div>
    </form>
  );
}
