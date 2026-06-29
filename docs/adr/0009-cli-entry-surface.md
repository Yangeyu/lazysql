# ADR 0009：CLI 入口层——纯 argv 解析 + 意图联合 + 自生成 help

- 状态：已接受
- 日期：2026-06-29
- 关联：ADR 0007（键位表：描述+行为的唯一真相）——本 ADR 把同一纪律搬到 shell 入口

## 背景

`main.tsx` 既是组合根，又一手包办了 CLI:它读 `process.argv[2]`,内联判定「flag / 名字 / 文件」,
再写配置文件、起 renderer。四件职责(参数解析 / 意图解析 / 装配 / 副作用执行)挤在一个文件里,有三个具体症状:

1. `lazysql --help`/`--version` 落到 `die("unknown connection")`——一个装在 PATH 上的二进制**看起来像坏了**。
   `-h/--help`、`--version` 是 POSIX/GNU 级别的通用契约(用户会下意识敲、打包脚本会检、bug 反馈需要版本号)。
2. `--list` 排在配置文件创建之后,纯信息命令**带副作用**(写 `~/.config/lazysql/*.yml`)。
3. 这条启动决策链**完全没有测试**——`looksLikeFile` 还把 `existsSync` 这个 IO 藏在解析里,使其难以纯测。

演进路线(ARCHITECTURE §11 Phase 7:导入导出、插件化)预示 CLI 表面会增长。所以这不是「现在够用」,
而是要把形状摆对,让它**可扩展而非将来重写**。

## 决策

CLI 是包在组合根外的入口壳——TUI 之外更薄的第二个 presentation 面。新建顶层 `src/cli/`,
把「纯解析」与「边缘执行」拆开,并照搬 ADR 0007「一张表喂匹配 + 展示 + 行为」的纪律。

### 1. `spec.ts` 是 CLI 表面的唯一真相

`OPTIONS`(每个 flag 的全部拼写 + 一行 summary + `kind`)与 `USAGE`(位置形态)是一张数据表:
`parse.ts` 读它识别 flag,`help.ts` 读它渲染 `--help`。**加一个 flag = 加一行**,help 自动跟上、永不漂移
(等同键位表的 `footerHints`/`helpGroups` 与 `dispatchKey` 读同一批行)。

### 2. `parseArgs` 是纯函数:argv → `CliInvocation` 判别联合

意图建模为闭合联合(`help`/`version`/`list`/`open{target}`/`default`/`unknownOption{option}`),
启动路径对一组确定的意图 `switch`,而不是再内联判定——非法状态无法表示(CLAUDE §3 domain)。
**零 IO**:解析只区分「flag / 位置参数 / 未知 flag」;`--help`/`--version` 在任意位置出现即胜(help 优先 version)。

### 3. 「open 目标 → profile/文件」是边缘 resolve,不在 parse 里

把 target 解析成「已存 profile vs 临时 `.db` 文件」需要 `repo.list()` + `existsSync`——这是 IO,留在组合根附近
(`resolveProfile`/`looksLikeFile`)。纯/不纯边界清晰(CLAUDE §「副作用收敛在边缘」),parse 因此可纯测。

### 4. 元命令零副作用、且最先执行

`main.tsx` 顶部 `parseArgs(process.argv.slice(2))` 后,`help`/`version`/`unknownOption` 立即 print+exit,
**早于任何配置文件写入与 renderer 初始化**。只有真正需要连接的 `list`/`open`/`default` 才触发「确保配置存在」。
version 取自 `import pkg from '../package.json'`(`bun build --compile` 编译期内联,dev 与产物皆成立)。

### CLI 契约(顺手定清)

- `-h/--help`、`-v/--version`:stdout,exit 0,零副作用。
- 错误:stderr,exit 1;`unknown option`(指向 `--help`)与 `unknown connection`(指向 `--list`)分开。
- 这些 print 都在 TUI 接管屏幕**之前**退出,与 CLAUDE §7「不写 stdout」不冲突(那针对 TUI 运行期),延续既有 `--list` 模式。

## 取舍

- **只做 Phase A,不做命令注册表**:当前只有 1 类命令(打开/列出连接),按三次法则(CLAUDE §6)不为将来投机抽象。
  待 `export`/`import` 真的出现(受力第 2–3 次),`spec` 条目再长出 `run(ctx)` handler、`ctx` 注入与 TUI 同一套
  `connectionService`/用例,headless 命令复用现有用例而不起 OpenTUI——届时升级为真正的 Command 注册表,**扩展而非重写**。
- **不引入 commander/yargs**:表面积小,手写解析足够,避免「只用 1–2 次的新依赖」(CLAUDE §5)。
- **现在不做子命令/插件框架**:那会把 TUI 复刻成第二个产品,超出当前需求。

## 后果

- 启动决策可纯测(`cli/__tests__/parse.test.ts`、`help.test.ts`),补上唯一未被 §10 覆盖的逻辑。
- `--version` 可作为比 `--list` 更标准、不依赖读连接文件的 CI smoke test(后续可替换 `release.yml`)。
- `main.tsx` 回归单一职责:解析交给 `cli/`,自己只做装配 + 意图→副作用。
