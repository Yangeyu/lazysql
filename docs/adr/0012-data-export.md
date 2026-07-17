# ADR 0012：数据导出（选表整表 + 当前结果 + 多选/整 schema 批量），单用例双 row-source

- 状态：已接受
- 日期：2026-07-01
- 关联：ADR 0002（能力模型 DataSource）、ADR 0005（能力模型 vs NoSQL）、ADR 0007（keymap 分发）

## 背景

lazysql 是「浏览 / 查询 / 编辑」的 TUI。用户看完数据最高频的下一步是**把它拿出去**——目前只有 cell inspector 的 `y` 复制单个值,没有把一批行导出的能力。

两个自然入口:

1. **树上选表导出**:在对象树选一张表,导**整表**。
2. **内容面板导当前结果**:导**当前 grid 里的 `ResultSet`**——查询结果,或 browse 窗口。

关键张力,也是本 ADR 要处理的核心:**这两个入口难度不对称**。② 是内存里现成的 `ResultSet`(纯转换,易);① 的整表可能**远超内存**——browse 是分页的(`Browsable.browse` 一次一页,grid 只持一页),整表可能上百万行,装不进一个 `ResultSet`。

## 决策

### 1. 一个导出能力,两个 row-source（不是两个功能）

共享的是**格式化器**(`ResultSet`/行块 → CSV/JSON)+ **文件出站端口**(sink)+ 格式选择;两个入口**只有「行从哪来」不同**。**禁止两条平行的导出链路**(那正是 §6 要避免的平行抽象)——导出逻辑收敛成一个内部 `pump(rowChunks, formatter, sink)`:② 喂 `[result.rows]` 一块;① 喂分页游标产出的多块。

### 2. 出站端口 `Exporter`（流式 sink）

写文件是最外层脏 IO,放到端口后由 `adapters/fs` 实现、`main.ts` 注入(照 DIP,与 `Clipboard` 同形)。设计成**流式**(open → write(chunk) → close),整表导出内存只占一页。边界返 `Result`、**绝不 throw**;适配器应**原子写**(temp 文件 → close 时 rename),取消/失败不留半截文件。

```ts
// application/ports/Exporter.ts
export interface ExportTarget { readonly path: string; }

/** Streaming sink for an export: open once, write text chunks, close. Behind
 *  DIP — usecases depend only on this; the fs adapter is injected at main.ts.
 *  Contract: methods return Result, never throw. The adapter writes atomically
 *  (temp file → rename on close) so a cancelled/failed export leaves no half-file. */
export interface Exporter {
  open(target: ExportTarget): Promise<Result<ExportSink, ExportError>>;
}
export interface ExportSink {
  write(chunk: string): Promise<Result<void, ExportError>>;
  close(): Promise<Result<void, ExportError>>;
  abort(): Promise<void>; // discard the in-progress file on cancel/error
}
```

### 3. 格式 = Strategy（纯 `RowFormatter`，无 IO）

把「怎么序列化」与「怎么写文件」分开:formatter 是**纯函数**(begin/rows/end,支持增量流式),sink 只管把字符串块落盘。新格式 = 新 formatter,调用方零改(照 `Dialect` 那套 Strategy)。CSV、JSON 是纯 formatter。**SQL 由 `Dialect` 驱动**(已落地):新增能力接口 `SqlDumpable`(`insertDump(ref, columns, rows)` + `asSqlDumpable` 守卫),`SqlDataSource` 复用 `dialect.insertQuery` + dump 字面量渲染(`sqlDump.ts`)生成**可运行的 `INSERT`**;`sqlFormatter(dump)` 把它包成 `RowFormatter`。**无 `CREATE`、无 `ON CONFLICT`**——导出用于「灌进已存在的表」,主键冲突即 fail-stop。SQL 仅对「表 / 表集」导出提供(查询结果无目标表)。**批量的「单文件 vs 多文件」按格式分**:**CSV 一表一文件**(列 heterogeneous,合不进一个文件),**JSON / SQL 各合成一个文件**——JSON 是按**限定表名**键控的对象 `{ "public.users": [...], ... }`,SQL 是各表 `INSERT` 块在 `-- name` 注释下**拼接**(语句独立、无需包裹/分隔,原样 `psql -f` 一把灌)。合并由 `CombinedFormatter`(`fileBegin → (tableBegin → rows* → tableEnd)* → fileEnd`)+ 驱动 `exportTablesCombined`(单 sink、逐表分页流入)表达;单表/多文件仍走 `RowFormatter` + `streamExport`,分页逻辑经共享 `browsePages` 收敛,不出现第二条平行链路。

```ts
// domain/export/RowFormatter.ts  — pure, operates on domain ResultSet types
export interface RowFormatter {
  readonly extension: string;                       // 'csv' | 'json'
  begin(columns: readonly ColumnMeta[]): string;    // header row / '['
  rows(chunk: readonly Row[], columns: readonly ColumnMeta[]): string;
  end(): string;                                     // '' / ']'
}
export type ExportFormat = 'csv' | 'json';
export const formatterFor = (f: ExportFormat): RowFormatter => /* registry */;
```

> 放置:formatter 是纯的、只碰 domain `ResultSet`,落 `domain/export/RowFormatter.ts`——application 用例可直接 import 而不越界。

### 4. 两个用例（`application/usecases`），共用 formatter + sink

```ts
// ExportResult.ts — source = 内存 ResultSet（② 当前结果，导「所见」）
export const exportResult = async (
  result: ResultSet, formatter: RowFormatter,
  exporter: Exporter, target: ExportTarget, signal?: AbortSignal,
): Promise<Result<ExportSummary, ExportError>> => { /* pump([result.rows]) */ };

// ExportTable.ts — source = 整表，复用 Browsable 分页逐页取（① 选表）
export const exportTable = async (
  source: DataSource, ref: ObjectRef, formatter: RowFormatter,
  exporter: Exporter, target: ExportTarget, signal?: AbortSignal,
): Promise<Result<ExportSummary, UnsupportedCapabilityError | ExportError>> => {
  const browsable = asBrowsable(source);
  if (!browsable) return err(new UnsupportedCapabilityError(`source "${source.id}" cannot browse`));
  // 页循环：browse(ref, spec{page++}) 直到短页/空页；每页 → pump 一块；每页间检查 signal.aborted。
};
```

- ② 走内存 `ResultSet`;① 走 `Browsable`(`browse`/`count`),**内存有界(O(一页))、可取消**。
- 不支持的源(非 `Browsable`)返 `UnsupportedCapabilityError`,照 `browseTable` 的 `asBrowsable` 守卫形状。
- 两者唯一的差别是 row 生产者;格式化 + 落盘是同一段。

### 5. 触发（presentation）

keymap 里 **sidebar 上下文加 `export table`、grid 上下文加 `export result`**(照 keymap-as-source,一行一绑定,footer/help 自动带出)。`X` **不直接落盘,而是暂存一个 `pending` 走共享的确认弹窗**(与 DROP/DELETE/编辑同一个 `ConfirmDialog` + y/n 路径,统一交互)——弹窗标题给出导出对象,`statement` 显示**解析后的绝对目标路径**(`resolveUserPath`,顺带解答「文件落哪」),`y` 执行、`n`/esc 取消。因此覆盖不再静默:确认即覆盖。**确认框里 `f` 循环切换格式 CSV / JSON / SQL**(`cycleExportFormat`,持有导出目标 `exportReq` 以便对同一目标重新暂存),状态栏/弹窗显示当前格式与目标路径。确认后**进入 `exporting` 模式**(捕获输入):状态栏显示实时行数(用例透传 `onProgress` 逐页回报),`esc` 取消 —— 经 `AbortSignal` 中断,半截文件被 `sink.abort()` 丢弃。**写文件、绝不写 stdout**(TUI 独占屏幕)。

### 6. 多选 / 整 schema 批量导出（presentation）

sidebar 的 `v` **标记/取消标记**光标处的表/视图(多选),标记以 `refKey`(kind+namespace+name)存于 `marks: Set<string>`——非对象行 no-op,切连接即清空,`esc` **一键清空**全部标记。标记在 sidebar 以绿色 `✓` 显示、状态栏在树上驻留时显示 `✓N marked` 计数——**独立于光标高亮**,选了什么(即便滚出视野)一眼可见。`X` 解析出一个 ref 列表,优先级:**有标记→标记集**;否则**光标所在节点**——schema / category 头行导出其下**全部表**(修掉「在 schema 上导出报错」),对象行只导它自己;过滤到 table/view。1 张 = 单文件确认(同前);≥2 张 = 批量(kind `'tables'`):**CSV 走 `exportTablesToFiles`**(逐表 `exportTable` 落各自文件),**JSON / SQL 走 `exportTablesCombined`**(单个合并文件);首个失败即停 = 报错停止策略,进度回报跨表累计行数,`f` 切格式即在两条路径间重新暂存。**标记优先于光标**是刻意的(选择覆盖位置,同文件管理器/lazygit 的暂存语义)。取消语义三条路径统一:单表 / 合并 abort 丢弃那个(唯一的)文件;CSV 多文件取消,**已完整写出的文件保留、进行中的丢弃**,提示统一为「export cancelled」(不谎称 nothing written)。

## 代价 / 边界（记录在案）

1. **① 非事务快照**:分页遍历一张正被写的表,行可能位移 / 重复 / 漏。TUI 导出通常可接受——但记在案;严格一致要 `REPEATABLE READ`(`Transactional` 能力已在),v1 不做。
2. **filter/sort 归属**:② 导「所见」(带当前 filter/sort);① 从树进无 active filter,导**原始整表**。UI 要让这点无歧义;「① 也带 filter 导」是后续。
3. **超大表 = 分页循环，不是真 streaming**:v1 内存 O(一页)。真·streaming 等 `Streamable` 能力(`DataSource.ts:116` 已预留);届时只把 `exportTable` 的 source 换成游标,sink / formatter / 用例形状不动。
4. **`null` / 二进制 / 编码**:CSV 里 `null`→空、`Uint8Array`→hex 预览(复用 `cellFormat` 取值口径);`null` vs 空串靠 format 约定区分(JSON 用字面 `null`)。document/keyvalue 形状的源优先导 JSON(CSV 对非 tabular 退化)。
5. **声明为 JSON 的列在 JSON 导出中内嵌为原生 JSON**(`{"a":1}` 而非转义字符串)。判据是**声明类型、绝不按内容猜**——TEXT 列里恰好长得像 JSON 的字符串保持字符串,round-trip 不改语义;解析失败(SQLite 松散类型下可能)回退字符串,文件永远合法。类型事实由 adapter 在 ResultSet 诞生处标注一次(`RawResult.columnTypes` → `Dialect.jsonKindOfType` → `ColumnMeta.jsonKind`:SQLite 用 `declaredTypes`、MySQL 用 wire type 245、PG 用 RowDescription OID——为此 PgDriver 换用 postgres.js,Bun.SQL 不暴露结果元数据),因此**①②两个入口行为一致**:表导出与查询结果导出同样嵌套,无 schema describe 参与。CSV / SQL 不受影响。
6. **落盘细节**:覆盖确认、默认目录 / 命名——presentation/adapter 细节,本 ADR 不锁死。原子写(temp→rename)是适配器契约(见决策 2)。

## 结论

一个 `Exporter` 流式 sink + 一个 `RowFormatter` Strategy + 两个用例(`exportResult` / `exportTable`),**靠 row-source 区分两入口、导出逻辑只一份**。整表走 `Browsable` 分页循环(内存有界、可取消),未来无缝升级到 `Streamable`。全程**只读、零改写路径**,不扩大破坏面。

待评审确认后再落地:`Exporter` 端口 + `fs` 适配器 + 两个用例 + 纯 formatter + keymap 两处绑定 + 契约测试(formatter 纯测 + 用例对 fake sink 的编排测),按 §4 全绿方为 DONE。
