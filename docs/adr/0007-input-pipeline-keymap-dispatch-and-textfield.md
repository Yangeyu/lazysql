# ADR 0007：输入管线——键位表统一派发 + TextField 编辑模型

- 状态：已接受
- 日期：2026-06-27
- 关联：ADR 0003（TUI 框架 / OpenTUI）、ADR 0006（lazygit 导航：键位注册表）——本 ADR **修订 0006 §1**

## 背景

ADR 0006 §1 把键位注册表定为「**文档**的唯一真相」，footer 与 `?` 帮助都从一张
`GROUPS: Record<KeyContext, KeyGroup>` 渲染——但它明确把**派发逻辑留在 `App` 的输入处理器**，
注册表「只负责描述，不负责执行」。结果是「某个键在某上下文做什么」被声明了**两遍**：表里有描述、
`App` 里有一段 ~150 行命令式 if/else 真正执行。两者会漂移（典型 bug：编辑器 footer 宣称 `q`/`:` 可用，
而它们在编辑器里其实是字面字符）。

文本输入则是另一处形状缺陷：四个草稿（`queryText`/`filterDraft`/`editDraft`/`nlDraft`）是**裸字符串**，
编辑是 append + backspace，光标是**隐式的末尾位置**——无法串内编辑，且「聚焦时在末尾贴一个光标字形」
在 5 处组件各写一遍。OpenTUI 迁移后（ADR 0003）输入接缝是 `useKeyboard`。

目标：在不破坏分层、不堆条件式的前提下，让输入**逻辑链路清晰、状态不重叠、符合演进**（CLAUDE §0.5、§2.5、§2.7）。

## 决策

### 1. 键位表是「描述 + 行为」的唯一真相；`dispatchKey` 是唯一派发器

每个 binding 同时携带匹配、展示与行为：`match[]`（机器匹配的键名/字形/`^chord`）、`keys/hint/desc`（展示）、
`run(s, env)`（行为，作用于 store 活态 + 仅 `quit` 这一个非 store 副作用）、`enabled?(flags)`（能力门控）。
`footerHints`/`helpGroups` 与 `dispatchKey` **读同一批行**，所以一个键定义一次，footer、帮助、真实行为永不漂移。
`enabled` **同时**决定显隐与是否触发——未被宣传的键确实什么也不做（修掉 `^G` 无 LLM、`:` 不可查询时的半触发）。

这**修订 ADR 0006 §1**：派发不再留在 `App`。`App` 的输入处理器退为一行
`useKeyboard(k => dispatchKey(store.getState(), k, { quit }))`。

### 2. `deriveContext` 是「在哪个上下文」的唯一纯函数

把 8 层三元梯子抽成一个纯函数（cell 检查器 > 输入模式 > NL 提示 > 面板焦点）。浏览对象的 DDL 静态视图
**升为独立 `ddl` 上下文**（只认 `D` 切换 + 全局键），取代原先「在网格里吞掉所有键」的守卫——更诚实，
帮助浮层也只在 DDL 下显示 `D`。

### 3. `TextField` 编辑模型——可编辑文本的唯一定义

`TextField { value, cursor }` + 纯操作（`insert/backspace/del/left/right/home/end/deleteWordBack/setValue`），
**无框架、可独立单测**——一处定义「可编辑文本如何行为」。store 的四个草稿改存 `TextField`，
**光标与值同处一份**（不再有平行的游标字段，§2.7 不重叠）；四个 `updateXDraft` 收敛为 `editX(op)`。
文本上下文在表里携带 `field.edit`，`dispatchKey` 把打字 / 退格 / ←→ / Home/End / ⌃W **统一**路由为
`TextField` 操作——于是每个字段都获得串内编辑与光标移动，无需逐键 action。连接表单刻意保持 append-only
（它的 ←→ 绑定切换 driver）。

### 4. 视图：一个 `<TextInput>` + 光标感知折行

单行字段由唯一的 `<TextInput>` 渲染：在 `cursor` 处把 value 切成两半、中间放共享的 `<Caret>`——
过滤/编辑提示、NL ask 行皆然。多行 SQL 编辑器经 `wrapWithCursor` 在同一 `TextField` 上布局，
它额外报告光标的行/列，使光标能在**折行 + 窗口化**的文本里画在串中任意位置。退役「内嵌光标字形 +
手写 `wrapText`」。

### 5. App 退为编排：纯几何/上下文外移

`computeLayout(cols, rows, queryable)`（面板尺寸）与 `deriveContext` 移出组件、成为 `layout.ts`/`keymap.ts`
里的纯函数并单测。`App` 只剩「选择器 + 一行 `dispatchKey` 委托 + 纯组合」。

## 代价 / 边界（记录在案）

1. **硬件光标暂未接**：OpenTUI 只在**盒子级**暴露绝对坐标（`screenX/screenY`），`<span>` 是 `<text>`
   内的内联样式段、无独立坐标，故真光标需要字段**局部**坐标。本次先把光标做成「字段自绘字形」。
   因 `cursor` 现在是字段持有的**显式索引**，其屏幕坐标（字段盒子原点 + 局部行列）总是可派生——
   后续可**单/多行无分支地**统一接 `renderer.setCursorPosition`，是独立的加法式一步。
2. **连接表单仍 append-only**：其 ←→ 绑定 driver 切换，故不接入光标 ←→；这是不同 widget 的诚实建模，
   非半迁移。
3. **编辑器 ↑/↓ 仍是历史导航**（非纵向移动光标），←/→ 为水平移动——wrapped 编辑器的合理取舍。

## 结论

输入从「描述与行为两处声明 + append-only 字符串」收敛为「**一张表驱动派发 + 一个 TextField 模型**」，
且 **domain / application 一行未改**（纯 `presentation`）。键位加功能 = 加一行（描述 + 行为 + 门控同源，
§2.5 数据结构优于控制流）；文本能力（串内编辑已落地，选区、粘贴、硬件光标）都成为 `TextField` 的
加法式扩展（§2.4 开闭）。
