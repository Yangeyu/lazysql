# 提交规范（Conventional Commits）

本仓库采用 [Conventional Commits](https://www.conventionalcommits.org/)。它让历史可被机器读取——
自动生成 changelog、按 `feat` / `fix` / `BREAKING CHANGE` 推导 [SemVer](https://semver.org/) 版本，
也让人一眼看清每次提交的**意图与影响面**。

## 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**（必填）：见下表。
- **scope**（可选）：受影响的架构区域，对应分层目录，见下表。
- **subject**（必填）：祈使句、小写开头、不加句号，建议 ≤ 72 字。
- **body**（可选）：解释**为什么**这样改、权衡与上下文；与 subject 空一行。
- **footer**（可选）：`BREAKING CHANGE: …`、`Closes #12`、或本项目的 `Phase: N` 阶段标记。

## type

| type       | 含义                                             |
| ---------- | ------------------------------------------------ |
| `feat`     | 新增用户可见能力                                 |
| `fix`      | 修复缺陷                                          |
| `refactor` | 不改外部行为的内部重构                            |
| `perf`     | 性能优化                                          |
| `docs`     | 仅文档                                            |
| `test`     | 仅测试                                            |
| `build`    | 构建/依赖（`build(deps): …`）                     |
| `chore`    | 杂项、仓库基建（不进 changelog）                  |
| `ci`       | CI 配置                                           |
| `style`    | 纯格式（不影响语义）                             |
| `revert`   | 回滚某次提交                                      |

## scope（与分层对应）

`datasource` · `browse` · `query` · `connection` · `secrets` · `tui` · `llm` ·
`schema` · `app` · `store` · `deps` · `repo`

scope 列表是**建议性**的（commitlint 中为 warning，不阻断）——出现新区域时先提交、再把 scope 补进
`commitlint.config.js`。

## 示例

```
feat(datasource): add MongoDB adapter

首次验证能力模型对非关系库是否成立：实现 Browsable（文档形态 ResultSet），
不实现 Queryable/Transactional。改动限于 adapters/。

Phase: 6
```

```
fix(query): keep generated SQL out of auto-execution path

NL→SQL 结果只填入编辑器供审查，绝不自动执行。
```

```
refactor(llm): extract shared system prompt across providers

BREAKING CHANGE: none
```

## 本地校验

提交信息由 `.githooks/commit-msg` 经 [commitlint](https://commitlint.js.org/) 校验。
`bun install` 时 `prepare` 脚本会自动把 `core.hooksPath` 指向 `.githooks/`；
未安装 commitlint 时钩子自动跳过，不会阻断提交。手动校验：

```bash
bun run commitlint        # 校验最近一次提交
```

## Changelog 与发布

`CHANGELOG.md` 由 [git-cliff](https://git-cliff.org/) 按上表 type 从提交历史生成
（配置在 `cliff.toml`；`chore` / `style` / `test` / `ci` 与 Merge 提交不进 changelog）——
**不要手工编辑**，改了也会在下次生成时被覆盖。

```bash
bun run changelog                 # 重新生成 CHANGELOG.md（含 Unreleased 段）
bun run release [patch|minor|major|x.y.z]   # 发布：门禁 → bump → changelog → commit → tag
git push --follow-tags            # 触发 CI：发 npm + 建 GitHub Release（notes 同源生成）
```
