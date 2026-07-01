# ADR 0011：单元格编辑并入 cell inspector（多行 textarea,取代 status-bar 行内编辑）

- 状态：已接受
- 日期：2026-07-01
- 关联：ADR 0008（原生输入 widget）、ADR 0010（多行 SQL `<textarea>`）、ADR 0006（lazygit 导航）

## 背景

原来编辑一个单元格(`e`)走的是 **status bar 里一个单行 `<input>`**(顶层 `mode:'edit'`):种子为该格的值,`⏎` 提交 → 暂存 confirm → `updateRow`(RowEditable 端口)写回。

单行是硬伤:**JSON / JSONB / 长文本根本没法编辑**——看不到结构、放不下多行。而 cell inspector(`⏎` 打开)本就是"整值只读面":pretty-print JSON、按宽换行、`j/k` 滚动。读在这里、改却在别处(挤在状态栏),既割裂又受限。ADR 0010 又刚落地了多行 `<textarea>`,正是编辑大值要的部件。

## 决策

**编辑并入 cell inspector,读写同面。** `CellInspect` 从"只读切片"升为一个判别联合:

```ts
interface CellInspect { column; value; offset; mode: 'view' | 'edit' }
```

- **入口(单一)**:grid 上 `⏎` 开 inspector(`mode:'view'`),view 面里 `e` 进 edit(`mode:'edit'`)。grid **不再保留 `e` 直进编辑的快捷键**——编辑统一「先看清整值,再改」,入口只此一条 `⏎ → e`。
- **edit 面**:值区换成聚焦的 `<textarea>`,种子为**原始值**(见下),`wrapMode="word"`。
- **键位**:值是"内容"不是"命令",所以 **`Enter`=换行**(textarea 默认)、**`^S`=保存**(经 `keyBindings` 加 `{name:'s',ctrl,action:'submit'}` → `onSubmit` → `submitEdit`)、**`esc`=丢弃编辑、回到 view**(不直接关掉 inspector)。`submitEdit` 仍暂存同一个 update confirm(y/n)→ `updateRow`。**domain / application / adapter 与写回路径一行未改**——只换了输入面。
- **导航是一条栈,`esc` 每次弹一层**:`grid → ⏎ → view → e → edit`,`esc` 反向 `edit → view → grid`。之所以能让 `edit` 的 `esc` 干净地回落到 `view`(而非直接关掉、或需要记「从哪进来的」),正因为入口收成了单一路径——`edit` 必经 `view`,所以 `esc→view` 永远是「回到编辑开始的地方」,零路径依赖、无需 `returnTo` 状态。`cancelEdit` 因此从「置 `cellView:null`」改为「把 `mode` 翻回 `view`」。
- **状态形状**:顶层 `mode:'edit'` 退役(从 `Mode` 联合删除),编辑态收进 `CellInspect.mode`(不加 `isEditing` 补丁标志,符合状态守则的"不重叠/联合表达")。`deriveContext`:`cellView.mode==='edit'` → `cellEdit` 上下文,否则 `cell`。status-bar 的行内编辑分支及其 props 一并删除。

### 编辑原始值,不 pretty-print

view 面会美化 JSON;edit 面**按原始值编辑**(`cellEditText`,不美化)。原因:美化后保存会**重排** —— 对 `json/jsonb` 列无所谓(DB 归一化),但对**存了 JSON 字符串的 `text` 列会静默改字节**。取原始值最安全;紧凑 JSON 靠 textarea 换行兜底可读性。二进制(blob)不可文本编辑,`beginEdit` 前置拦截。

## 代价 / 边界（记录在案）

1. **编辑从状态栏变成浮层**:短标量的快速改动多一个浮层,但换来一个面统一读写、且能处理任意大小的值——一致性优先。
1a. **进编辑多一次按键**:原来 grid `e` 一键直改,现在 `⏎ → e` 两键。刻意为之——被编辑的多是 JSON/长文本(本 ADR 的动因),本就该先看清再改;换来单一入口 + `esc` 单层弹栈的干净心智模型。
2. **`null` 与空串不可区分**:`null` 种子为空草稿,保存即空串(沿用旧行内编辑的同一局限,未回退)。
3. **`json/jsonb` 列按类型美化编辑**:v1 一律编辑原始值;"按列类型对 JSON 列美化编辑(DB 本就归一化,无重排风险)"是 type 感知的后续。
4. **超大值**:`$EDITOR` 外部编辑(挂起 TUI 调起 vim)是 power-user 的后续方向,不在本 ADR。

## 结论

单元格的读与写回归同一个浮层:多行 `<textarea>` 让 JSON/长文本可编辑,`Enter=换行 / ^S=保存 / esc=丢弃回 view`,写回与端口零改。入口收成单一 `⏎ → e`,导航成一条 `grid→view→edit` 的栈、`esc` 逐层弹回。顶层 `edit` 模式退役,编辑态收进 `CellInspect` 的联合里——状态更不重叠、少一个状态栏特例。
