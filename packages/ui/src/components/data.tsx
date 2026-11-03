import type { ReactNode } from "react";
import { useUiStrings } from "../i18n";
import { Badge } from "./display";
import { cx, forced, type Forced } from "./util";

export interface TableColumn<T> { key: string; label: string; width?: number; align?: "left" | "right" | "center"; numeric?: boolean; render?: (row: T) => ReactNode }

/** Sticky header, no zebra, tabular numbers on the right, row actions last. */
export function Table<T extends { id?: string | number; selected?: boolean }>({ columns, rows, rowActions, caption, maxHeight, rowForce }: { columns: TableColumn<T>[]; rows: T[]; rowActions?: (row: T) => ReactNode; caption?: string; maxHeight?: number; rowForce?: Forced }) {
  const { t } = useUiStrings();
  return (
    <div className="rm-table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="rm-table">
        {caption && <caption className="rm-sr">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key} scope="col" style={{ width: c.width, textAlign: c.align }}>{c.label}</th>)}
            {rowActions && <th className="rm-table-actions"><span className="rm-sr">{t("actions")}</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={cx(r.selected && "is-selected", forced(rowForce))}>
              {columns.map((c) => (
                <td key={c.key} className={cx(c.numeric && "rm-num")} style={{ textAlign: c.align ?? (c.numeric ? "right" : undefined) }}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
              {rowActions && <td className="rm-table-actions">{rowActions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ListItem { id?: string; title: ReactNode; meta?: ReactNode; leading?: ReactNode; trailing?: ReactNode }

export function List({ items }: { items: ListItem[] }) {
  return (
    <ul className="rm-list">
      {items.map((it, i) => (
        <li key={it.id ?? i} className="rm-list-item">
          {it.leading}
          <div className="rm-list-main">
            <div className="rm-list-title">{it.title}</div>
            {it.meta && <div className="rm-list-meta">{it.meta}</div>}
          </div>
          {it.trailing}
        </li>
      ))}
    </ul>
  );
}

/** Right inspector, `inspector-width`: properties, counters, history — nothing that duplicates the canvas. */
export function Panel({ title, actions, width, children }: { title: string; actions?: ReactNode; width?: number; children?: ReactNode }) {
  return (
    <aside className="rm-panel" aria-label={title} style={width ? { width } : undefined}>
      <div className="rm-panel-head"><h2 className="rm-panel-title">{title}</h2>{actions}</div>
      <div className="rm-panel-body">{children}</div>
    </aside>
  );
}

export function PanelSection({ title, children }: { title?: string; children?: ReactNode }) {
  return <section className="rm-panel-section">{title && <h3 className="rm-panel-section-title">{title}</h3>}{children}</section>;
}

export function Property({ label, numeric, children }: { label: string; numeric?: boolean; children?: ReactNode }) {
  return <div className="rm-prop"><span className="rm-prop-k">{label}</span><span className={cx("rm-prop-v", numeric && "rm-num")}>{children}</span></div>;
}

export interface JournalEntry { seq: number; time: string; action: string; agent: string; model: string; tokens: number; cost: number; status: "done" | "pending" | "failed" | "rejected" }

const STATUS = { done: "success", pending: "warning", failed: "danger", rejected: "neutral" } as const;

/** AI journal: newest first, numbers through Intl, status as a word. */
export function JournalList({ entries, maxHeight, currency = "USD" }: { entries: JournalEntry[]; maxHeight?: number; currency?: string }) {
  const { t, locale } = useUiStrings();
  const num = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 3 });
  return (
    <Table<JournalEntry & { id: number }>
      caption={t("journal")} maxHeight={maxHeight}
      rows={entries.map((e) => ({ ...e, id: e.seq }))}
      columns={[
        { key: "seq", label: "#", width: 48, numeric: true },
        { key: "time", label: t("journal.time"), width: 64, numeric: true, align: "left" },
        { key: "action", label: t("journal.action"), render: (r) => (
          <span className="rm-journal-action"><span className="rm-ellipsis" title={r.action}>{r.action}</span><span className="rm-journal-model">{r.agent} · {r.model}</span></span>
        ) },
        { key: "tokens", label: t("journal.tokens"), width: 80, numeric: true, render: (r) => num.format(r.tokens) },
        { key: "cost", label: t("journal.cost"), width: 88, numeric: true, render: (r) => money.format(r.cost) },
        { key: "status", label: t("journal.status"), width: 112, render: (r) => (
          <Badge tone={STATUS[r.status]} icon={r.status === "failed" ? "alert" : r.status === "done" ? "check" : undefined}>{t(`journal.${r.status}`)}</Badge>
        ) },
      ]}
    />
  );
}
