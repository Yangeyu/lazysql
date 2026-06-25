# ADR 0006：lazygit 式导航——连接树、键位注册表与工作台 store（Phase 7）

- 状态：已接受
- 日期：2026-06-26
- 关联：ADR 0002（能力分段的 DataSource 端口）、ADR 0003（TUI 框架）

## 背景

Phase 0–6 的 TUI 是「单连接 + 扁平对象列表 + 右侧网格」。目标是向 **lazygit 式**全屏体验演进：
左侧是一棵 **连接 → 分类 → 对象** 的可折叠树，多连接并存，`n` 新建连接，`?` 弹出键位指南，
不同面板有不同指令。要求：**符合未来演进**，且不破坏能力模型与分层（domain ← application ← adapters ← presentation）。

## 决策

分四步落地，每步独立编译、独立测试、独立提交。

### 1. 键位注册表是文档的唯一真相（`presentation/keymap`）

把「某个上下文有哪些键、做什么」声明为一张表 `GROUPS: Record<KeyContext, KeyGroup>`，
**底部状态栏（footer）与 `?` 帮助浮层都从它渲染**。`enabled?: (flags) => boolean` 让能力相关的键
（`: sql` 仅 `queryable`、`^G ask AI` 仅 `nlAvailable`）按 flags 自动显隐。

派发逻辑仍留在 `App` 的 `useInput`——注册表只负责**描述**，不负责执行。这样新增一个功能=加一行，
footer 与帮助自动同步，永不漂移（lazygit 的 cheat-sheet 模式）。

### 2. 树是 schema 的纯投影（`presentation/tree`）

`buildTree(input): TreeRow[]` 是纯函数：把 `connections`（根）与活动连接的 `objects` **按 `kind` 分组**
成分类（Tables/Views/Indexes/Triggers/Sequences/Procedures…），展开/折叠/光标全在 store 上对这棵扁平行表操作。
**分类是数据驱动的**：哪种 `kind` 存在就显示哪个分类——适配器的 introspection 日后产出 index/trigger，
对应分类**自动点亮，UI 零改动**（与 ADR 0002 同构：不 `if (driver===…)`）。`ObjectKind` 已预扩展这些关系型种类。

纯函数让导航（分组、折叠、初始光标）能脱离 Ink 单测。

### 3. 主面板 Data │ DDL 双面（`StructureView`）

打开对象有 Data（网格）与 DDL（列：类型/可空/主键 + 合成的 `CREATE`）两面，数据源自 introspection 端口的
`describe()`。`D` 在网格内切换、或在侧栏对象上直接以 DDL 打开。**合成 DDL 是结构的忠实呈现，非引擎逐字 DDL**；
真正的 `SHOW CREATE`/`pg_get_*` 留作未来的一项可选 introspection 能力（届时 DDL 面自动升级）。

### 4. 工作台 store + 可换源（multi-connection）

把「单连接即重建 store + 独立 picker 屏」改为：**一个长生命 store 作为工作台，真正成为它 docstring 自称的
「UI 唯一真相源」**，活动 `DataSource` 经 `attach()`/`disconnect()` 换入换出（不再重建 store）。
- **连接状态单一来源**：store 只存 `profiles + activeId`；`connections`（树根）、`connectionName`、
  `dialectLabel` 全是从这二者**派生**（`toConnNodes`），不另存——杜绝重叠字段与「条件式数据来源」。
- 连接根行：活动者（`●`）折叠展开其 schema；非活动者（`○`）`Enter` 即连接（切换）。
- **store 绝不碰 driver/repo/secret**：它只依赖注入的应用端口 `ConnectionService`（`list/open/save/remove`，
  与 `SqlGenerator` 同构），store 自身的 `connect/disconnect/saveConnection` 动作调端口完成连接生命周期；
  组合根（`main.tsx`）把 repo/secrets/factory 装配成该端口的实现。
- **`Root` 退化为薄壳**：`createAppStore({ connectionService, generator, initial })` + render + teardown 断连——
  **无连接状态、无 ref 影子、无渲染期副作用**。
- `n` 表单（`ConnectionForm`，store `mode:'connform'`）：选 driver + 填字段 → 经 `ConnectionService.save`
  持久化，**密码进 `SecretStore`、永不入 YAML**（沿用 `OpenConnection` 的 secret 解析路径）。

## 代价 / 边界（记录在案）

1. **关系型分类暂为空**：SQL 适配器当前只 introspect table/view，故 Indexes/Triggers/Sequences/Procedures
   分类要等 Phase 7.5 扩展 introspection 才会有内容。树机制已就绪，是「未点亮」而非「不支持」。
2. **切换连接重置光标**：换源时活动子树重建，光标回到新连接首个对象（可接受的 UX）。
3. **连接的编辑/删除**：store 已具备 `removeConnection`/`saveConnection`，但 UI 暂未绑定连接根上的
   `e`/`d`；下一步加上即可（加法式）。

## 结论

四步把 UI 推进到 lazygit 式导航，而**领域与用例层一行未改**：树是 schema 投影、键位是声明式文档、
DDL 取自既有 introspection 端口、多连接经 `Workbench` 把基础设施留在组合根。每一项都为下一步演进
（真实 DDL 能力、关系型分类、连接编辑/删除、SSH 隧道）留好了加法式入口。
