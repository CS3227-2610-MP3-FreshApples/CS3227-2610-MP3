import { cloneElement, type InputHTMLAttributes, type ReactElement } from "react";

export type FormFieldProps = Readonly<{
  children: ReactElement;
  error?: string;
  hint?: string;
  label: string;
  name: string;
}>;

export function FormField({ children, error, hint, label, name }: FormFieldProps) {
  const control = children as ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ");

  return (
    <div className="space-y-2">
      <label htmlFor={name}>{label}</label>
      {hint ? <p className="text-sm leading-6 text-slate-600" id={hintId}>{hint}</p> : null}
      {cloneElement(control, {
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        className: `min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm transition-colors placeholder:text-slate-500 focus:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2${error ? " border-red-500" : ""}${control.props.className ? ` ${control.props.className}` : ""}`,
        id: name,
        name,
      })}
      {error ? <p className="text-sm font-medium text-red-800" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

type TextFieldProps = Readonly<{
  error?: string;
  id?: string;
  hint?: string;
  label: string;
  name?: string;
}> & Omit<InputHTMLAttributes<HTMLInputElement>, "aria-describedby" | "id" | "name">;

export function TextField({ autoComplete, error, hint, id, label, name, ...inputProps }: TextFieldProps) {
  const fieldName = name ?? id ?? "field";

  return (
    <FormField error={error} hint={hint} label={label} name={fieldName}>
      <input {...inputProps} autoComplete={autoComplete} />
    </FormField>
  );
}

type RatingInputProps = Readonly<{
  id: string;
  value: number;
}>;

export function RatingInput({ id, value }: RatingInputProps) {
  return (
    <div>
      <label htmlFor={id}>Rating (out of 10)</label>
      <input
        aria-label="Rating (out of 10)"
        className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        id={id}
        max={10}
        min={1}
        name={id}
        type="number"
        value={value}
        readOnly
      />
      <output aria-label={`Rating ${value}/10`}>
        {value}/10
      </output>
    </div>
  );
}
