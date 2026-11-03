// Sample content for the design-system catalogue (/__ds). This is fixture DATA shown
// inside components — people, boards, stickers — in both languages, so the RU/EN
// overflow check sees realistic lengths. Interface labels still come from i18n.tsx.
import type { Lang } from "../i18n";

export function fixtures(lang: Lang) {
  const ru = lang === "ru";
  return {
    board: ru ? "Ретро спринта 42" : "Sprint 42 retro",
    boardLong: ru ? "Карта пути клиента — онбординг B2B, версия для согласования с продажами" : "Customer journey — B2B onboarding, version for sign-off with sales",
    people: ru ? ["Александр Костылев", "Мария Ким", "Олег Пак", "Ира Лис", "Дан Ли", "Ян Ру", "Ева Сон"] : ["Alexander Kostylev", "Maria Kim", "Oleg Pak", "Ira Lis", "Dan Lee", "Yan Ru", "Eva Son"],
    agent: ru ? "Аналитик ретро" : "Retro analyst",
    team: ru ? "Команда PM · 8 участников" : "PM team · 8 members",
    sources: ru
      ? { owner: "Владелец доски", direct: "Выдано напрямую · Александр Костылев, 12.10.2026", team: "Команда · роль задаёт админ организации", inherited: "Через команду PM — изменить можно у команды", agent: "Агент · область: эта доска · бюджет 20 $" }
      : { owner: "Board owner", direct: "Granted directly · Alexander Kostylev, 12.10.2026", team: "Team · the organisation admin sets the role", inherited: "Through team PM — change it on the team", agent: "Agent · scope: this board · budget $20" },
    frames: ru ? ["Что мешало", "Что помогло", "Идеи", "Черновик"] : ["What got in the way", "What helped", "Ideas", "Draft"],
    stickers: ru
      ? ["Долго ждали ревью дизайна", "Тесты падали на CI", "Не было доступа к доске заказчика", "Много встреч", "Ретро раз в две недели", "Парное программирование", "Релиз по плану", "Добавить офлайн-статус"]
      : ["Waited too long for design review", "Tests kept failing on CI", "No access to the client's board", "Too many meetings", "Retro every two weeks", "Pair programming", "Release on schedule", "Add an offline status"],
    task: ru ? "Сгруппируй стикеры во фрейме «Что мешало» по темам и подпиши кластеры." : "Group the stickers in “What got in the way” by theme and label the clusters.",
    budgetError: ru ? "Не больше 20 $ — лимит организации." : "At most $20 — the organisation limit.",
    agentRights: ru ? "комментатор на этой доске · выдал Александр Костылев. Агент не видит другие доски." : "commenter on this board · granted by Alexander Kostylev. The agent cannot see other boards.",
    journal: ru
      ? ["Сгруппировал 42 стикера в 6 кластеров", "Написал резюме фрейма «Что мешало»", "Попытка изменить доску вне области задачи"]
      : ["Grouped 42 stickers into 6 clusters", "Summarised the “What got in the way” frame", "Tried to change the board outside the task scope"],
    url: "https://remo.app/b/3f9c2a",
    date: new Intl.DateTimeFormat(ru ? "ru-RU" : "en-GB").format(new Date(2026, 9, 31)),
  };
}

export type Fixtures = ReturnType<typeof fixtures>;
