import type { ReactNode } from "react";
import { Icon } from "@remo/ui";

/**
 * A rare group folded to one row (ADR-236, sketch D4): its name, what it holds now
 * ("нет" when empty) and a chevron. One disclosure pattern for the whole panel, so
 * there is no second kind of "+" or "▸" to learn.
 */
export function InspectorFold({
  label,
  value,
  className,
  children,
}: {
  label: string;
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={`inspector-fold${className ? ` ${className}` : ""}`}>
      <summary>
        <span className="inspector-fold-label">{label}</span>
        <span className="inspector-fold-value">{value}</span>
        <Icon name="chevron-right" size={16} />
      </summary>
      <div className="inspector-fold-body">{children}</div>
    </details>
  );
}
