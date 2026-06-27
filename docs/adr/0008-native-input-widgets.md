# ADR 0008：文本输入改用 OpenTUI 原生 widget（取代 0007 的自绘 TextField）

- 状态：已接受
- 日期：2026-06-27
- 关联：ADR 0003（TUI 框架 / OpenTUI）、ADR 0007（输入管线：自绘 TextField）——本 ADR **取代 ADR 0007 的输入模型部分**

## 背景

ADR 0007 把可编辑文本建模成自绘的 `TextField { value, cursor }`：store 持有光标索引，
`<TextInput>` 在光标处切分文本、画一个光标字形，多行 SQL 经 `wrapWithCursor` 自己折行定位光标。

落地后暴露两个问题：

1. **光标字形会推移文本**。字符网格里「渲染出来」的光标必占一个单元格，把它插在字符之间，
   后面的字符就右移一格——光标在串中移动时整段文本「跳动」。真正零宽、夹在字符之间的细竖条,
   网格根本画不出，只有终端硬件光标能做。
2. **这套是在重新发明 OpenTUI 已有的轮子**。OpenTUI（OpenCode 在其上打磨）自带一整套原生文本栈：
   `EditBuffer`（rope 缓冲，grapheme 光标、undo/redo、词边界）、`EditorView`（软换行、滚动、选区、
   `getVisualCursor`）、以及 `InputRenderable`/`TextareaRenderable`，在 React 层暴露为 `<input>` /
   `<textarea>`。光标由原生渲染器统一绘制（不跳），并可选 block/line/underline。

## 决策

四个文本输入（过滤、单元格编辑、NL ask、SQL 编辑器）**全部改用原生 `<input>`**，删除自绘栈。

### 1. widget 拥有短暂编辑态，store 只留已提交值

光标、undo 这类**短暂编辑态归 widget**；store 不再存 `filterDraft/editDraft/nlDraft`，`queryText`
退回普通 `string`（仅作为 SQL `<input>` 的受控 `value`）。对接：

- **过滤 / 编辑**：input 由「该列已有过滤值 / 当前单元格值」**种子**（在视图里派生），`onSubmit(value)`
  → `commitFilter(value)` / `submitEdit(value)`；store 不持草稿。
- **NL ask**：`onSubmit(prompt)` → `generateFromNl(prompt)`。
- **SQL 编辑器**：受控——`value={queryText}`，`onInput` → `setQuery`（重算补全），`onSubmit` →
  `executeQuery`；历史 / 补全 / NL 都经同一个 `value` prop 驱动；空时把 browse 语句作为 `placeholder` 回显。

### 2. keymap 与 widget 协作

聚焦的 widget 自己吃文本键、光标键、Enter（提交）；全局 `dispatchKey` 仍收到这些键但**对它们不作为**。
所以这些上下文里只保留 widget **不消费**的应用级键：`Esc`（离开 / 取消）、`^G`（问 AI）、`Tab`（补全 / 切面板）、
`^C`（退出）。widget 自管的键（打字、`⏎` 提交）从 keymap 删除其行为，`⏎` 留作 footer/help 的**纯展示行**
（`KeyBinding.match/run` 因此变可选）。

### 3. 删除自绘栈

`textField.ts`、`wrap.ts`、`TextInput.tsx` 及其测试全部删除。

### 4. 连接表单也迁到原生 `<input>`（含驱动选择行 + 一个特殊的密码字段）

连接表单原是迁移前遗留的 append-only 字形光标，**本次一并归一**：每个非密码字段是聚焦时挂载的原生
`<input>`（受控，值存 store；同一时刻只挂一个，避免离开字段后原生焦点滞留导致按键串入），获得真光标 /
中间编辑 / 与全仓一致的 accent 竖线。两处刻意保留差异：

- **Driver 成为可聚焦的一行**（`index === DRIVER_ROW`）。`←/→` 只在它聚焦时切换驱动 → 文本框里的 `←/→`
  归还给光标移动，**冲突消除**；驱动显示全称（PostgreSQL）。
- **密码字段是唯一的例外**：OpenTUI 原生 `<input>` **无掩码能力**（core 无 mask/password/echo），
  所以这一个 secret 字段仍由 store 渲染成 `•` 圆点（dispatcher 的 `text` 入口只为它路由原始字符，
  且仅在聚焦字段确为 secret 时生效），并加 `^R` 临时显形以便核对。这是「有特殊意义」的诚实建模。

## 代价 / 边界（记录在案）

1. **SQL 编辑器变单行**。`<input>` 单行、Enter=运行（与既有行为一致——之前 Enter 也是运行、不能输入换行），
   但失去了「多行折行**显示**」的观感，改为水平滚动。`<textarea>` 能保留多行显示，但实测它**不暴露 onInput**
   （拿不到实时值，补全要不到），且 Enter 需改键、↑/↓ 与历史冲突——代价更大，故选 `<input>`。编辑器面板因此固定为 6 行。
2. **密码字段不能中间编辑**。掩码在 OpenTUI 里没有原生支持，故 secret 字段是 store 渲染的 append-only 圆点
   （`^R` 可显形核对）；这是它与其它原生 `<input>` 字段唯一的机制差异，由掩码这一特殊意义决定。
3. **光标样式已统一**：所有原生 `<input>` 经 `INPUT_CURSOR`（`cursorStyle={{style:'line',blinking:false}}`
   + `cursorColor={accent}`）画成稳定的 accent 竖线；密码字段的字形 `Caret`（`▏` accent）是它在不能用真光标
   处的同形镜像。

## 结论

文本输入回归 OpenTUI 原生 widget：光标由终端 / 原生渲染器绘制（**不再跳动**），编辑能力（grapheme、undo、
词操作、选区）由经生产验证的内核提供，store 只保留已提交值——**状态更不重叠、代码更少**。domain / application
一行未改。ADR 0007 的 TextField 模型就此退役。
