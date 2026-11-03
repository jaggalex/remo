import { useEffect, useMemo, useState } from "react";
import { useI18n, type Lang } from "../i18n";
import { ThemeSwitch } from "../ThemeSwitch";
import { ABOUT } from "../about";
import generated from "./generated.json";
import type { HelpLocale, HelpTopicId } from "./topics.generated";
import { HELP_TOPIC_IDS } from "./topics.generated";
import "./help.css";

interface Topic {
  id: HelpTopicId;
  type: "tutorial" | "how-to" | "reference" | "explanation";
  title: Record<HelpLocale, string>;
  summary: Record<HelpLocale, string>;
  related: HelpTopicId[];
  verifiedAgainst: string;
  audience: "public" | "private";
  sourceHash: string;
  translationStatus: "current" | "outdated" | "missing";
  html: Partial<Record<HelpLocale, string>>;
}
interface SearchEntry { id: HelpTopicId; title: string; summary: string; text: string }
const data = generated as unknown as {
  topics: Topic[];
  search: Record<HelpLocale, SearchEntry[]>;
};
const TYPES = ["tutorial", "how-to", "reference", "explanation"] as const;

function parsePath(): { lang: HelpLocale; topicId: HelpTopicId | null } {
  const match = window.location.pathname.match(/^\/help(?:\/(ru|en)\/([^/]+))?\/?$/);
  const lang = (match?.[1] as HelpLocale | undefined) ?? (localStorage.getItem("remo.lang") as HelpLocale) ?? "ru";
  const candidate = match?.[2];
  const topicId = candidate && (HELP_TOPIC_IDS as readonly string[]).includes(candidate)
    ? (candidate as HelpTopicId)
    : null;
  return { lang: lang === "en" ? "en" : "ru", topicId };
}

/**
 * Public help centre and article page (ADR-081).
 *
 * It is rendered before the board shell, so it works without a session. Content is
 * generated at build time and bundled: no network request, no service.
 */
export function HelpPage() {
  const { t, setLang } = useI18n();
  const initial = parsePath();
  const [lang, setDocumentLang] = useState<HelpLocale>(initial.lang);
  const [topicId, setTopicId] = useState<HelpTopicId | null>(initial.topicId);
  const [query, setQuery] = useState("");

  useEffect(() => {
    document.documentElement.lang = lang;
    setLang(lang as Lang);
  }, [lang, setLang]);

  useEffect(() => {
    const onPop = () => {
      const next = parsePath();
      setLang(next.lang);
      setTopicId(next.topicId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const topic = topicId ? data.topics.find((candidate) => candidate.id === topicId) : undefined;
  const html = topic?.html[lang] ?? topic?.html.ru;
  const status = topic?.translationStatus ?? "current";

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    return data.search[lang].filter((entry) =>
      [entry.title, entry.summary, entry.text].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [lang, query]);

  const go = (nextLang: HelpLocale, id: HelpTopicId | null = topicId) => {
    const path = id ? `/help/${nextLang}/${id}` : `/help/${nextLang}`;
    window.history.pushState(null, "", path);
    setDocumentLang(nextLang);
    setTopicId(id);
  };

  return (
    <div className="help-page">
      <header className="help-topbar">
        <a className="help-brand" href="/" aria-label="remo">
          <img src="/remo-logo.svg" alt="" />
        </a>
        <a className="help-back" href="/">{t("help.back")}</a>
        <ThemeSwitch />
        <nav className="help-langs" aria-label={t("help.language")}>
          {(["ru", "en"] as const).map((code) => (
            <button
              key={code}
              type="button"
              className={code === lang ? "active" : undefined}
              aria-pressed={code === lang}
              onClick={() => go(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <main className="help-main">
        {topic ? (
          <article className="help-article">
            <nav className="help-crumbs" aria-label={t("help.title")}>
              <a href={`/help/${lang}`}>{t("help.title")}</a>
              <span aria-hidden="true">/</span>
              <span>{topic.title[lang]}</span>
            </nav>
            {status !== "current" && (
              <p className="help-notice" role="status">
                {status === "missing" ? t("help.translationMissing") : t("help.translationOutdated")}
              </p>
            )}
            <h1>{topic.title[lang]}</h1>
            <p className="help-summary">{topic.summary[lang]}</p>
            {html ? (
              <div className="help-body" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <p className="help-notice" role="alert">{t("help.topicNotFound")}</p>
            )}
            {topic.related.length > 0 && (
              <aside className="help-related">
                <h2>{t("help.related")}</h2>
                <ul>
                  {topic.related.map((id) => {
                    const related = data.topics.find((candidate) => candidate.id === id);
                    return related ? (
                      <li key={id}><a href={`/help/${lang}/${id}`}>{related.title[lang]}</a></li>
                    ) : null;
                  })}
                </ul>
              </aside>
            )}
          </article>
        ) : (
          <>
            <div className="help-hero">
              <h1>{t("help.title")}</h1>
              <p>{t("help.intro")}</p>
              <label className="help-search">
                <span className="rm-sr">{t("help.search")}</span>
                <input
                  type="search"
                  value={query}
                  placeholder={t("help.searchPlaceholder")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>

            {results ? (
              <section className="help-section">
                <h2>{t("help.results")}</h2>
                {results.length === 0 ? (
                  <p className="help-notice">{t("help.noResults")}</p>
                ) : (
                  <ul className="help-list">
                    {results.map((entry) => (
                      <li key={entry.id}>
                        <a href={`/help/${lang}/${entry.id}`}>{entry.title}</a>
                        <p>{entry.summary}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              TYPES.map((type) => {
                const items = data.topics.filter((candidate) => candidate.type === type);
                if (!items.length) return null;
                return (
                  <section className="help-section" key={type}>
                    <h2>{t(`help.types.${type}` as "help.types.tutorial")}</h2>
                    <ul className="help-list">
                      {items.map((item) => (
                        <li key={item.id}>
                          <a href={`/help/${lang}/${item.id}`}>{item.title[lang]}</a>
                          <p>{item.summary[lang]}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </>
        )}
      </main>
      <footer className="help-about">
        <span>{ABOUT.name} {ABOUT.version}</span>
        <span>© {ABOUT.year} {ABOUT.author}</span>
        <a href={`/help/${lang}/about.remo`}>{ABOUT.license}</a>
        <a href={ABOUT.source} rel="noopener">{t("about.source")}</a>
      </footer>
    </div>
  );
}
