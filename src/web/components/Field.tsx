/**
 * Labelled form controls. Every input has a visible label; hints and errors
 * are tied to it with aria-describedby, and errors set aria-invalid.
 */
import { useId, type ComponentProps, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const list = ids.filter(Boolean) as string[];
  return list.length ? list.join(' ') : undefined;
}

interface FieldChrome {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
}

function FieldLabel({ htmlFor, label, optional }: { htmlFor: string; label: ReactNode; optional?: boolean }) {
  return (
    <label className="field-label" htmlFor={htmlFor}>
      {label}
      {optional ? <span className="field-optional"> (optional)</span> : null}
    </label>
  );
}

function FieldMessages({ hintId, errorId, hint, error }: { hintId: string; errorId: string; hint?: ReactNode; error?: string | null }) {
  return (
    <>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TextField({
  label,
  hint,
  error,
  optional,
  prefix,
  className,
  ...input
}: FieldChrome & { prefix?: string } & Omit<ComponentProps<'input'>, 'prefix'>) {
  const id = useId();
  const inputId = input.id ?? id;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <div className={`field ${className ?? ''}`}>
      <FieldLabel htmlFor={inputId} label={label} optional={optional} />
      <div className={prefix ? 'input-affix' : undefined}>
        {prefix ? (
          <span className="input-prefix" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          className="input"
          {...input}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint ? hintId : false, error ? errorId : false)}
        />
      </div>
      <FieldMessages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  className,
  ...input
}: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const inputId = input.id ?? id;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <div className={`field ${className ?? ''}`}>
      <FieldLabel htmlFor={inputId} label={label} optional={optional} />
      <textarea
        className="input textarea"
        rows={3}
        {...input}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : false, error ? errorId : false)}
      />
      <FieldMessages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  options,
  placeholder,
  ...select
}: FieldChrome & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  const inputId = select.id ?? id;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  return (
    <div className={`field ${className ?? ''}`}>
      <FieldLabel htmlFor={inputId} label={label} optional={optional} />
      <select
        className="input select"
        {...select}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : false, error ? errorId : false)}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMessages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
}

/** Checkbox row with a large tap target. `switch` renders it as an on/off toggle. */
export function CheckboxField({
  label,
  description,
  checked,
  onChange,
  disabled,
  asSwitch,
  name,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  asSwitch?: boolean;
  name?: string;
}) {
  const id = useId();
  return (
    <div className={`check ${asSwitch ? 'check-switch' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input
        id={id}
        type="checkbox"
        role={asSwitch ? 'switch' : undefined}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={description ? `${id}-desc` : undefined}
      />
      <span className="check-label">
        {/* The label covers the whole row (CSS) so the tap target stays large. */}
        <label htmlFor={id} className="check-title">
          {label}
        </label>
        {description ? (
          <span className="check-desc" id={`${id}-desc`}>
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** A labelled group of checkboxes (e.g. ensembles). */
export function CheckboxGroup({
  legend,
  hint,
  options,
  selected,
  onChange,
  columns = 2,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: string[];
  selected: string[];
  onChange(next: string[]): void;
  columns?: 1 | 2;
}) {
  const hintId = useId();
  const toggle = (option: string, on: boolean) => {
    const set = new Set(selected);
    if (on) set.add(option);
    else set.delete(option);
    onChange(options.filter((o) => set.has(o)));
  };
  return (
    <fieldset className="fieldset" aria-describedby={hint ? hintId : undefined}>
      <legend className="field-label">{legend}</legend>
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className={`check-grid check-grid-${columns}`}>
        {options.map((o) => (
          <CheckboxField key={o} label={o} checked={selected.includes(o)} onChange={(on) => toggle(o, on)} />
        ))}
      </div>
    </fieldset>
  );
}
