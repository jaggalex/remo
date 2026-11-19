import { Component, type ErrorInfo, type ReactNode } from "react";
import { Banner, EmptyState } from "@remo/ui";
import { useI18n } from "./i18n";

/**
 * Where a render failure stops (ADR-171).
 *
 * A room is shared: the document every client renders is the same, so a value one
 * component cannot handle used to unmount the whole tree for everyone in the room at
 * once — a white page with no way back but a reload that failed again. Two scopes now
 * contain it:
 *
 * - `room` wraps the screen. The person keeps a way out (reload, the organisation home)
 *   instead of a blank page.
 * - `panel` wraps a side panel, the inspector or a dialog. The canvas and the top bar keep
 *   working; the failed panel shows one line and a retry. `resetKey` clears the failure
 *   when what the panel shows changes (another selection, another dialog), so one bad
 *   object does not keep the panel closed for the rest of the session.
 *
 * This catches render and lifecycle errors only — that is what React offers. Painting
 * runs outside render and has its own per-object boundary in `drawWidget`.
 */
type Scope = "room" | "panel";

interface Props {
  scope: Scope;
  resetKey?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: string | undefined;
}

export class Contained extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new subject for the panel is a fresh attempt; the old failure was about the old one.
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The stack is what a bug report needs; the person sees the fallback, not this.
    console.error(`[remo] ${this.props.scope} failed to render`, error, info.componentStack);
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return this.props.scope === "room" ? <RoomFallback /> : <PanelFallback onRetry={this.retry} />;
  }
}

function RoomFallback() {
  const { t } = useI18n();
  return (
    <main className="contained-room">
      <EmptyState
        icon="alert"
        title={t("contained.room.title")}
        action={{ label: t("contained.room.reload"), onClick: () => window.location.reload() }}
      >
        {t("contained.room.body")}
      </EmptyState>
      <a className="contained-room-home" href="/">
        {t("contained.room.home")}
      </a>
    </main>
  );
}

function PanelFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="contained-panel">
      <Banner
        tone="danger"
        title={t("contained.panel.title")}
        action={{ label: t("contained.panel.retry"), onClick: onRetry }}
      >
        {t("contained.panel.body")}
      </Banner>
    </div>
  );
}
