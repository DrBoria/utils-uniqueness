# Pair view — данные, примеры, форматы колонок

Документ описывает парный экран отчёта (`utils-overview.html` → `Findings with a diff` → выбранная пара):
что за данные он рисует, как из них получаются блоки и ленты, и что можно показать в 2 / 3 / 5 колоночном формате.

Живой пример пары:

```
local   src/backend/console-handlers.ts:10   handleGetConsole
canonical src/backend/console-handlers.ts:48   handleSearchConsole
```

---

## 1. Что приходит из decision maker

Две разные вещи, и их нельзя путать.

### 1.1. Модель пары целиком — `pair.analysis`

Считается в `report/matchers/*/model.js → build(left, right)`. Это то, по чему матчер выставил скор.

| сигнал | что сравнивается | поля модели |
|---|---|---|
| `signature` | параметры **по позициям** | `params[{ index, left{name,type,role}, right{...}, same, sameName, sameType }]`, `sameCount`, `sameName`, `sameReturn`, `sameParamCount`, `score` |
| `structure` | множество конструкций тела | `left[]`, `right[]`, `both[]`, `all[]`, `onlyLeft[]`, `onlyRight[]`, `score` |
| `ast` | нормализованные поддеревья | `left`, `right` (сериализованные деревья), `leftCount`, `rightCount`, `sharedCount`, `score` |
| `controlFlow` | последовательность ветвлений | `left[]`, `right[]`, `steps[{ index, left, right, same }]`, `firstBreak`, `sameCount`, `score` |

Скор сигнатуры считается **только по `role`** параметра. Имена и типы показываются, но на скор не влияют.

### 1.2. Вердикт по каждой строке — `row.marks` и `row.annot`

Считается в `report/user-report/data/annotate.js → markRow(row)` на паре «левая ячейка ↔ правая ячейка» одной строки.

| сигнал | правило `same` | что лежит рядом (`row.annot`) |
|---|---|---|
| `signature` | строка сигнатуры совпала целиком | `signature.left/right` |
| `structure` | множества конструкций строки равны | `structure.left/right` |
| `ast` | форма с erased-именами совпала | `ast.left/right` |
| `controlFlow` | последовательность ветвлений совпала | `flow.left/right` |

Плюс построчно: `dupLeft` / `dupRight` (встречается ли точный текст этой строки в другом файле) и `overlap` (разбиение изменённой строки на слоты «что именно разошлось»).

---

## 2. Один пример — четыре matcher-а

Берём **одну пару строк** из этой пары функций:

```ts
// left  (строка 12)
	env: string
// right (строка 50)
	env?: string
```

Дальше — что вернул decision maker по каждому из четырёх matcher-ов. Значения получены запуском
`report/user-report/data/annotate.js` на этих же строках, не «на глаз».

### 2.1. signature — «строка сигнатуры совпала?»

```js
signatureOf("	env: string")   // → null
signatureOf("	env?: string")  // → null
```

`signatureOf` ищет пару `(...)` + хвост/возвращаемый тип **на одной строке**. Здесь скобок нет,
поэтому вердикта нет вообще: в `row.marks` ключа `signature` не появляется.

```js
marks → { }
```

### 2.2. structure — «набор конструкций строки совпал?»

```js
constructs("	env: string")    // → Set(0)  {}
constructs("	env?: string")   // → Set(1)  { "?" }
```

```js
marks → { structure: "differs" }
```

### 2.3. ast — «форма с erased-именами совпала?»

```js
generalize("	env: string")    // → "$: $"
generalize("	env?: string")   // → "$?: $"
```

```js
marks → { ast: "differs" }
```

### 2.4. controlFlow — «последовательность ветвлений совпала?»

```js
branches("	env: string")      // → []
branches("	env?: string")     // → []
```

Обе пустые → вердикта нет, ключа `controlFlow` в marks не будет.

### 2.5. Итог по этой паре строк

```js
// row.marks
{ structure: "differs", ast: "differs" }

// row.annot — сырьё, которое видно в панели Detail
{
  structure: { left: [],        right: ["?"] },
  flow:      { left: [],        right: []   },
  ast:       { left: "$: $",    right: "$?: $" },
  signature: { left: null,      right: null }
}
```

Вывод: строка не является соответствием ни по одному matcher-у → в блок не попадает, ленты не получает.

---

### 2.6. Те же четыре matcher-а на строке, которая совпала

```ts
// left и right — одна и та же строка
	const allLogs = diagnosticsManager.getAllLogs()
```

```js
signatureOf  → "()"                    / "()"                     → same
constructs   → ["const", "call:$"]     / ["const", "call:$"]      → same
generalize   → "const $ = $.$()"       / "const $ = $.$()"        → same
branches     → []                      / []                       → вердикта нет
```

```js
marks → { signature: "same", structure: "same", ast: "same" }
```

### 2.7. И на строке с ветвлением

```ts
	if (env === "backend") {
```

```js
signatureOf  → "(env === \"\")"        / то же                    → same
constructs   → ["if", "call:if", "==="] / то же                    → same
generalize   → "if ($ === \"\") {"     / то же                    → same
branches     → ["if"]                  / ["if"]                   → same
```

```js
marks → { signature: "same", structure: "same", ast: "same", controlFlow: "same" }
```

### 2.8. Чем это отличается от модели пары

Всё выше — **построчные** вердикты (`row.marks`). Из них строятся блоки и ленты.

Отдельно есть **модель пары** (`pair.analysis[mode]`), которую показывает панель Detail. Для этой пары
модель `signature` содержит реальные значения:

```js
analysis.signature = {
  left:  { name: "handleGetConsole",  returnRole: "string" },
  right: { name: "handleSearchConsole", returnRole: "string" },
  sameName:    false,   // имена НЕ входят в скор
  sameReturn:  true,
  params: [ … по одному элементу на позицию параметра … ],
  sameCount:   2 of 2,  // совпали по ROLE
  score:       1.00,
}
```

Формы остальных трёх моделей — в разделе 1.1, а конкретные значения для выбранной пары всегда
видны в панели Detail под соответствующим табом.

---

## 3. Как из этого получаются блоки и ленты

Правило одно и оно из данных:

```
блок = максимальный отрезок подряд идущих строк,
       где row.marks[выбранный сигнал] === "same"
```

Для этой пары при активном табе `Signature` получаются блоки:

```
params: {                      1 строка   ↔  1 строка
env: string / level? … / …     6 строк    ↔  6 строк   (подпись «level?: string»)
surface?: string               3 строки   ↔  3 строки
if (limit > 10) throw …        1 строка   ↔  1 строка
if (!frontendBridge) {         2 строки   ↔  2 строки
```

Подпись блока — **первая строка блока**, обрезанная до 28 символов (`model.js → labelOf`). Отсюда и `level?: string` в центре: это первая строка своего блока, а не имя сущности.

### Геометрия одной ленты

```
x:  left pane │ gutter │ right pane
    ──────────┤        ├──────────
    блок      ─┐      ┌─  блок
    (N строк)  │ лента │  (M строк)
    ──────────┘        └──────────
               18px в середине
```

* высота ленты у блока — полная высота блока;
* в середине — **ровно одна строка (18px)**, там стоит подпись;
* изгиб занимает 22% зазора с каждой стороны (`bendOf`), середина — плоская полоса;
* толщина не зависит от размера блока: `half = min(9, minHeight / 2)`.

---

## 4. Форматы колонок

Сейчас в коде — три части, и чипы `3 / 4 / 5` меняют ширину средней: 220 / 300 / 380 px.

### 4.1. Две колонки (без центральной)

Только код друг против друга и подсветка блоков. Ленты негде рисовать, поэтому связь читается по одинаковой подсветке.

```
┌───────────────────────────────┬───────────────────────────────┐
│ 10 export async function …    │ 48 export async function …    │
│ 11   params: {                │ 49   params: {                │
│ 12     env: string            │ 50     env?: string           │
│ 13     level?: string         │ 52     level?: string         │
└───────────────────────────────┴───────────────────────────────┘
   красная строка = «матчер считает её одинаковой» на обеих сторонах
```

### 4.2. Три колонки (код │ центр │ код) — по умолчанию

Центр — ленты и подписи. Номера строк отдельными плашками по внешним краям.

```
┌───┬──────────────────────────┬────────────────────┬──────────────────────────┬───┐
│ 10│ export async function …  │   ╭────────────╮   │ export async function …  │ 48│
│ 11│   params: {              │ ──┤   params   ├── │   params: {              │ 49│
│ 12│     env: string          │   ╰─────┬──────╯   │     env?: string         │ 50│
│ 14│     level?: string       │ ────────┴────────  │     level?: string       │ 52│
└───┴──────────────────────────┴────────────────────┴──────────────────────────┴───┘
      номер+код                  центр: лента+подпись   код+номер
```

### 4.3. Пять колонок

Пять частей — это номера и код, разведённые в отдельные дорожки: `номера │ код │ центр │ код │ номера`. Нужно, когда номера должны быть своей полосой (своя фоновая плашка, своя ширина) и не участвовать в горизонтальном скролле кода.

```
┌────┬──────────────────┬──────────────┬──────────────────┬────┐
│ 10 │ export async …   │  ╭────────╮  │ export async …   │ 48 │
│ 11 │   params: {      │ ─┤ params ├─ │   params: {      │ 49 │
│ 12 │     env: string  │  ╰───┬────╯  │     env?: string │ 50 │
└────┴──────────────────┴──────────────┴──────────────────┴────┘
  ▲     ▲                 ▲              ▲                  ▲
  номера отдельно         центр          код                номера
```

---

## 5. Примеры отчёта: панель Detail

Панель внизу печатает модель выбранного таба, а не пересказ.

### Signature

Реальные значения этой пары (проверено в браузере).

```
Signature            name, parameters and return type
name     handleGetConsole ≠ handleSearchConsole
return   string ≡ string
 1       params: { env: string; level?: string; … } → payload ≠ …
 2       query: string → filter            ≠  —
roles    2 of 2 parameters share the role · score 1.00
```

### Structure

Формат вывода; набор конструкций зависит от пары (ниже — иллюстрация).

```
Structure            the set of constructs the body is built from
left      ["?", "const", "if", "try", "call:$"]
right     ["?", "const", "if", "try", "call:$"]
both      ["?", "const", "if", "try", "call:$"]
only left —
only right—
score     5 shared of 5 · 1.00
```

### AST

Формат вывода; числа — иллюстрация (реальные приходят из `model.leftCount` / `rightCount` / `sharedCount`).

```
AST                  the exact expression tree of the body
subtrees  left 84 · right 97 · shared 71 · score 0.78
left tree  ["Program",[…]]
right tree ["Program",[…]]
```

### Control flow

Формат вывода; шаги приходят из `model.steps`, поэтому реальные значения всегда видны в самой панели.

```
Control flow         the order of branches, loops and returns
 1   try      ≡   try
 2   if       ≡   if
 3   return   ≠   if
score 2 of 3 steps match · score 0.67 · first break at step 3
```

### Открытый блок (клик по подписи)

```
Signature            block rows 14–17 ↔ 52–55
 14   level?: string  ≡  level?: string
 15   limit?: number  ≡  limit?: number
 16   cursor?: number ≡  cursor?: number
 17   search?: string ≡  search?: string
```

---

## 6. Что важно помнить

1. **Блоки — из `row.marks`, не из смежности строк.** Строка, которую матчер назвал `differs`, в блок не входит: она видна, но не подсвечена и ленты не имеет.
2. **Подпись — первая строка блока.** Это не имя сущности. Если нужен осмысленный ярлык, его надо брать из `pair.analysis` (например, `signature.role` списка параметров), а не из текста строки.
3. **`signature` построчно почти всегда `null` для многострочных сигнатур.** Скор пары при этом считается по модели, а не по строкам.
4. **Колонки независимы.** Каждая панель — свой скролл по обеим осям; номера строк живут в отдельной плашке вне горизонтального скролла и сдвигаются только по вертикали.
5. **Скролл синхронизируется по строкам**, а не по пикселям: верхняя видимая строка одной панели ставит свою пару на то же место в другой.
