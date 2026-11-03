import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { IconName } from "../icons";
import { Icon } from "./basics";
import { cx, forced, type Forced } from "./util";

interface FieldOwn { label?: string; hint?: string; error?: string; success?: string; readOnly?: boolean }

function Field({ id, label, hint, error, success, readOnly, children }: FieldOwn & { id: string; children: ReactNode }) {
  return (
    <div className={cx("rm-field", error && "is-error", success && "is-success", readOnly && "is-readonly")}>
      {label && <label className="rm-field-label" htmlFor={id}>{label}</label>}
      {children}
      {error ? (
        <div className="rm-field-msg rm-field-error" id={`${id}-msg`} role="alert"><Icon name="alert" size={14} />{error}</div>
      ) : success ? (
        <div className="rm-field-msg rm-field-success" id={`${id}-msg`}><Icon name="check" size={14} />{success}</div>
      ) : hint ? (
        <div className="rm-field-msg" id={`${id}-msg`}>{hint}</div>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, p: FieldOwn) => (p.error || p.hint || p.success ? `${id}-msg` : undefined);

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix">, FieldOwn {
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: "compact" | "default";
  force?: Forced;
}

export function Input({ label, hint, error, success, prefix, suffix, size, force, id: given, type = "text", ...rest }: InputProps) {
  const auto = useId();
  const id = given ?? auto;
  const own = { label, hint, error, success, readOnly: rest.readOnly };
  return (
    <Field id={id} {...own}>
      <div className={cx("rm-input", size && `rm-${size}`, rest.disabled && "is-disabled", forced(force))}>
        {type === "search" && !prefix && <Icon name="search" />}
        {prefix && <span className="rm-input-affix">{prefix}</span>}
        <input type={type} {...rest} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, own)} />
        {suffix && <span className="rm-input-affix">{suffix}</span>}
      </div>
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldOwn {
  force?: Forced;
}

export function Textarea({ label, hint, error, success, force, id: given, rows = 3, ...rest }: TextareaProps) {
  const auto = useId();
  const id = given ?? auto;
  const own = { label, hint, error, success, readOnly: rest.readOnly };
  return (
    <Field id={id} {...own}>
      <div className={cx("rm-input", "rm-textarea", rest.disabled && "is-disabled", forced(force))}>
        <textarea rows={rows} {...rest} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, own)} />
      </div>
    </Field>
  );
}

export type SelectOption = string | { value: string; label: string; disabled?: boolean };

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">, FieldOwn {
  options: SelectOption[];
  size?: "compact" | "default";
}

/** Native-first single select: keyboard and screen readers work without extra code. */
export function Select({ label, hint, error, options, size, id: given, ...rest }: SelectProps) {
  const auto = useId();
  const id = given ?? auto;
  const own = { label, hint, error };
  return (
    <Field id={id} {...own}>
      <div className={cx("rm-input", "rm-select", size && `rm-${size}`, rest.disabled && "is-disabled")}>
        <select {...rest} id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, own)}>
          {options.map((o) => {
            const v = typeof o === "string" ? { value: o, label: o } : o;
            return <option key={v.value} value={v.value} disabled={v.disabled}>{v.label}</option>;
          })}
        </select>
        <Icon name="chevron-down" />
      </div>
    </Field>
  );
}

export interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: ReactNode;
  hint?: string;
  force?: Forced;
}

export function Checkbox({ label, hint, indeterminate, force, className, ...rest }: CheckProps & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; });
  return (
    <label className={cx("rm-check", rest.disabled && "is-disabled", forced(force), className)}>
      <input type="checkbox" ref={ref} {...rest} />
      <span className="rm-check-box" aria-hidden="true"><Icon name={indeterminate ? "minus" : "check"} size={12} /></span>
      {label != null && <span className="rm-check-text">{label}{hint && <span className="rm-check-hint">{hint}</span>}</span>}
    </label>
  );
}

export function Radio({ label, hint, force, className, ...rest }: CheckProps) {
  return (
    <label className={cx("rm-check", "rm-radio", rest.disabled && "is-disabled", forced(force), className)}>
      <input type="radio" {...rest} />
      <span className="rm-check-box" aria-hidden="true" />
      {label != null && <span className="rm-check-text">{label}{hint && <span className="rm-check-hint">{hint}</span>}</span>}
    </label>
  );
}

/** Applies immediately — never inside a form with a Save button. */
export function Switch({ label, force, className, ...rest }: CheckProps) {
  return (
    <label className={cx("rm-switch", rest.disabled && "is-disabled", forced(force), className)}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="rm-switch-track" aria-hidden="true"><span className="rm-switch-thumb" /></span>
      {label != null && <span className="rm-check-text">{label}</span>}
    </label>
  );
}

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /**
   * The accessible name when the visible label is a diagram (a dash sample, a line width).
   * A word still names the choice, so a screen reader does not hear an empty radio.
   */
  ariaLabel?: string;
}

/**
 * A choice of 2–5 options that applies at once (ТЗ §5.3).
 *
 * Native radios, visually one bar: keyboard and screen readers get a real radio group
 * without re-implementing arrow navigation.
 */
export function Segmented({
  options,
  value,
  onChange,
  label,
  name,
  className,
}: {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
  className?: string;
}) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <div className={cx("rm-segmented", className)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label
          key={option.value}
          className={cx(
            "rm-segment",
            option.value === value && "is-selected",
            option.disabled && "is-disabled",
          )}
        >
          <input
            type="radio"
            name={group}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            aria-label={option.ariaLabel}
            onChange={() => onChange(option.value)}
          />
          {option.icon && <Icon name={option.icon} size={16} />}
          <span className="rm-segment-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export interface ChoiceCardOption {
  value: string;
  title: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

/**
 * Cards for a small choice whose consequences matter (ТЗ §5.3): anonymity, a scope, a
 * template. The whole card is the radio; the check mark shows the current one.
 */
export function ChoiceCard({
  options,
  value,
  onChange,
  label,
  name,
  columns = 2,
  className,
}: {
  options: ChoiceCardOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  name?: string;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <div
      className={cx("rm-choicecards", className)}
      role="radiogroup"
      aria-label={label}
      style={{ "--rm-choice-cols": columns } as React.CSSProperties}
    >
      {options.map((option) => {
        const hintId = option.hint ? `${group}-${option.value}-hint` : undefined;
        return (
        <label
          key={option.value}
          className={cx(
            "rm-choicecard",
            option.value === value && "is-selected",
            option.disabled && "is-disabled",
          )}
        >
          <input
            type="radio"
            name={group}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            aria-describedby={hintId}
            onChange={() => onChange(option.value)}
          />
          <span className="rm-choicecard-head">
            {option.icon && <Icon name={option.icon} size={16} />}
            <span className="rm-choicecard-title">{option.title}</span>
            <span className="rm-choicecard-check" aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
          </span>
          {option.hint && <span className="rm-choicecard-hint" id={hintId}>{option.hint}</span>}
        </label>
        );
      })}
    </div>
  );
}
