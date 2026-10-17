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
    <div>
      <label htmlFor={name}>{label}</label>
      {hint ? <p id={hintId}>{hint}</p> : null}
      {cloneElement(control, {
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
        className: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700${control.props.className ? ` ${control.props.className}` : ""}`,
        id: name,
        name,
      })}
      {error ? <p id={errorId} role="alert">{error}</p> : null}
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

export function TextField({ error, hint, id, label, name, ...inputProps }: TextFieldProps) {
  const fieldName = name ?? id ?? "field";

  return (
    <FormField error={error} hint={hint} label={label} name={fieldName}>
      <input {...inputProps} />
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
