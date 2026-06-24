# lazysql 架构设计

> 一个 lazygit 风格的终端数据库管理工具（TUI）。
> 设计目标：**架构干净、链路清晰、可持续演进、严格遵循 SOLID**。

---

## 1. 设计哲学与约束

### 1.1 三条不可妥协的原则

1. **领域无关于基础设施**：核心业务逻辑（连接、浏览、查询、编辑）不知道自己跑在 PostgreSQL 还是 MongoDB 上，也不知道 LLM 是 Claude 还是 OpenAI。
2. **能力驱动而非类型驱动**：UI 不写 `if (db === 'redis')`，而是问 `if (source.supports(Capability.RowEdit))`。新数据源进来不碰旧代码。
3. **副作用收敛在边缘**：所有 IO（DB、LLM、文件、密钥）只发生在最外层适配器，内核是可纯函数测试的。

### 1.2 关键约束（来自需求）

- 首期数据库：**PostgreSQL、MySQL/MariaDB、SQLite、MongoDB、Redis** —— 决定了抽象层必须是「通用数据源」而非「SQL 中心」。
- 首期功能：**数据浏览/编辑、SQL 查询编辑器、Schema 管理、连接/会话管理、语法补全、NL→SQL(LLM)**。
- 体验基准：lazygit —— 键盘驱动、面板式、快、零配置可上手。

---

## 2. 技术栈决策（ADR 摘要）

| 关注点 | 选型 | 理由 |
|--------|------|------|
| 语言 | **TypeScript (strict)** | LLM/补全生态一等公民；团队熟悉度高 |
| 运行时 | **Bun**（开发&分发）/ 兼容 Node 22 | `bun build --compile` 出单二进制；保持运行时无关 |
| TUI | **Ink (React)** | 组件模型清晰、社区主流。**睁眼选择**：取其生态成熟度，已知性能短板用分页纪律消解（见 `adr/0003`） |
| 状态 | **Zustand** + slice | 轻量、可测、与 React 渲染解耦 |
| LLM | **Vercel AI SDK (`ai`)** | provider 无关，Claude/OpenAI/Ollama 统一接口、原生流式与 tool-use |
| SQL 解析/补全 | **node-sql-parser** | AST 驱动的 schema 感知补全与校验 |
| 行编辑 DML 生成 | **Kysely**（仅内部，参数化） | 防注入地生成 UPDATE/INSERT，不暴露给用户 |
| 密钥 | **OS Keychain**（keytar/`security`/libsecret） | 绝不明文落盘 |

> ⚠️ **诚实的代价**：① Ink 无原生 ScrollView 且有 ~30 FPS 上限，大网格需自研 windowing（架构上用「分页+游标」从源头规避，残余风险用第 6.4 节的性能纪律压住；推翻条件见 `adr/0003`，撤退方案为 OpenTUI）；② `better-sqlite3`/`keytar` 是 native 模块，单二进制打包更复杂——可用 Node 22 内置 `node:sqlite` 与纯 JS keychain 方案缓解。详见 `adr/0001`。

---

## 3. 分层架构（Clean / Hexagonal）

依赖方向**严格自外向内**，内层永不 import 外层。

```
┌─────────────────────────────────────────────────────────────┐
│  presentation/ (TUI)   Ink 组件 · 键位 · 命令 · ViewModel       │  ← 可替换为 Web/GUI
├─────────────────────────────────────────────────────────────┤
│  application/ (用例)    ConnectDataSource · BrowseTable ·       │
│                        ExecuteQuery · EditRow · GenerateSql     │
│                        (依赖 ports，不依赖具体实现)              │
├─────────────────────────────────────────────────────────────┤
│  domain/ (内核)         DataSource 端口 · 能力接口 · ResultSet   │  ← 纯，无任何 IO
│                        Schema/Table/Column · Connection 实体     │
├─────────────────────────────────────────────────────────────┤
│  adapters/ (基础设施)   SQL/Mongo/Redis 适配器 · LLM provider ·  │  ← 实现内层端口
│                        Keychain · Yaml 配置仓储                  │
└─────────────────────────────────────────────────────────────┘
         ▲ 组合根 main.ts：把具体适配器注入用例（手动 DI）
```

**依赖倒置（DIP）的体现**：`application` 定义 *出站端口*（如 `SqlGenerator`、`ConnectionRepository`），`adapters` 实现它们，`main.ts` 在启动时装配。内核对「数据库」「LLM」一无所知。

---

## 4. 核心抽象：DataSource 端口模型（整个项目的心脏）

### 4.1 为什么要分段（Interface Segregation）

一个「胖接口」会逼着 Redis 去实现 `listForeignKeys()`、逼着只读连接实现 `editRow()`。所以拆成**基础接口 + 多个能力接口**：

```ts
// domain/datasource/DataSource.ts —— 所有数据源的最小公共面
interface DataSource {
  readonly id: SourceId
  connect(): Promise<Result<void, ConnectionError>>
  disconnect(): Promise<void>
  ping(): Promise<boolean>
  capabilities(): CapabilitySet            // 声明自己支持哪些能力
}

// 能力接口（按需实现）—— ISP 落地
interface Queryable {            // 执行原生查询/命令 → 统一结果集
  execute(q: Query, signal?: AbortSignal): Promise<ResultSet>
}
interface SchemaIntrospectable { // 列出命名空间/表/集合/列/索引/约束
  introspect(): Promise<SchemaSnapshot>
}
interface RowEditable {          // 行/文档级 CRUD（参数化、带主键定位）
  insert(t: ObjectRef, row: Record): Promise<EditResult>
  update(t: ObjectRef, key: RowKey, patch: Record): Promise<EditResult>
  delete(t: ObjectRef, key: RowKey): Promise<EditResult>
}
interface Transactional {        // begin/commit/rollback
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}
interface Streamable {           // 游标/流式，海量结果不撑爆内存
  stream(q: Query, opts: Cursor): AsyncIterable<Row>
}
```

| 数据源 | Queryable | Schema | RowEdit | Transactional | Streamable |
|--------|:---:|:---:|:---:|:---:|:---:|
| PostgreSQL / MySQL / SQLite | ✅ | ✅ | ✅ | ✅ | ✅ |
| MongoDB | ✅(命令) | ✅(集合/文档形态) | ✅ | ✅(4.0+) | ✅ |
| Redis | ✅(命令) | ◐(keyspace 扫描) | ◐(key 级) | ◐(MULTI) | ◐(SCAN) |

UI 只问能力，不问类型 —— 这是「未来可演进」的根。

### 4.2 统一结果模型（让表格/文档/KV 收敛到一处）

```ts
// domain/datasource/ResultSet.ts
interface ResultSet {
  columns: ColumnMeta[]        // 名称、声明类型、可空、是否主键
  rows: Row[]                  // Row = 有序值数组 + 按列名索引
  shape: 'tabular' | 'document' | 'keyvalue'   // 决定 UI 渲染策略
  affected?: number
  truncated: boolean           // 是否被分页/游标截断
}
```

- SQL → `tabular`，直接进数据网格。
- Mongo 文档 → `document`，网格按投影列展平 + 可展开为树。
- Redis → `keyvalue`，专用渲染。

一个结果模型、三种渲染策略（**策略模式**），UI 主流程不分叉。

### 4.3 SQL 内部的方言隔离（Strategy Pattern）

SQL 三家有差异（分页、引号、类型、内省查询）。因此**一个通用 `SqlDataSource` + 可插拔 `Dialect`**，而不是三个独立适配器：

```
SqlDataSource ──持有──▶ Dialect (接口)
                          ├─ PostgresDialect  (LIMIT/OFFSET, "ident", pg_catalog 内省)
                          ├─ MySqlDialect     (LIMIT, `ident`, information_schema 内省)
                          └─ SqliteDialect    (LIMIT, "ident", pragma 内省)
                       └持有──▶ Driver (薄封装 pg / mysql2 / better-sqlite3)
```

新增一个 SQL 方言（如 ClickHouse）= 新 `Dialect`，`SqlDataSource` 一行不改（OCP）。

---

## 5. LLM 子系统：NL→SQL + 语法补全

### 5.1 出站端口（领域不知道有 LLM）

```ts
// application/ports/SqlGenerator.ts
interface SqlGenerator {
  generate(input: {
    nl: string                  // 用户自然语言
    schemaContext: SchemaContext // 压缩后的 schema（表/列/类型/关系）
    dialect: DialectId
  }): Promise<GeneratedSql>      // { sql, explanation, confidence, isDestructive }
}
```

### 5.2 NL→SQL 安全链路（绝不自动执行破坏性语句）

```
用户输入自然语言
   │
   ▼ ① 收集相关 schema（按表名/关键词裁剪，控制 token）
   ▼ ② SqlGenerator.generate() —— Vercel AI SDK 调 Claude
   ▼ ③ 静态分析生成的 SQL（node-sql-parser）：判定读/写/DDL、标记破坏性
   ▼ ④ 【强制】在编辑器中展示 SQL + 解释，等待用户确认
   ▼ ⑤ 写操作 → 先 EXPLAIN/dry-run，二次确认
   ▼ ⑥ 执行 → 结果回灌网格
```

- Provider 无关：默认 **Claude**，可切 OpenAI / Ollama（本地）。
- **只读优先**：默认生成 `SELECT`，写/DDL 需显式开启 + 二次确认。

### 5.3 语法补全（与 LLM 解耦，独立引擎）

补全 ≠ LLM。用 **schema 感知的确定性补全**（快、离线、零成本）：

```
SchemaAwareCompleter:
  光标上下文(node-sql-parser tokenize)
    ├─ FROM/JOIN 后 → 补全表/集合名（来自最近一次 introspect 快照）
    ├─ SELECT/WHERE 中 → 补全当前表的列名（含类型提示）
    └─ 句首 → 补全 SQL 关键字
```

LLM 仅用于「整句生成」，补全走本地引擎 —— 两条独立链路，互不阻塞。

---

## 6. TUI 架构（lazygit 风格）

### 6.1 面板布局

```
┌──────────────┬───────────────────────────────────────────────┐
│ Connections  │  Main Panel (随上下文切换)                       │
│  ▾ prod-pg   │  ┌─ DataGrid ──────────────────────────────┐   │
│    ▾ public  │  │ id │ name      │ created_at              │   │
│      users   │  │ 1  │ alice     │ 2026-01-02              │   │
│    ▸ orders  │  │ 2  │ bob       │ 2026-01-03  [虚拟化渲染] │   │
│  ▸ cache-rds │  └──────────────────────────────────────────┘   │
│              │  (或 QueryEditor / SchemaView，按 Tab 切换)       │
├──────────────┴───────────────────────────────────────────────┤
│ StatusBar: prod-pg · public.users · 1.2k rows · 23ms  [? help] │
└───────────────────────────────────────────────────────────────┘
```

- 左：连接/库/Schema/表的树（Sidebar）。
- 主：DataGrid / QueryEditor / SchemaView 三态切换。
- 底：状态栏 + 命令栏。
- 叠加层：连接配置、确认框、**命令面板（Command Palette）**。

### 6.2 键位与命令（Command Pattern）

所有用户动作都是**命令对象**，键位只是「上下文 → 命令」的映射：

```ts
interface Command { id: string; canRun(ctx): boolean; run(ctx): Promise<void> }

// 键位注册表是上下文感知的：同一个键在不同面板触发不同命令
keymap.bind({ context: 'datagrid', key: 'e', command: 'row.edit' })
keymap.bind({ context: 'editor',   key: 'C-Enter', command: 'query.execute' })
```

收益：① 命令面板/帮助页自动生成；② 可测（命令是纯逻辑）；③ 未来宏/录制/快捷键自定义零成本。

### 6.3 状态流（单向数据流）

```
键位/输入 ──▶ Command ──▶ 调用 application 用例 ──▶ 更新 Zustand store
                                                        │
   Ink 组件 ◀── selector/ViewModel 派生视图状态 ◀────────┘
```

异步 DB/LLM 操作通过 store 的 `loading/error` 状态驱动 UI，**用 `AbortController` 贯穿取消**（长查询可中断）。

### 6.4 Ink 性能纪律（强制，针对其已知短板）

Ink 无原生 ScrollView 且有 ~30 FPS 上限，数据网格是其最苛刻场景。以下为**实现期不可省略**的纪律（决策与撤退路径见 `adr/0003`）：

1. **严格分页 + 游标**：DB 侧分页，永不全量进内存（第 4、12 节），从源头禁止 Ink 最致命的"万行渲染"。
2. **视口虚拟化**：`useStdoutDimensions()` 算可见行数，只渲染 `visible + buffer`。
3. **`<Static>`**：滚动历史/查询日志走 Ink 虚拟列表路径，不参与重绘。
4. **激进 memoization**：DataGrid 拆为紧致组件，单元格 `memo` 化；store 分片，杜绝全树重渲染。
5. **滚动去抖**：快速滚动合并帧，规避 30 FPS 上限下的积压。

> 若以上仍压不住视口内滚动/编辑延迟 → 按 `adr/0003` 切换 OpenTUI，影响被隔离在 `presentation/`，domain/application 不动。

---

## 7. 目录结构（按层 + 按特性）

```
src/
  domain/                      # 纯内核，零 IO，可独立单测
    datasource/
      DataSource.ts            # 基础端口
      capabilities.ts          # 能力接口 + CapabilitySet
      ResultSet.ts             # 统一结果模型
      schema.ts                # Table/Column/Index/Constraint 领域模型
    connection/                # Connection 实体 · ConnectionProfile 值对象
    query/                     # Query 值对象 · RowKey · ObjectRef
    errors/                    # 领域错误类型
  application/
    usecases/                  # 每个用例一个文件，编排领域
      ConnectDataSource.ts
      BrowseTable.ts
      ExecuteQuery.ts
      EditRow.ts
      GenerateSqlFromNL.ts
    ports/                     # 出站端口（被 adapters 实现）
      SqlGenerator.ts
      ConnectionRepository.ts
      SecretStore.ts
  adapters/
    datasource/
      sql/
        SqlDataSource.ts       # 通用 SQL 适配器
        dialects/              # PostgresDialect · MySqlDialect · SqliteDialect
        drivers/               # pg / mysql2 / better-sqlite3 薄封装
      mongo/MongoDataSource.ts
      redis/RedisDataSource.ts
      registry.ts              # DataSourceFactory：type → 适配器（OCP 扩展点）
    llm/
      VercelAiSqlGenerator.ts
      providers/               # anthropic · openai · ollama 配置
    completion/SchemaAwareCompleter.ts
    persistence/
      YamlConnectionRepository.ts
      KeychainSecretStore.ts
  presentation/
    app/
      store/                   # Zustand slices（connection/grid/editor/...）
      keybindings/             # 注册表 + 上下文
      commands/                # 命令实现
    components/                # Sidebar · DataGrid · QueryEditor · SchemaView · StatusBar · modals
    viewmodels/                # store → 视图状态的 selector
  shared/
    Result.ts                  # Result<T,E>，边界处显式错误
    events/                    # 领域事件总线
    logger.ts                  # 结构化日志写文件（绝不写 stdout，TUI 独占屏幕）
  main.ts                      # 组合根：装配所有具体实现
```

---

## 8. SOLID 映射（逐条兑现）

| 原则 | 在本架构中的落地 |
|------|------|
| **S** 单一职责 | Driver（连接&发请求）/ Dialect（方言差异）/ Adapter（端口适配）三者分离；用例只编排不实现 |
| **O** 开闭 | 加数据库 = 新 Adapter + 注册到 `registry`；加 LLM provider = 新 provider；**核心零修改** |
| **L** 里氏替换 | 所有适配器遵守端口契约；用**能力接口**避免「被迫实现不支持的操作」，从而保证可替换性在声明能力内恒成立 |
| **I** 接口隔离 | `Queryable/SchemaIntrospectable/RowEditable/Transactional/Streamable` 分段，而非一个胖接口 |
| **D** 依赖倒置 | domain/application 只依赖端口；adapters 依赖内层；`main.ts` 注入具体实现 |

---

## 9. 横切关注点

- **错误处理**：边界返回 `Result<T,E>`，领域错误带类型；TUI 统一错误展示层。
- **取消**：`AbortController` 贯穿查询/LLM 调用；长操作可中断。
- **日志**：结构化日志写文件（`~/.local/state/lazysql/`），含查询耗时；调试面板可视。
- **密钥**：连接密码进 OS Keychain；配置文件只存引用（`secret://` 或 env 占位）。
- **配置**：`~/.config/lazysql/config.yml`（连接、偏好、键位）；schema 可校验。

---

## 10. 测试策略

| 层 | 手段 | 特点 |
|----|------|------|
| domain / application | 纯单元测试（无 IO） | 快、稳、覆盖核心逻辑 |
| adapters | **testcontainers** 起真实库 + SQLite in-memory | 验证方言/内省正确性 |
| **契约测试** | 一套共享测试套件，**每个 DataSource 适配器都必须通过**（按能力条件跳过） | 强制 LSP，新适配器接入即验收 |
| TUI | `ink-testing-library` 组件测试 + 命令单测 | 渲染与交互可回归 |

> 「适配器契约测试套件」是本设计的专业要点：它把「LSP 是否被遵守」变成**可执行的验收**。

---

## 11. 演进路线（每阶段都是可运行的垂直切片）

> 关键策略：**NoSQL 排在后期，但抽象从第 0 天就为它设计**——这是「未来可演进」的真正含义。

- **Phase 0 · 行走骨架** ✅：SQLite 适配器 + 连接 + 浏览一张表 + Ink 外壳。打通端到端纵切，验证抽象。（SQLite 零部署，联调成本最低）
- **Phase 1 · 核心浏览** 🚧：分页/筛选/排序 + PG/MySQL 适配器 + 连接管理 + Keychain。
  - ✅ PostgreSQL 适配器：复用 `SqlDataSource`，仅加 `PostgresDialect`(`$n` 占位/`information_schema` 内省/schema 限定名) + `PgDriver`(`pg`)，过与 SQLite 同一套契约测试。**新增引擎零改动 domain/application/presentation**（OCP 实证）。
  - ✅ 列排序：引入 `BrowseSpec`(page + sort，为 filter 预留)，两个 Dialect 各自生成 `ORDER BY`；UI 列光标 + ▲/▼ 指示。同一增量在 SQLite/PG/TUI 三处验证。
  - ✅ 列筛选：`Filter` 结构化条件挂入 `BrowseSpec`（未改 `Browsable` 签名，验证预留扩展位）；共享 `whereBuilder` 参数化生成 WHERE（`?` vs `$n`、`LIKE` vs `ILIKE`），count 同步应用 filter；TUI `/` 进入输入态，contains 筛选当前列。
  - ✅ MySQL/MariaDB 适配器：再次复用 `SqlDataSource`，仅加 `MySqlDialect`(反引号标识符 / `DATABASE()` 限定 / `COLUMN_KEY='PRI'` 查主键) + `MySqlDriver`(`mysql2`)。**三个 SQL 引擎(SQLite/PG/MySQL)过同一套契约测试**——方言隔离的最强证据。
  - ✅ 连接管理：`ConnectionRepository`/`SecretStore`/`DataSourceFactory` 三个出站端口；`YamlConnectionRepository`(`connections.yml`，无密码，可手编) + `FileSecretStore`(`secrets.json`，`chmod 600`)。`OpenConnection` 用例解析密钥并合并进 options 后连接。**in-TUI 连接选择器**(`Root` 组件管理 选择器↔浏览 阶段机) + 会话内切换(``` ` ``` 键经 `ShellContext`)；组合根无 arg 进选择器、带名称/文件直连、首次运行写起始配置。
  - ✅ `KeychainSecretStore`：`SecretStore` 的第二实现(macOS `security` CLI，零 native 依赖)，`LAZYSQL_SECRETS=keychain` 开启。**新增引擎/密钥后端只动 `adapters/`，端口之上零改动**——三度兑现 OCP/DIP。
  - ⬜ in-TUI「新增连接」表单(当前经编辑 `connections.yml`) · Linux/Windows Keychain 后端。
- **Phase 2 · 数据编辑**：行级 CRUD + 事务安全 + 二次确认。
- **Phase 3 · 查询编辑器**：执行 SQL + 结果网格 + 历史 + **schema 感知补全**。
- **Phase 4 · Schema 管理**：内省视图 + DDL。
- **Phase 5 · NL→SQL (LLM)**：schema 上下文生成 + 审查/确认链路 + provider 配置。
- **Phase 6 · NoSQL**：Mongo + Redis 适配器（**验证能力模型确非 SQL-only**）。
- **Phase 7 · 进阶**：SSH 隧道、导入导出、插件化。

---

## 12. 一眼看懂的数据流（端到端示例：浏览一张表）

```
用户在 Sidebar 选中 public.users，按 Enter
  → Command 'table.browse'
  → 用例 BrowseTable(sourceId, ObjectRef)
       → DataSource.execute( Dialect.paginate("SELECT * FROM users", page) )
       → 返回 ResultSet{ shape:'tabular' }
  → store.grid.setResult(rs)
  → DataGrid 组件按 shape 选渲染策略 + 虚拟化只渲染可见行
  → StatusBar 显示 "public.users · 1.2k rows · 23ms"
```

全程领域内核不知道底层是 Postgres —— 换成 SQLite 同一条链路不变。
