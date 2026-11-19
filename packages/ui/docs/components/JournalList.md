# JournalList

AI-журнал: seq, время, действие, агент и модель, токены, стоимость, статус — табличными цифрами.

## Правила
- Строится на Table. Числа (`seq`, токены, стоимость) — справа, `tabular-nums`, через `Intl.NumberFormat`.
- Статус — Badge со словом; «Ошибка» — с иконкой и текстом причины в инспекторе.
- Порядок — по `seq`, новые сверху.

## Состояния
done · pending · failed · rejected. Девять интерактивных состояний не применимы: журнал — данные, действия — в строках.

## Потребитель передаёт
- `entries`: `{seq, time, action, agent, model, tokens, cost, status: 'done'|'pending'|'failed'|'rejected'}`, `maxHeight`.
