# @remo/ui — дизайн-система REMO

Токены, компоненты (TSX), иконки и шрифт. Брендбук и гайдлайны — `docs/` (начать с `docs/brand.md`). Решения — ADR-078.

## Подключить

```tsx
import "@remo/ui/styles.css";                 // шрифт, токены, компоненты — один раз в корне
import { UiStringsProvider, Button } from "@remo/ui";
import { useI18n } from "./i18n";

const { ui } = useI18n();                     // адаптер: ключи @remo/ui → слова ds.* в i18n.tsx
<UiStringsProvider value={ui}><Button variant="primary">…</Button></UiStringsProvider>
```

Тема — `data-theme="light|dark"`, плотность — `data-density="compact"` на любом контейнере. Canvas 2D берёт цвета через `readCanvasTokens()`.

## Команды

| | |
|---|---|
| `pnpm ds:tokens` | сгенерировать `src/tokens/*.css` из `tokens.json` |
| `pnpm ds:check` | токены свежие + линтер имён, контраст, stylelint |
| `pnpm ds:contrast` | все пары цветов ≥ 4.5 / 3 в обеих темах |
| `pnpm test` | токены, литералы, рендер компонентов |
| `pnpm dev:web` → `/__ds` | каталог; `?view=board\|share\|agent` — эталоны |

## Добавить компонент

1. **Токен, если нужен** — в `src/tokens/tokens.json` (слой: значение → `primitive`, роль → `semantic` только алиасом, размер компонента → `component`), затем `pnpm ds:tokens`.
2. **Код** — `src/components/<group>.tsx`, экспорт в `src/components/index.ts`. Стили — в `components.css`, только `var(--…)`, `transparent`, `currentColor` (stylelint и тест упадут на литерале).
3. **Строки** — ключ в `UiKey` (`src/i18n.tsx`) и перевод `ds.<ключ>` в `apps/web/src/i18n.tsx` для RU и EN; без перевода не соберётся.
4. **Состояния** — все девять (`default, hover, active, focus-visible, disabled, loading, error, read-only, selected`); неприменимые объявить в гайдлайне. Добавить строку в матрицу или в таблицу объявлений `apps/web/src/ds/Catalog.tsx` и живой пример в раздел.
5. **Гайдлайн** — `docs/components/<Name>.md`: назначение, анатомия, варианты, размеры, состояния, поведение, a11y, запреты (+ геометрия для объектов холста).
6. `pnpm ds:check && pnpm test`, клавиатурный прогон каталога, запись в `CHANGELOG.md`.
