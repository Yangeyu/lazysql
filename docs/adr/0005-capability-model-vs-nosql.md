# ADR 0005：能力模型对非关系数据库的验证（Phase 6 试金石）

- 状态：已接受
- 日期：2026-06-25
- 关联：ADR 0002（能力分段的 DataSource 端口）

## 背景

前五个阶段全部是 SQL（SQLite/PG/MySQL）。ADR 0002 断言「UI 询问数据源**能做什么**而非**是什么**」，
但这套抽象从未在**非关系数据**上被检验。Phase 6 接入 **MongoDB（文档）** 与 **Redis（键值）**——
两种与 SQL 形态根本不同的源——作为整套抽象的试金石。

**判据**：实现两个适配器是否需要改动 `domain/` 或 `application/`？需要多少 `presentation/` 改动？

## 结果：能力模型站得住

### 1. 领域端口零改动

Phase 0 设计的端口原封不动地容纳了两种新形态：

- `ResultShape` 的 `'document'` / `'keyvalue'` 判别值——Phase 0 写下、Phase 6 首次使用。
- `ObjectKind` 的 `'collection'` / `'keyspace'`、`ObjectRef.namespace`、`DriverId` 的 `'mongodb' | 'redis'`。
- `Browsable.browse` 的 docstring 早已预言「Mongo via find().skip().limit()」——实现时逐字成立。

git 可证：两个适配器的改动**全部落在 `adapters/datasource/{mongo,redis}/` + `registry.ts`**，
领域与用例层一行未改。`BrowseTable`/`EditRow`/`ListObjects` 用例对 Mongo/Redis 与对 SQL 完全一致。

### 2. 能力分段（ISP）是真的，不是摆设

两种源都**只声明三项能力**：`SchemaIntrospect` + `Browse` + `RowEdit`，并**刻意省略**：

- **`Query`（SQL）**：Redis 说命令、Mongo 说 BSON 查询，都不是 SQL。它们不实现 `execute`，
  `asQueryable()` 返回 `null`。
- **`Transaction`（begin/commit/rollback）**：Redis 的 `MULTI/EXEC` 无回滚；standalone Mongo 无多文档事务。
  二者不实现 `transaction`，`asTransactional()` 返回 `null`。

关键证据：**`RowEditable` 在没有 `Transactional` 的情况下依然安全**——Redis 单键、Mongo 单文档
（`updateOne`/`deleteOne` by `_id`）天然原子。这正是 ISP 的价值：能力不是一个全有或全无的捆绑包；
SQL 适配器用事务保证「affected===1 才提交」，KV/文档适配器用单元素原子性达到同样的安全，而**端口不变**。

### 3. UI 按能力门控，而非按类型

新增的唯一一处 `presentation/` 改动验证了 ADR 0002 的承诺：store 由 `asQueryable(source)` 派生
`queryable` 标志——`:`（SQL 编辑器）与 `^G`（NL→SQL）对非 `Query` 源**自动隐藏/失效**。
全程**没有任何 `if (db === 'redis')`**：少一项能力，UI 自动少一个入口。

## 诚实的代价（抽象的边界，记录在案）

1. **分页语义错配**：`BrowseSpec` 的 `offset/limit` 是 SQL 形态。Mongo 干净映射到 `skip/limit`；
   Redis 是游标（SCAN）/扁平键空间，当前用 `KEYS` 取回后**内存切片**近似（封顶 `MAX_KEYS`，
   超出置 `truncated`）。这是 dev 工具尺度下的务实取舍；未来的 `Streamable`/游标能力能更好服务 Redis。
2. **值投影**：富值（ObjectId、Date、嵌套文档、Redis 哈希/列表）必须在**适配器层**压平到
   `CellValue` 标量联合（ObjectId→hex、Date→ISO、嵌套→JSON、集合类→`(type: N)` 摘要）。层次正确，
   但代价是网格里嵌套数据呈现为 JSON/摘要，单元格编辑器不支持改嵌套字段（只读式呈现）。
3. **Bun/bson 兼容**：`mongodb` 依赖的 `bson` 在加载期调用 Bun 未实现的 `v8` API，需一个 preload
   shim（`scripts/bun-v8-shim.ts`，经 `bunfig.toml`）。与抽象无关，但属于真实工程成本。

## 结论

「询问能力而非类型」对非关系数据成立：两个**能做的事严格少于** SQL 引擎的源，把这种「减少」
**纯粹通过声明更少的能力**来表达，领域端口与用例零改动，UI 自动收敛。能力模型——这套架构的心脏
——通过了它的试金石。下一个非关系/异构源（如时序库、图库）应沿同一路径：新适配器声明其能力子集，
仅动 `adapters/`。
