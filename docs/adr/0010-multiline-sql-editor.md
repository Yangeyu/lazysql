# ADR 0010：SQL 编辑器改用原生 `<textarea>`（多行 + 滚动，取代 0008 的「单行」取舍）

- 状态：已接受（代价 3「定高 10 行」被 ADR 0013 修订为两档定高）
- 日期：2026-06-30
- 关联：ADR 0003（OpenTUI）、ADR 0008（原生输入 widget）——本 ADR **取代 0008「代价 1：SQL 编辑器变单行」那一条**，其余 0008 决策不变。

## 背景

ADR 0008 把 SQL 编辑器定为单行原生 `<input>`，并把「失去多行显示、长查询水平滚动」记成可接受的代价；
当时否决 `<textarea>` 的理由是它**不暴露 `onInput`**（拿不到实时值，补全失效）、Enter 需改键、↑/↓ 与历史冲突。

实际使用里单行成为唯一实打实的编辑器短板:写/读一条多行 JOIN 只能在一行内水平滚动。复核 OpenTUI 0.4.2
后,0008 的否决理由已软化:`<textarea>`（`TextareaRenderable`）虽仍无 `onInput`,但暴露了 `onContentChange`
+ `plainText`/`cursorOffset`（经 ref 读实时值），键位经 `keyBindings` 可配置（`submit`/`newline` 是两个独立
action），软换行 + 滚动 + 选区 + 撤销由 `EditBuffer`/`EditorView` 内核白送。

## 决策

SQL 编辑器从 `<input>` 迁到原生 `<textarea>`（`wrapMode="word"`），多行软换行 + 垂直滚动。

### 1. 布局:ask 块钉住,只有编辑区滚动

编辑面板内列向排布,`✦ ask` 行、分隔线、反馈行是 `<textarea>` 的**兄弟节点**（`flexShrink=0`，钉住）,
`<textarea>`（`flexGrow=1`）是**唯一滚动区**——其滚动由 `EditorView` 在自身内部完成,够不到兄弟,所以
「滚动时 ask 块不动」是组件树结构保证的,不靠运行时判断。面板高度固定（`editorRows`，见 `layout.ts`）,
内容超出可视行即在区内滚动。

### 2. 受控 → widget 自持 + store 镜像（差异即程序化写）

`<textarea>` 无受控 `value`,buffer 归 widget。方向因此从 0008 的 *store→widget 受控* 翻成 *widget→store 镜像*:

- **读 / 镜像**:`onContentChange` / `onCursorChange` 经 ref 读 `plainText` + `cursorOffset` →
  `setQuery(text, caret)`（更新镜像 `queryText`/`editorCaret`,按光标重算补全）。
- **程序化写**（历史回填、NL 填充、运行后清空、接受补全）:动作只改 store 的 `queryText`/`editorCaret`;
  组件一个 `useEffect([queryText, editorCaret])` 在**二者与 widget 实际值不一致时**才 `setText` + 置
  `cursorOffset`。用户打字时镜像已与 widget 相等 → 该 effect 是 no-op（光标不跳）;只有程序化写造成不一致才落到
  widget。无需逐处加版本号:差异检测统一兜住所有程序化写(含运行后 `queryText:''` 的清空)。

0008「store 只留已提交值」仍成立——镜像即已提交值。

### 3. 键位（对照 OpenTUI 0.4.2 实测默认表）

- **Enter = 运行**:经 `keyBindings` 把默认 `return→newline` 盖成 `return→submit`（`onSubmit`→`executeQuery`）,
  保住 0008 起就有的「⏎ 运行」契约与既有测试/习惯。
- **Shift+Enter = 换行**:加 `{name:'return', shift:true, action:'newline'}`。仅 kitty 键盘协议终端能区分
  Shift+Enter 与 Enter(`parseKittyKeyboard` 解 `\x1b[13;2u` 为 `{name:'return',shift:true}`);老终端两者都发
  `\r` → 退化为「运行」(敲不出硬换行,不致命)。默认保留的 `⌥+Enter→submit` 是无害兜底。
- **历史 `↑/↓` → `^P/^N`**:多行里 `↑/↓` 归 textarea 光标移动(其默认绑定),与历史冲突,故历史迁到
  `^P/^N`(textarea 默认不占,经全局 `dispatchKey` 触发)。
- **`^T` 切换补全**:schema 补全可开关(`completionsOn`);关时不算不显,`Tab` 退化为切面板。
- `Tab`(接受补全/切面板)、`esc`(→grid)、`^G`(NL)、`^C`(清空/退出) 不变。

## 代价 / 边界（记录在案）

1. **Shift+Enter 依赖终端**:见上,非 kitty 协议终端敲不出硬换行(运行永远可用)。
2. **接受补全的光标**:补全在光标处替换残词并把光标置于候选之后(`editorCaret` 驱动),多行/串中均准;
   但程序化写经 `setText` 会重置 textarea 的内部撤销历史(接受补全不可经 `^-` 撤销),可接受。
3. **编辑面板定高**:`editorRows` 固定(textarea 内部滚动),不随内容增长——避免与结果网格抢空间、保持布局可预测。

## 结论

SQL 编辑回归多行原生 `<textarea>`:软换行 + 滚动 + 选区 + 撤销由内核提供,ask 块钉住,补全可开关且仍 schema 感知,
`⏎ 运行` 契约不变。domain / application 一行未改。0008 的「单行」取舍就此退役。
