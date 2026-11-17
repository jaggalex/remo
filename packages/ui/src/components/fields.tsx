import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
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


/**
 * A bounded number that can be typed, stepped or scrubbed by its label.
 *
 * Scrubbing is the coarse path and typing is the exact one: a click still puts a caret in
 * the field, so the gesture never takes the keyboard away. The label is the scrub track
 * because it costs no room in an inspector; the steppers stay out of the Tab order.
 */
export interface NumberFieldProps {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  largeStep?: number;
  suffix?: string;
  /** An empty field is a value of its own, such as Auto. */
  allowEmpty?: boolean;
  /**
   * Names the empty value, such as Auto. While it shows, the unit is hidden: "Auto px"
   * would read as a size in pixels.
   */
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
  id?: string;
  size?: "compact" | "default";
  increaseLabel: string;
  decreaseLabel: string;
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  largeStep = 10,
  suffix,
  allowEmpty,
  placeholder,
  disabled,
  hint,
  id: given,
  size,
  increaseLabel,
  decreaseLabel,
}: NumberFieldProps) {
  const auto = useId();
  const id = given ?? auto;
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value == null ? "" : String(Math.round(value)));
  const [drag, setDrag] = useState<{ startX: number; from: number; value: number } | null>(null);

  useEffect(() => {
    if (!drag) setDraft(value == null ? "" : String(Math.round(value)));
  }, [value, drag]);

  const clamp = (next: number) =>
    Math.round(Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next)));

  const commit = (next: number | null) => {
    if (next == null) {
      if (allowEmpty) onCommit(null);
      setDraft(allowEmpty ? "" : value == null ? "" : String(Math.round(value)));
      return;
    }
    if (!Number.isFinite(next)) return;
    const clamped = clamp(next);
    onCommit(clamped);
    setDraft(String(clamped));
  };

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) {
      commit(null);
      return;
    }
    const next = Number(text);
    if (!Number.isFinite(next)) {
      setDraft(value == null ? "" : String(Math.round(value)));
      return;
    }
    commit(next);
  };

  const stepBy = (delta: number) => {
    if (disabled) return;
    commit((value ?? min ?? 0) + delta);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const from = value ?? min ?? 0;
    setDrag({ startX: event.clientX, from, value: from });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const factor = event.shiftKey ? largeStep : step;
    const next = clamp(drag.from + (event.clientX - drag.startX) * factor);
    setDraft(String(next));
    setDrag({ ...drag, value: next });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const next = drag.value;
    const moved = next !== Math.round(drag.from);
    setDrag(null);
    if (moved) onCommit(next);
    else input.current?.focus();
  };

  const own = {
    role: "spinbutton",
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": value ?? undefined,
    "aria-label": label,
  } as const;

  return (
    <div className={cx("rm-number", size && `rm-${size}`, disabled && "is-disabled")}>
      <span
        className="rm-number-label"
        title={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
      >
        {label}
      </span>
      <div className={cx("rm-input", "rm-number-box", size && `rm-${size}`, disabled && "is-disabled")}>
        <input
          ref={input}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...own}
          onChange={(event) => setDraft(event.currentTarget.value.replace(/[^0-9]/g, ""))}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value == null ? "" : String(Math.round(value)));
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              stepBy(event.key === "ArrowUp" ? (event.shiftKey ? largeStep : step) : -(event.shiftKey ? largeStep : step));
            } else if (event.key === "Home" && min != null) {
              event.preventDefault();
              commit(min);
            } else if (event.key === "End" && max != null) {
              event.preventDefault();
              commit(max);
            }
          }}
        />
        {suffix && !(placeholder && draft === "") && <span className="rm-input-affix">{suffix}</span>}
        <span className="rm-number-steps">
          <button
            type="button"
            className="rm-number-step"
            tabIndex={-1}
            aria-label={decreaseLabel}
            disabled={disabled || (value != null && min != null && value <= min)}
            onClick={() => stepBy(-step)}
          >
            <Icon name="minus" size={12} />
          </button>
          <button
            type="button"
            className="rm-number-step"
            tabIndex={-1}
            aria-label={increaseLabel}
            disabled={disabled || (value != null && max != null && value >= max)}
            onClick={() => stepBy(step)}
          >
            <Icon name="plus" size={12} />
          </button>
        </span>
      </div>
      {hint && <div className="rm-number-hint" id={`${id}-hint`}>{hint}</div>}
    </div>
  );
}
