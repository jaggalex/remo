import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { UiStringsProvider, type UiCountKey, type UiKey, type UiStrings } from "@remo/ui";

export type Lang = "en" | "ru";

const STORAGE_KEY = "remo.lang";

/**
 * Every string the interface shows.
 *
 * One flat table rather than a file per language: a missing translation then fails
 * the type check at the point a key is added, and reviewing new wording means
 * looking at one place instead of hunting for literals in components.
 *
 * Keys are named after where they appear (`board.*`, `inspector.*`, `menu.*`), not
 * after the English text, so a wording change never renames a key.
 */
import { enCore } from "./i18n/en-core";
import { enCollab } from "./i18n/en-collab";
import { enWork } from "./i18n/en-work";
import { enSection } from "./i18n/en-section";
import { ruCore } from "./i18n/ru-core";
import { ruCollab } from "./i18n/ru-collab";
import { ruWork } from "./i18n/ru-work";
import { ruSection } from "./i18n/ru-section";

const en = { ...enCore, ...enCollab, ...enWork, ...enSection };

type Key = keyof typeof en;
/** Every translation key, for code that builds labels dynamically (commands, menus). */
export type TranslationKey = Key;

const ru: Record<Key, string> = {
  ...ruCore,
  ...ruCollab,
  ...ruWork,
  ...ruSection,
};

const STRINGS: Record<Lang, Record<Key, string>> = { en, ru };

/**
 * Counted phrases, with the three forms Russian needs.
 *
 * English ignores `few`; Russian picks by the last two digits, which is the only
 * way to say "1 объект / 3 объекта / 11 объектов" without a special case at every
 * call site.
 */
type CountKey =
  | "objects"
  /** For a phrase that takes the dative: "Голосование по 6 объектам". */
  | "objectsDative"
  | "matches"
  | "widgets"
  | "grants"
  | "selected"
  | "scalable"
  | "pinned"
  | "cards"
  | "columns"
  | "swimlanes"
  | "connectors"
  | "dsMembers"
  | "dsVotes"
  | "dsReplies"
  | "followers";

const COUNTS: Record<Lang, Record<CountKey, [string, string, string]>> = {
  en: {
    objects: ["{n} object", "{n} objects", "{n} objects"],
    objectsDative: ["on {n} object", "on {n} objects", "on {n} objects"],
    matches: ["{n} match", "{n} matches", "{n} matches"],
    widgets: ["{n} widget", "{n} widgets", "{n} widgets"],
    grants: ["{n} grant", "{n} grants", "{n} grants"],
    selected: ["{n} selected", "{n} selected", "{n} selected"],
    scalable: ["{n} changes size", "{n} change size", "{n} change size"],
    pinned: ["{n} pinned", "{n} pinned", "{n} pinned"],
    cards: ["{n} card", "{n} cards", "{n} cards"],
    columns: ["{n} column", "{n} columns", "{n} columns"],
    swimlanes: ["{n} swimlane", "{n} swimlanes", "{n} swimlanes"],
    connectors: ["{n} connector", "{n} connectors", "{n} connectors"],
    dsMembers: ["{n} member", "{n} members", "{n} members"],
    dsVotes: ["{n} vote", "{n} votes", "{n} votes"],
    dsReplies: ["{n} reply", "{n} replies", "{n} replies"],
    followers: ["{n} follower", "{n} followers", "{n} followers"],
  },
  ru: {
    objects: ["{n} объект", "{n} объекта", "{n} объектов"],
    objectsDative: ["по {n} объекту", "по {n} объектам", "по {n} объектам"],
    matches: ["{n} совпадение", "{n} совпадения", "{n} совпадений"],
    widgets: ["{n} объект", "{n} объекта", "{n} объектов"],
    grants: ["{n} доступ", "{n} доступа", "{n} доступов"],
    selected: ["Выбрано: {n}", "Выбрано: {n}", "Выбрано: {n}"],
    scalable: ["{n} меняет размер", "{n} меняют размер", "{n} меняют размер"],
    pinned: ["{n} закреплён", "{n} закреплены", "{n} закреплены"],
    cards: ["{n} карточка", "{n} карточки", "{n} карточек"],
    columns: ["{n} колонка", "{n} колонки", "{n} колонок"],
    swimlanes: ["{n} дорожка", "{n} дорожки", "{n} дорожек"],
    connectors: ["{n} связь", "{n} связи", "{n} связей"],
    dsMembers: ["{n} участник", "{n} участника", "{n} участников"],
    dsVotes: ["{n} голос", "{n} голоса", "{n} голосов"],
    dsReplies: ["{n} ответ", "{n} ответа", "{n} ответов"],
    followers: ["{n} подписчик", "{n} подписчика", "{n} подписчиков"],
  },
};

/** Object types as people read them, not as the document names them. */
const TYPE_NAMES: Record<Lang, Record<string, string>> = {
  en: {
    sticky_note: "Sticky note",
    card: "Card",
    kanban: "Kanban",
    shape: "Shape",
    frame: "Section",
    text: "Text",
    connector: "Connector",
    stamp: "Sticker",
    image: "Image",
    timer: "Timer",
    unsupported: "Object",
  },
  ru: {
    sticky_note: "Стикер",
    card: "Карточка",
    kanban: "Канбан",
    shape: "Фигура",
    frame: "Раздел",
    text: "Текст",
    connector: "Связь",
    stamp: "Наклейка",
    image: "Изображение",
    timer: "Таймер",
    unsupported: "Объект",
  },
};

const STATUS_NAMES: Record<Lang, Record<string, string>> = {
  en: { connecting: "connecting", connected: "connected", disconnected: "disconnected" },
  ru: { connecting: "подключение", connected: "на связи", disconnected: "нет связи" },
};

/**
 * Counted object names: "3 sticky notes, 1 shape" (ADR-120).
 *
 * The multi-selection names its content, and Russian needs the genitive singular/plural
 * for each noun ("3 стикера", "5 стикеров"). Same three forms as `COUNTS`, one row per
 * object type, so a new type is one line away from being countable.
 */
const TYPE_COUNTS: Record<Lang, Record<string, [string, string, string]>> = {
  en: {
    sticky_note: ["{n} sticky note", "{n} sticky notes", "{n} sticky notes"],
    card: ["{n} card", "{n} cards", "{n} cards"],
    kanban: ["{n} kanban", "{n} kanbans", "{n} kanbans"],
    shape: ["{n} shape", "{n} shapes", "{n} shapes"],
    frame: ["{n} section", "{n} sections", "{n} sections"],
    text: ["{n} text", "{n} texts", "{n} texts"],
    connector: ["{n} connector", "{n} connectors", "{n} connectors"],
    stamp: ["{n} sticker", "{n} stickers", "{n} stickers"],
    image: ["{n} image", "{n} images", "{n} images"],
    timer: ["{n} timer", "{n} timers", "{n} timers"],
    unsupported: ["{n} object", "{n} objects", "{n} objects"],
  },
  ru: {
    sticky_note: ["{n} стикер", "{n} стикера", "{n} стикеров"],
    card: ["{n} карточка", "{n} карточки", "{n} карточек"],
    kanban: ["{n} канбан", "{n} канбана", "{n} канбанов"],
    shape: ["{n} фигура", "{n} фигуры", "{n} фигур"],
    frame: ["{n} раздел", "{n} раздела", "{n} разделов"],
    text: ["{n} текст", "{n} текста", "{n} текстов"],
    connector: ["{n} связь", "{n} связи", "{n} связей"],
    stamp: ["{n} наклейка", "{n} наклейки", "{n} наклеек"],
    image: ["{n} изображение", "{n} изображения", "{n} изображений"],
    timer: ["{n} таймер", "{n} таймера", "{n} таймеров"],
    unsupported: ["{n} объект", "{n} объекта", "{n} объектов"],
  },
};

/**
 * Object names for the phrase «Голосование по …»: "по 6 стикерам".
 *
 * Russian needs the dative, which no counted form in `COUNTS` supplies for object types;
 * a history row then reads as a sentence instead of a numeral glued to a nominative noun.
 */
const TYPE_DATIVE: Record<Lang, Record<string, [string, string, string]>> = {
  en: {
    sticky_note: ["on {n} sticky note", "on {n} sticky notes", "on {n} sticky notes"],
    card: ["on {n} card", "on {n} cards", "on {n} cards"],
    kanban: ["on {n} kanban", "on {n} kanbans", "on {n} kanbans"],
    shape: ["on {n} shape", "on {n} shapes", "on {n} shapes"],
    frame: ["on {n} section", "on {n} sections", "on {n} sections"],
    text: ["on {n} text", "on {n} texts", "on {n} texts"],
    connector: ["on {n} connector", "on {n} connectors", "on {n} connectors"],
    stamp: ["on {n} sticker", "on {n} stickers", "on {n} stickers"],
    image: ["on {n} image", "on {n} images", "on {n} images"],
    timer: ["on {n} timer", "on {n} timers", "on {n} timers"],
    unsupported: ["on {n} object", "on {n} objects", "on {n} objects"],
  },
  ru: {
    sticky_note: ["по {n} стикеру", "по {n} стикерам", "по {n} стикерам"],
    card: ["по {n} карточке", "по {n} карточкам", "по {n} карточкам"],
    kanban: ["по {n} канбану", "по {n} канбанам", "по {n} канбанам"],
    shape: ["по {n} фигуре", "по {n} фигурам", "по {n} фигурам"],
    frame: ["по {n} разделу", "по {n} разделам", "по {n} разделам"],
    text: ["по {n} тексту", "по {n} текстам", "по {n} текстам"],
    connector: ["по {n} связи", "по {n} связям", "по {n} связям"],
    stamp: ["по {n} наклейке", "по {n} наклейкам", "по {n} наклейкам"],
    image: ["по {n} изображению", "по {n} изображениям", "по {n} изображениям"],
    timer: ["по {n} таймеру", "по {n} таймерам", "по {n} таймерам"],
    unsupported: ["по {n} объекту", "по {n} объектам", "по {n} объектам"],
  },
};

function pluralForm(lang: Lang, n: number): 0 | 1 | 2 {
  if (lang === "en") return n === 1 ? 0 : 2;
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return 0;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return 1;
  return 2;
}

/** Role names come from the product's `role.*`; every other @remo/ui key must exist as `ds.*`. */
type ProductRoleKey = "role.viewer" | "role.commenter" | "role.editor" | "role.coowner";
type DsKey<K extends string> = K extends ProductRoleKey ? never : `ds.${K}`;
// A key added to @remo/ui without a translation here fails the type check, not the UI.
void (en satisfies Record<DsKey<UiKey> | ProductRoleKey, string>);

const UI_COUNTS: Record<UiCountKey, CountKey> = { object: "objects", member: "dsMembers", vote: "dsVotes", reply: "dsReplies" };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function initialLang(): Lang {
  // A shared link can carry the language, which is useful for a team that reads one
  // language and for screenshots; it wins over the stored choice.
  const fromQuery = new URLSearchParams(window.location.search).get("lang");
  if (fromQuery === "en" || fromQuery === "ru") return fromQuery;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    // Private mode can refuse storage; the browser language is still a good guess.
  }
  const preferred = navigator.languages?.[0] ?? navigator.language ?? "en";
  return preferred.toLowerCase().startsWith("ru") ? "ru" : "en";
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  count: (key: CountKey, n: number) => string;
  typeName: (type: string) => string;
  /** The same name counted: "3 стикера" for the multi-selection summary. */
  typeCount: (type: string, n: number) => string;
  /** The same name for «по …»: "по 6 стикерам". */
  typeDative: (type: string, n: number) => string;
  statusName: (status: string) => string;
  /** Adapter for <UiStringsProvider>: @remo/ui asks for keys, the words live here. */
  ui: UiStrings;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // A `?lang=` in the address is a one-off override. Drop it once the person
    // chooses explicitly, or the next reload would read the stale address and
    // silently switch the interface back.
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.delete("lang");
      window.history.replaceState(null, "", url);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting the choice is a convenience, not a requirement.
    }
  }, []);

  // Screen readers and hyphenation both read this.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => interpolate(STRINGS[lang][key], vars),
      count: (key, n) => interpolate(COUNTS[lang][key][pluralForm(lang, n)], { n }),
      typeName: (type) => TYPE_NAMES[lang][type] ?? type,
      typeCount: (type, n) => {
        const forms = TYPE_COUNTS[lang][type] ?? TYPE_COUNTS[lang].unsupported!;
        return interpolate(forms[pluralForm(lang, n)], { n });
      },
      typeDative: (type, n) => {
        const forms = TYPE_DATIVE[lang][type];
        if (!forms) return interpolate(COUNTS[lang].objectsDative[pluralForm(lang, n)], { n });
        return interpolate(forms[pluralForm(lang, n)], { n });
      },
      statusName: (status) => STATUS_NAMES[lang][status] ?? status,
      ui: {
        // Role names are the product's own (`role.*`); everything else is `ds.*`.
        t: (key: UiKey, vars) => interpolate(STRINGS[lang][(key.startsWith("role.") && key in STRINGS[lang] ? key : `ds.${key}`) as Key], vars),
        count: (key: UiCountKey, n) => interpolate(COUNTS[lang][UI_COUNTS[key]][pluralForm(lang, n)], { n }),
        locale: lang === "ru" ? "ru-RU" : "en-US",
      },
    }),
    [lang, setLang],
  );

  return (
    <I18nContext.Provider value={value}>
      {/* @remo/ui asks for its own keys (`ds.*`) through the same table (ADR-124). */}
      <UiStringsProvider value={value.ui}>{children}</UiStringsProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
  return value;
}
