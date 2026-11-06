// /__ds — the design-system catalogue (dev only, ТЗ §9). Every component in its states,
// keyboard-navigable, with theme, density and language switches. `?view=board|share|agent`
// renders one baseline screen full-size for the screenshots in spec/ds-baselines/.
import "@remo/ui/styles.css";
import "./catalog.css";
import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as UI from "@remo/ui";
import { I18nProvider, useI18n, type Lang } from "../i18n";
import { fixtures, type Fixtures } from "./fixtures";
import { AgentScreen, BoardScreen, ShareScreen } from "./Screens";
import { ConnectorPerf } from "./ConnectorPerf";
import { ScalePerf } from "./ScalePerf";
import { ConnectorStates } from "./ConnectorStates";

type Theme = "light" | "dark";
type Density = "default" | "compact";
const params = new URLSearchParams(window.location.search);

const STATES = ["default", "hover", "active", "focus-visible", "disabled", "loading", "error", "read-only", "selected"] as const;
type State = (typeof STATES)[number];
const SCREEN_LABEL = { board: "dsCatalog.screenBoard", share: "dsCatalog.screenShare", agent: "dsCatalog.screenAgent" } as const;

/** One row of the nine-state matrix; `null` marks a state that does not apply (declared, not forgotten). */
function StateRow({ name, cells }: { name: string; cells: Partial<Record<State, ReactNode | null>> }) {
  const { t } = useI18n();
  return (
    <tr>
      <th scope="row">{name}</th>
      {STATES.map((s) => <td key={s}>{cells[s] === undefined || cells[s] === null ? <span className="ds-na">{t("dsCatalog.na")}</span> : cells[s]}</td>)}
    </tr>
  );
}

function StateMatrix({ f }: { f: Fixtures }) {
  const { t } = useI18n();
  const L = t("ds.share");
  return (
    <div className="ds-matrix-wrap">
      <table className="ds-matrix">
        <thead><tr><th />{STATES.map((s) => <th key={s} scope="col">{s}</th>)}</tr></thead>
        <tbody>
          {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
            <StateRow key={v} name={`Button ${v}`} cells={{
              default: <UI.Button variant={v}>{L}</UI.Button>, hover: <UI.Button variant={v} force="hover">{L}</UI.Button>,
              active: <UI.Button variant={v} force="active">{L}</UI.Button>, "focus-visible": <UI.Button variant={v} force="focus-visible">{L}</UI.Button>,
              disabled: <UI.Button variant={v} disabled>{L}</UI.Button>, loading: <UI.Button variant={v} loading>{L}</UI.Button>,
              selected: v === "secondary" ? <UI.Button selected icon="eye">{L}</UI.Button> : null,
            }} />
          ))}
          <StateRow name="IconButton" cells={{
            default: <UI.IconButton icon="more" label={t("ds.moreActions")} />, hover: <UI.IconButton icon="more" label={t("ds.moreActions")} force="hover" />,
            active: <UI.IconButton icon="more" label={t("ds.moreActions")} force="active" />, "focus-visible": <UI.IconButton icon="more" label={t("ds.moreActions")} force="focus-visible" />,
            disabled: <UI.IconButton icon="more" label={t("ds.moreActions")} disabled />, selected: <UI.IconButton icon="lock" label={t("menu.lock")} selected />,
          }} />
          <StateRow name="Input" cells={{
            default: <UI.Input aria-label="x" placeholder={f.board} />, hover: <UI.Input aria-label="x" force="hover" defaultValue={f.board} />,
            active: <UI.Input aria-label="x" force="focus" defaultValue={f.board} />, "focus-visible": <UI.Input aria-label="x" force="focus" defaultValue={f.board} />,
            disabled: <UI.Input aria-label="x" disabled defaultValue={f.board} />, error: <UI.Input aria-label="x" defaultValue="50" suffix="$" error={f.budgetError} />,
            "read-only": <UI.Input aria-label="x" readOnly defaultValue={f.people[0]} />,
          }} />
          <StateRow name="Select" cells={{
            default: <UI.Select aria-label="x" options={[t("role.editor"), t("role.viewer")]} />, disabled: <UI.Select aria-label="x" disabled options={[t("role.viewer")]} />,
            error: <UI.Select aria-label="x" error={f.budgetError} options={[t("role.editor")]} />,
          }} />
          <StateRow name="Textarea" cells={{
            default: <UI.Textarea aria-label="x" defaultValue={f.frames[2]} />, hover: <UI.Textarea aria-label="x" force="hover" defaultValue={f.frames[2]} />,
            "focus-visible": <UI.Textarea aria-label="x" force="focus" defaultValue={f.frames[2]} />, disabled: <UI.Textarea aria-label="x" disabled defaultValue={f.frames[2]} />,
            error: <UI.Textarea aria-label="x" error={f.budgetError} defaultValue={f.frames[2]} />, "read-only": <UI.Textarea aria-label="x" readOnly defaultValue={f.frames[2]} />,
          }} />
          <StateRow name="Link" cells={{
            default: <UI.Link href="#">{f.board}</UI.Link>, hover: <UI.Link href="#" force="hover">{f.board}</UI.Link>,
            active: <UI.Link href="#" force="active">{f.board}</UI.Link>, "focus-visible": <UI.Link href="#" force="focus-visible">{f.board}</UI.Link>,
          }} />
          <StateRow name="Menu" cells={{
            default: <UI.Menu label="menu" items={[{ label: t("menu.copyStyle"), icon: "copy", shortcut: ["⌘", "C"] }]} />,
            hover: <UI.Menu label="menu" items={[{ label: t("menu.copyStyle"), icon: "copy", force: "hover" }]} />,
            active: <UI.Menu label="menu" items={[{ label: t("menu.copyStyle"), icon: "copy", force: "active" }]} />,
            "focus-visible": <UI.Menu label="menu" items={[{ label: t("menu.copyStyle"), icon: "copy", force: "focus-visible" }]} />,
            disabled: <UI.Menu label="menu" items={[{ label: t("menu.lock"), icon: "lock", disabled: true }]} />,
            selected: <UI.Menu label="menu" items={[{ label: t("menu.group"), icon: "frame", checked: true }]} />,
          }} />
          <StateRow name="Tabs" cells={{
            default: <UI.Tabs label="tabs" tabs={[{ id: "p", label: t("org.people") }, { id: "a", label: t("dsCatalog.agent") }]} />,
            hover: <UI.Tabs label="tabs" force="hover" tabs={[{ id: "p", label: t("org.people") }, { id: "a", label: t("dsCatalog.agent") }]} />,
            active: <UI.Tabs label="tabs" force="active" tabs={[{ id: "p", label: t("org.people") }, { id: "a", label: t("dsCatalog.agent") }]} />,
            "focus-visible": <UI.Tabs label="tabs" force="focus-visible" tabs={[{ id: "p", label: t("org.people") }, { id: "a", label: t("dsCatalog.agent") }]} />,
            selected: <UI.Tabs label="tabs" defaultValue="a" tabs={[{ id: "p", label: t("org.people") }, { id: "a", label: t("dsCatalog.agent") }]} />,
          }} />
          <StateRow name="Segmented" cells={{
            default: <UI.Segmented label={t("dsCatalog.segmentLabel")} value="10" onChange={() => {}} options={[{ value: "5", label: "5" }, { value: "10", label: "10" }, { value: "15", label: "15" }]} />,
            selected: <UI.Segmented label={t("dsCatalog.segmentLabel")} value="15" onChange={() => {}} options={[{ value: "5", label: "5" }, { value: "10", label: "10" }, { value: "15", label: "15" }]} />,
            disabled: <UI.Segmented label={t("dsCatalog.segmentLabel")} value="10" onChange={() => {}} options={[{ value: "5", label: "5", disabled: true }, { value: "10", label: "10" }]} />,
          }} />
          <StateRow name="ChoiceCard" cells={{
            default: <div style={{ width: 320 }}><UI.ChoiceCard label={t("dsCatalog.choiceTitle")} value="anonymous" onChange={() => {}} options={[{ value: "anonymous", title: t("dsCatalog.choiceAnonymous"), hint: t("dsCatalog.choiceAnonymousHint") }, { value: "named", title: t("dsCatalog.choiceNamed"), hint: t("dsCatalog.choiceNamedHint") }]} /></div>,
            selected: <div style={{ width: 320 }}><UI.ChoiceCard label={t("dsCatalog.choiceTitle")} value="named" onChange={() => {}} options={[{ value: "anonymous", title: t("dsCatalog.choiceAnonymous"), hint: t("dsCatalog.choiceAnonymousHint") }, { value: "named", title: t("dsCatalog.choiceNamed"), hint: t("dsCatalog.choiceNamedHint") }]} /></div>,
            disabled: <div style={{ width: 320 }}><UI.ChoiceCard label={t("dsCatalog.choiceTitle")} value="anonymous" onChange={() => {}} options={[{ value: "anonymous", title: t("dsCatalog.choiceAnonymous"), hint: t("dsCatalog.choiceAnonymousHint"), disabled: true }, { value: "named", title: t("dsCatalog.choiceNamed"), hint: t("dsCatalog.choiceNamedHint"), disabled: true }]} /></div>,
          }} />
          <StateRow name="Table" cells={{
            default: <div style={{ width: 260 }}><UI.Table<{ n: string; r: string; selected?: boolean }> columns={[{ key: "n", label: t("dsCatalog.authors") }, { key: "r", label: t("ds.role") }]} rows={[{ n: f.people[1]!, r: t("role.editor") }, { n: f.people[2]!, r: t("role.viewer") }]} /></div>,
            hover: <div style={{ width: 260 }}><UI.Table<{ n: string; r: string; selected?: boolean }> rowForce="hover" columns={[{ key: "n", label: t("dsCatalog.authors") }, { key: "r", label: t("ds.role") }]} rows={[{ n: f.people[1]!, r: t("role.editor") }]} /></div>,
            active: <div style={{ width: 260 }}><UI.Table<{ n: string; r: string; selected?: boolean }> rowForce="active" columns={[{ key: "n", label: t("dsCatalog.authors") }, { key: "r", label: t("ds.role") }]} rows={[{ n: f.people[1]!, r: t("role.editor") }]} /></div>,
            selected: <div style={{ width: 260 }}><UI.Table<{ n: string; r: string; selected?: boolean }> columns={[{ key: "n", label: t("dsCatalog.authors") }, { key: "r", label: t("ds.role") }]} rows={[{ n: f.people[1]!, r: t("role.editor"), selected: true }]} /></div>,
            disabled: <div style={{ width: 260 }}><UI.Table<{ n: string; r: string; selected?: boolean }> columns={[{ key: "n", label: t("dsCatalog.authors") }]} rows={[]} /></div>,
          }} />
          <StateRow name="Dialog" cells={{
            default: <UI.Dialog inline size="sm" title={t("ds.share")} footer={<UI.Button variant="primary" size="compact">{t("dsCatalog.done")}</UI.Button>}>{f.frames[2]}</UI.Dialog>,
          }} />
          <StateRow name="ConfirmDialog" cells={{
            default: <UI.ConfirmDialog inline count={12}>{t("dsCatalog.frameKeepsContent")}</UI.ConfirmDialog>,
            loading: <UI.ConfirmDialog inline count={12} loading>{t("dsCatalog.frameKeepsContent")}</UI.ConfirmDialog>,
          }} />
          <StateRow name="AccessRow" cells={{
            default: <div style={{ width: 300 }}><UI.AccessRow name={f.people[1]!} role="editor" source={f.sources.direct} removable /></div>,
            "read-only": <div style={{ width: 300 }}><UI.AccessRow name={f.people[2]!} role="viewer" source={f.sources.inherited} locked /></div>,
            disabled: <div style={{ width: 300 }}><UI.AccessRow name={f.people[3]!} role="commenter" source={f.sources.direct} disabled /></div>,
          }} />
          <StateRow name="Checkbox" cells={{
            default: <UI.Checkbox label="A" />, hover: <UI.Checkbox label="A" force="hover" />, "focus-visible": <UI.Checkbox label="A" force="focus-visible" />,
            disabled: <UI.Checkbox label="A" disabled />, selected: <UI.Checkbox label="A" defaultChecked />,
          }} />
          <StateRow name="Radio" cells={{
            default: <UI.Radio name="m1" label="A" />, "focus-visible": <UI.Radio name="m2" label="A" force="focus-visible" />,
            disabled: <UI.Radio name="m3" label="A" disabled />, selected: <UI.Radio name="m4" label="A" defaultChecked />,
          }} />
          <StateRow name="Switch" cells={{
            default: <UI.Switch label="A" />, "focus-visible": <UI.Switch label="A" force="focus-visible" />,
            disabled: <UI.Switch label="A" disabled />, selected: <UI.Switch label="A" defaultChecked />,
          }} />
          <StateRow name="Sticker" cells={{
            default: <UI.Sticker size={96} text={f.stickers[6]} />, hover: <UI.Sticker size={96} state="hover" text={f.stickers[6]} />,
            "read-only": <UI.Sticker size={96} state="readonly" text={f.stickers[6]} />, selected: <UI.Sticker size={96} state="selected" text={f.stickers[6]} />,
          }} />
        </tbody>
      </table>
    </div>
  );
}

/**
 * Components whose states are not the nine interactive ones: the table declares what
 * applies; the header says the rest do not (приёмка 1, ТЗ §5). Live examples are below.
 */
const DECLARED: { name: string; states: string }[] = [
  { name: "Icon · Kbd · Separator", states: "default" },
  { name: "Spinner · Skeleton", states: "loading" },
  { name: "Badge / Chip", states: "default · count · removable" },
  { name: "Avatar · AvatarStack", states: "default" },
  { name: "SyncStatus", states: "saved · pending · offline" },
  { name: "ReadOnlyBadge", states: "read-only" },
  { name: "Tooltip", states: "default · open" },
  { name: "Popover", states: "default · open" },
  { name: "Toast", states: "neutral · info · success · warning · danger · dismissable" },
  { name: "Banner", states: "info · warning · danger · success · dismissable" },
  { name: "EmptyState", states: "default · with action" },
  { name: "TopBar", states: "default · read-only · saved · pending · offline · presence" },
  { name: "Toolbar", states: "default · hover · focus-visible · selected · disabled" },
  { name: "FloatingBar", states: "default · hover · focus-visible · selected" },
  { name: "ZoomControls", states: "default · hover · focus-visible" },
  { name: "Panel · PanelSection · Property", states: "default · empty" },
  { name: "List", states: "default · empty" },
  { name: "JournalList", states: "done · pending · failed · rejected" },
  { name: "PublicLink", states: "off · on · password · expiry" },
  { name: "Connector", states: "default · hover · selected · editing-label · pending" },
  { name: "Ports", states: "hidden · visible · hot · connected" },
  { name: "Frame", states: "default · selected · drop-target · hidden · clipped" },
  { name: "Selection", states: "default · marquee" },
  { name: "Cursor", states: "moving · idle · typing · following" },
  { name: "FollowIndicator", states: "following" },
  { name: "CommentPin", states: "default · selected · resolved" },
  { name: "LockBadge", states: "locked" },
  { name: "Minimap", states: "default" },
  { name: "TimerWidget", states: "running · paused · done" },
  { name: "VoteCard", states: "active · ended · empty" },
];

function StateDeclarations() {
  const { t } = useI18n();
  return (
    <div className="ds-matrix-wrap">
      <table className="ds-matrix ds-declared">
        <thead><tr><th scope="col">{t("dsCatalog.component")}</th><th scope="col">{t("dsCatalog.statesDeclared")}</th></tr></thead>
        <tbody>{DECLARED.map((d) => <tr key={d.name}><th scope="row">{d.name}</th><td>{d.states}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} className="ds-section" aria-labelledby={`${id}-h`}><h2 id={`${id}-h`} className="ds-section-title">{title}</h2>{children}</section>;
}

function Components({ f }: { f: Fixtures }) {
  const { t, count } = useI18n();
  const [dialog, setDialog] = useState(false);
  const [link, setLink] = useState(true);
  return (
    <>
      <Section id="states" title={t("dsCatalog.states")}><StateMatrix f={f} /><StateDeclarations /></Section>
      <Section id="icons" title="Icon">
        <div className="ds-wrap">{UI.ICON_NAMES.map((n) => <span key={n} className="ds-icon" title={n}><UI.Icon name={n} size={20} /><code>{n}</code></span>)}</div>
      </Section>
      <Section id="status" title="Badge · Avatar · SyncStatus · Kbd · Tooltip">
        <div className="ds-wrap">
          <UI.Badge>{t("ds.journal.pending")}</UI.Badge><UI.Badge tone="success" icon="check">{t("ds.journal.done")}</UI.Badge>
          <UI.Badge tone="danger" icon="alert">{t("ds.journal.failed")}</UI.Badge><UI.Badge tone="accent" count={3} /><UI.Badge onRemove={() => undefined}>Q4</UI.Badge>
          <UI.AvatarStack names={f.people} /><UI.Avatar name={f.agent} agent />
          <UI.SyncStatus state="saved" /><UI.SyncStatus state="pending" /><UI.SyncStatus state="offline" /><UI.ReadOnlyBadge />
          <UI.Kbd keys={["⌘", "Shift", "L"]} />
          <UI.Tooltip label={t("menu.lock")} shortcut={["⌘", "Shift", "L"]}><UI.IconButton icon="lock" label={t("menu.lock")} /></UI.Tooltip>
          <UI.Spinner label={t("ds.saving")} /><UI.Skeleton width={120} />
        </div>
      </Section>
      <Section id="fields" title="Input · Textarea · Select">
        <div className="ds-grid">
          <UI.Input label={t("board.name")} defaultValue={f.boardLong} />
          <UI.Input label={t("dsCatalog.budget")} type="search" placeholder="…" />
          <UI.Textarea label={t("dsCatalog.task")} defaultValue={f.task} />
          <UI.Select label={t("dsCatalog.model")} options={["claude-sonnet-5-5", "claude-haiku-5-5"]} />
        </div>
      </Section>
      <Section id="menus" title="Menu · Popover · Tabs">
        <div className="ds-wrap ds-top">
          <UI.Menu label="menu" items={[
            { label: t("menu.copyStyle"), icon: "copy", shortcut: ["⌘", "C"] }, { label: t("menu.group"), icon: "frame", shortcut: ["⌘", "G"] },
            { separator: true }, { label: t("menu.lock"), icon: "lock", shortcut: ["⌘", "Shift", "L"] },
            { separator: true }, { label: `${t("ds.delete")}…`, icon: "trash", danger: true, shortcut: ["Del"] },
          ]} />
          <UI.Popover title={t("ds.timer")} onClose={() => undefined} footer={<UI.Button variant="primary" size="compact">{t("ds.timerStart")}</UI.Button>}>
            <UI.Input label={t("ds.timer")} defaultValue="5" size="compact" />
          </UI.Popover>
          <UI.Tabs label="tabs" tabs={[{ id: "p", label: t("org.people"), count: 24 }, { id: "a", label: t("dsCatalog.agent"), count: 3 }, { id: "h", label: t("org.audit") }]} />
        </div>
      </Section>
      <Section id="dialogs" title="Dialog · ConfirmDialog · Toast · Banner · EmptyState">
        <div className="ds-wrap ds-top">
          <UI.Button variant="secondary" onClick={() => setDialog(true)}>{t("dsCatalog.openDialog")}</UI.Button>
          {dialog && <UI.ConfirmDialog count={12} onCancel={() => setDialog(false)} onConfirm={() => setDialog(false)}>{t("dsCatalog.frameKeepsContent")}</UI.ConfirmDialog>}
          <UI.ConfirmDialog inline count={12}>{t("dsCatalog.frameKeepsContent")}</UI.ConfirmDialog>
          <div className="ds-stack">
            <UI.Toast action={{ label: t("board.undo") }} onClose={() => undefined}>{count("objects", 12)}</UI.Toast>
            <UI.Toast tone="danger" title={t("dsCatalog.revoked")} onClose={() => undefined}>{t("dsCatalog.revokedBody")}</UI.Toast>
            <UI.Banner tone="warning" icon="offline" title={t("ds.offlineShort")}>{t("ds.offline")}</UI.Banner>
          </div>
          <UI.EmptyState icon="agent" title={t("dsCatalog.noAgents")} action={{ label: t("dsCatalog.addAgent"), icon: "plus" }} example={f.agent}>{t("dsCatalog.agentDescription")}</UI.EmptyState>
        </div>
      </Section>
      <Section id="data" title="Table · JournalList · Panel">
        <UI.JournalList entries={f.journal.map((action, i) => ({ seq: 128 - i, time: `14:0${5 - i * 2}`, action, agent: f.agent, model: "claude-sonnet-5-5", tokens: [18420, 3210, 960][i]!, cost: [0.084, 0.004, 0.003][i]!, status: (["pending", "done", "failed"] as const)[i]! }))} />
      </Section>
      <Section id="access" title="AccessRow · PublicLink">
        <div className="ds-grid">
          <div>
            <UI.AccessRow name={f.people[0]!} you role="owner" source={f.sources.owner} locked />
            <UI.AccessRow name={f.people[1]!} role="editor" source={f.sources.direct} removable />
            <UI.AccessRow name={f.people[2]!} role="editor" source={f.sources.inherited} locked />
          </div>
          <UI.PublicLink enabled={link} onToggle={setLink} expires={f.date} url={f.url} />
        </div>
      </Section>
      <Section id="shell" title="TopBar · Toolbar · FloatingBar · ZoomControls · Minimap · TimerWidget · VoteCard">
        <UI.TopBar boardName={f.boardLong} sync="offline" readOnly presence={f.people} />
        <div className="ds-canvas-demo ds-wrap ds-top">
          <UI.Toolbar tools={[{ id: "v", icon: "cursor", label: t("dsCatalog.toolSelect"), shortcut: ["V"] }, { id: "n", icon: "sticky", label: t("dsCatalog.toolSticky"), shortcut: ["N"] }]} />
          <div className="ds-stack">
            <UI.FloatingBar count={3} actions={[{ icon: "lock", label: t("menu.lock") }, { icon: "copy", label: t("ds.copy") }]} />
            <UI.ZoomControls zoom={100} />
            <UI.Minimap />
          </div>
          <div className="ds-stack"><UI.TimerWidget seconds={187} /><UI.TimerWidget seconds={95} state="paused" /><UI.TimerWidget seconds={0} state="done" controls={false} /></div>
          <UI.VoteCard title={f.frames[0]} meta={f.people[0]} left={3} total={5} timer={142} canEnd />
          <UI.VoteCard state="ended" empty />
        </div>
      </Section>
      <Section id="canvas" title="Sticker · Connector · Ports · Frame · Selection · Cursor · CommentPin">
        <div className="ds-canvas-demo ds-wrap ds-top ds-roomy">
          {(["yellow", "green", "blue", "pink", "violet", "orange", "neutral"] as const).map((c, i) => (
            <UI.Sticker key={c} color={c} text={f.stickers[i]} author={f.people[i]} size={140}
              state={(["default", "selected", "editing", "locked", "remote", "default", "readonly"] as const)[i]}
              lockedBy={f.people[0]!.split(" ")[0]} remoteName={f.people[1]!.split(" ")[0]} remoteColor={2} votes={i === 0 ? 4 : undefined} />
          ))}
        </div>
        <div className="ds-canvas-demo ds-wrap ds-top ds-roomy">
          {([["straight", "none", "line"], ["straight", "arrow", "arrow"], ["elbow", "arrow", "elbow"], ["straight", "block", "block"]] as const).map(([routing, head, name]) => (
            <figure key={name}><UI.Connector routing={routing} head={head} /><figcaption>{name} = {routing} + {head}</figcaption></figure>
          ))}
          <figure><UI.Connector routing="straight" state="selected" waypoints={[{ x: 120, y: 12, rigid: true }]} /><figcaption>selected · rigid</figcaption></figure>
          <figure><UI.Connector routing="curved" state="selected" waypoints={[{ x: 120, y: 0, rigid: true }]} /><figcaption>curved</figcaption></figure>
          <figure><UI.Connector state="pending" /><figcaption>pending</figcaption></figure>
          <UI.Ports label={t("ds.shape")} hot={1} connected={[3]} />
        </div>
        <div className="ds-canvas-demo ds-wrap ds-top ds-roomy">
          <UI.Frame title={f.frames[2]!} order={3} width={220} height={130} state="drop-target" />
          <UI.Frame title={f.frames[3]!} width={220} height={130} state="hidden" />
          <UI.Selection width={200} height={110} count={3} />
          <UI.Selection width={160} height={110} marquee />
          <div className="ds-stack">{[1, 2, 3, 4, 5, 6].map((c) => <UI.Cursor key={c} name={f.people[c - 1]!.split(" ")[0]!} color={c as UI.PresenceColor} state={c === 2 ? "typing" : c === 3 ? "following" : c === 5 ? "idle" : "moving"} />)}</div>
          <div className="ds-wrap"><UI.CommentPin author={f.people[1]} color={2} /><UI.CommentPin author={f.people[2]} color={3} count={3} /><UI.CommentPin resolved /></div>
          <div className="ds-follow-demo"><UI.FollowIndicator name={f.people[0]!.split(" ")[0]!} color={1} /></div>
        </div>
      </Section>
    </>
  );
}

function Catalog() {
  const { t, lang, setLang, ui } = useI18n();
  const [theme, setTheme] = useState<Theme>((params.get("theme") as Theme) ?? "light");
  const [density, setDensity] = useState<Density>((params.get("density") as Density) ?? "default");
  const view = params.get("view");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);
  const f = fixtures(lang);
  const screen =
    view === "board" ? <BoardScreen f={f} />
    : view === "share" ? <ShareScreen f={f} />
    : view === "agent" ? <AgentScreen f={f} />
    : view === "perf" ? <ConnectorPerf />
    : view === "scale" ? <ScalePerf />
    : view === "connectors" ? <ConnectorStates />
    : null;
  return (
    <UI.UiStringsProvider value={ui}>
      {screen ?? (
        <div className="ds-catalog">
          <header className="ds-bar">
            <h1 className="ds-title">{t("dsCatalog.title")}</h1>
            <div className="ds-switches" role="group" aria-label={t("dsCatalog.title")}>
              <UI.Select size="compact" aria-label={t("dsCatalog.theme")} value={theme} onChange={(e) => setTheme(e.target.value as Theme)} options={[{ value: "light", label: t("dsCatalog.light") }, { value: "dark", label: t("dsCatalog.dark") }]} />
              <UI.Select size="compact" aria-label={t("dsCatalog.density")} value={density} onChange={(e) => setDensity(e.target.value as Density)} options={[{ value: "default", label: "32" }, { value: "compact", label: "28" }]} />
              <UI.Select size="compact" aria-label={t("board.language")} value={lang} onChange={(e) => setLang(e.target.value as Lang)} options={[{ value: "ru", label: "RU" }, { value: "en", label: "EN" }]} />
            </div>
            <nav className="ds-screens" aria-label={t("dsCatalog.screens")}>
              {(["board", "share", "agent"] as const).map((v) => <UI.Link key={v} href={`?view=${v}&theme=${theme}&density=${density}&lang=${lang}`}>{t(SCREEN_LABEL[v])}</UI.Link>)}
            </nav>
          </header>
          <main className="ds-main"><Components f={f} /></main>
        </div>
      )}
    </UI.UiStringsProvider>
  );
}

export function mountCatalog(container: HTMLElement) {
  createRoot(container).render(<I18nProvider><Catalog /></I18nProvider>);
}
