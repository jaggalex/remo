// The three baselines of ТЗ §10.5, built only from @remo/ui components. Rendered at
// /__ds?view=board|share|agent and photographed into spec/ds-baselines/.
import type { CSSProperties, ReactNode } from "react";
import {
  AccessRow, Banner, Button, CommentPin, Cursor, Dialog, FloatingBar, Frame, Input, List, Panel, PanelSection,
  Property, PublicLink, Radio, Select, Sticker, Textarea, Toolbar, TopBar, ZoomControls, IconButton,
} from "@remo/ui";
import { useI18n } from "../i18n";
import type { Fixtures } from "./fixtures";

const at = (left: number, top: number, child: ReactNode) => <div className="ds-abs" style={{ left, top } as CSSProperties}>{child}</div>;

export function BoardScreen({ f }: { f: Fixtures }) {
  const { t, count } = useI18n();
  const s = f.stickers;
  return (
    <div className="ds-screen">
      <TopBar boardName={f.board} sync="saved" presence={f.people}>
        <Button variant="ghost" size="compact" icon="timer">05:00</Button>
        <Button variant="ghost" size="compact" icon="vote">{t("ds.vote")}</Button>
      </TopBar>
      <div className="ds-screen-main">
        <div className="ds-canvas">
          {at(16, 16, <Toolbar defaultValue="select" tools={[
            { id: "select", icon: "cursor", label: t("dsCatalog.toolSelect"), shortcut: ["V"] }, { separator: true },
            { id: "sticky", icon: "sticky", label: t("dsCatalog.toolSticky"), shortcut: ["N"] }, { id: "shape", icon: "shape", label: t("ds.shape"), shortcut: ["S"] },
            { id: "frame", icon: "frame", label: t("ds.frame"), shortcut: ["F"] }, { separator: true },
            { id: "conn", icon: "connector", label: t("ds.connector"), shortcut: ["L"] }, { id: "comment", icon: "comment", label: t("ds.comment"), shortcut: ["C"] },
          ]} />)}
          {at(104, 100, <Frame title={f.frames[0]!} order={1} width={420} height={300}>
            {at(20, 24, <Sticker color="pink" text={s[0]} author={f.people[1]} votes={4} size={120} />)}
            {at(152, 24, <Sticker color="pink" text={s[1]} author={f.people[6]} size={120} state="selected" />)}
            {at(284, 24, <Sticker color="pink" text={s[2]} author={f.people[4]} size={120} state="locked" lockedBy={f.people[0]!.split(" ")[0]} />)}
            {at(20, 160, <Sticker color="orange" text={s[3]} author={f.people[2]} size={120} state="selected" reactions={[{ emoji: "👍", count: 2 }]} />)}
            {at(152, 160, <Sticker color="orange" text={s[4]} author={f.people[5]} size={120} state="selected" />)}
          </Frame>)}
          {at(560, 100, <Frame title={f.frames[1]!} order={2} width={300} height={300}>
            {at(20, 24, <Sticker color="green" text={s[5]} author={f.people[3]} size={120} />)}
            {at(152, 24, <Sticker color="green" text={s[6]} author={f.people[2]} size={120} state="remote" remoteName={f.people[1]!.split(" ")[0]} remoteColor={2} />)}
            {at(20, 160, <Sticker color="blue" text={s[7]} author={f.people[3]} size={120} />)}
          </Frame>)}
          {at(100, 30, <FloatingBar count={3} actions={[
            { swatch: "sticker-orange", label: t("dsCatalog.color") }, { icon: "text", label: t("dsCatalog.text") }, { icon: "connector", label: t("ds.connector") },
            { icon: "lock", label: t("menu.lock") }, { icon: "comment", label: t("ds.comment") }, { icon: "copy", label: t("ds.copy") },
          ]} />)}
          {at(330, 470, <Cursor name={f.people[1]!.split(" ")[0]!} color={2} state="moving" />)}
          {at(760, 370, <Cursor name={f.people[2]!.split(" ")[0]!} color={3} state="typing" />)}
          {at(872, 150, <CommentPin author={f.people[3]} color={4} count={2} />)}
          {at(16, 610, <ZoomControls zoom={84} />)}
        </div>
        <Panel title={t("ds.selectedCount", { objects: count("objects", 3) })} actions={<IconButton icon="close" label={t("ds.close")} size="compact" />}>
          <PanelSection title={t("dsCatalog.properties")}>
            <Property label={t("dsCatalog.frameLabel")}>{f.frames[0]}</Property>
            <Property label={t("dsCatalog.authors")}>{count("dsMembers", 3)}</Property>
          </PanelSection>
          <PanelSection title={t("dsCatalog.counters")}>
            <Property label={t("ds.vote")} numeric>0</Property>
            <Property label={t("dsCatalog.reactions")} numeric>2</Property>
          </PanelSection>
          <PanelSection title={t("dsCatalog.access")}>
            <Property label={t("dsCatalog.yourRole")}>{t("role.editor")}</Property>
            <div className="ds-note">{f.sources.inherited}</div>
          </PanelSection>
          <PanelSection title={t("dsCatalog.history")}>
            <List items={[{ title: s[3], meta: `${f.people[2]} · 14:06` }, { title: s[4], meta: `${f.people[5]} · 14:02` }]} />
          </PanelSection>
        </Panel>
      </div>
    </div>
  );
}

function ShareDialog({ f, on }: { f: Fixtures; on: boolean }) {
  const { t } = useI18n();
  return (
    <Dialog inline size="md" title={t("ds.share")} onClose={() => undefined}
      footer={<><span className="rm-foot-start"><Button variant="ghost" icon="link">{t("ds.copy")}</Button></span><Button variant="primary">{t("dsCatalog.done")}</Button></>}>
      <div className="ds-row">
        <div className="ds-grow"><Input placeholder={t("dsCatalog.invitePlaceholder")} aria-label={t("dsCatalog.invite")} /></div>
        <Select aria-label={t("ds.role", { name: "" })} options={[{ value: "editor", label: t("role.editor") }, { value: "viewer", label: t("role.viewer") }]} />
        <Button variant="secondary">{t("dsCatalog.invite")}</Button>
      </div>
      <div>
        <AccessRow name={f.people[0]!} you role="owner" source={f.sources.owner} locked />
        <AccessRow name={f.people[1]!} role="editor" source={f.sources.direct} removable />
        <AccessRow name={f.team} role="editor" source={f.sources.team} removable />
        <AccessRow name={f.people[2]!} role="editor" source={f.sources.inherited} locked />
        <AccessRow name={f.agent} agent role="commenter" source={f.sources.agent} removable />
      </div>
      <PublicLink enabled={on} role="viewer" expires={on ? f.date : undefined} url={f.url} />
    </Dialog>
  );
}

export function ShareScreen({ f }: { f: Fixtures }) {
  return (
    <div className="ds-screen">
      <TopBar boardName={f.board} sync="saved" presence={f.people.slice(0, 3)} />
      <div className="ds-screen-main"><div className="ds-canvas"><div className="ds-scrim"><ShareDialog f={f} on /><ShareDialog f={f} on={false} /></div></div></div>
    </div>
  );
}

export function AgentScreen({ f }: { f: Fixtures }) {
  const { t, count } = useI18n();
  return (
    <div className="ds-screen">
      <TopBar boardName={f.board} sync="pending" presence={f.people.slice(0, 2)} />
      <div className="ds-screen-main"><div className="ds-canvas"><div className="ds-scrim">
        <Dialog inline size="md" title={t("dsCatalog.agentTitle")} description={t("dsCatalog.agentDescription")} onClose={() => undefined}
          footer={<><Button variant="secondary">{t("ds.cancel")}</Button><Button variant="primary" disabled>{t("ds.timerStart")}</Button></>}>
          <Textarea label={t("dsCatalog.task")} defaultValue={f.task} />
          <div className="ds-two">
            <Select label={t("dsCatalog.agent")} options={[f.agent]} />
            <Select label={t("dsCatalog.skill")} options={[t("dsCatalog.skillCluster")]} />
          </div>
          <div className="ds-stack">
            <div className="ds-label">{t("dsCatalog.scope")}</div>
            <Radio name="scope" label={t("dsCatalog.scopeSelection")} hint={count("objects", 3)} defaultChecked />
            <Radio name="scope" label={t("dsCatalog.scopeBoard")} hint={count("objects", 128)} />
          </div>
          <div className="ds-two">
            <Input label={t("dsCatalog.budget")} defaultValue="50" suffix="$" error={f.budgetError} />
            <Select label={t("dsCatalog.model")} options={["claude-sonnet-5-5", "claude-haiku-5-5"]} />
          </div>
          <Banner tone="info" title={t("dsCatalog.agentRights")}>{f.agentRights}</Banner>
        </Dialog>
      </div></div></div>
    </div>
  );
}
