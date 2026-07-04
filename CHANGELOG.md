# Changelog

All notable changes to this project are documented here.
Generated from [Conventional Commits](https://www.conventionalcommits.org/) by [git-cliff](https://git-cliff.org/).


## [0.1.12](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.12) - 2026-07-04

### Features

- **tui:** Toggle the OpenTUI debug console with F12 ([dfbdf89](https://github.com/Yangeyu/lazysql/commit/dfbdf89b4506ddb665acc0d8759753712c925803))

### Bug Fixes

- **repo:** Create the release tag annotated so --follow-tags pushes it ([e1f7244](https://github.com/Yangeyu/lazysql/commit/e1f724448e90a057c60a0bf2a51d85092a82286d))
- **datasource:** Mongo browse always tiebreaks on _id ([3da78de](https://github.com/Yangeyu/lazysql/commit/3da78de68f8e086edec3938ad3ce08c63db76a5e))
- **store:** Stale navigations abort and can no longer overwrite the UI ([fc2c751](https://github.com/Yangeyu/lazysql/commit/fc2c7516f7b825b8fdb83a0f770afd0f706b4f52))
- **browse:** Render write confirms through the dialect (EditPreviewable) ([c7c40c8](https://github.com/Yangeyu/lazysql/commit/c7c40c87d96e3e6d3770afe5a14864284c225b36))
- **tui:** Size the ? help to its content and scroll it on overflow ([8a0650a](https://github.com/Yangeyu/lazysql/commit/8a0650ab6e8f87782424e60a27ee03e471aca931))
- **tui:** Give the ? help one fixed width across every context ([c05ad64](https://github.com/Yangeyu/lazysql/commit/c05ad64383a1a338860c533fd8ee709ebc859395))
- **tui:** Wrap help descriptions on narrow terminals — vertical scroll only ([a332690](https://github.com/Yangeyu/lazysql/commit/a332690dd4d2eea4f709d3fafc416d7f14f972b6))

### Refactoring

- **store:** Extract export and connection-form feature slices ([88b2b4c](https://github.com/Yangeyu/lazysql/commit/88b2b4cbc7d49358d8194ae7bf62825c36967c2c))

### Documentation

- **repo:** Sync ARCHITECTURE/CLAUDE.md and stale comments with reality ([85adf3b](https://github.com/Yangeyu/lazysql/commit/85adf3b3dc38b4126a4deeabc7970f5ff7a98b44))

## [0.1.11](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.11) - 2026-07-04

### Features

- **browse:** Pretty-print JSON when editing canonical columns ([8a01ff3](https://github.com/Yangeyu/lazysql/commit/8a01ff32b7851c01ee929262a35993f29c9c35cc))

### Bug Fixes

- **browse:** Uuid filters, stable row order, and error surfacing ([81fdc22](https://github.com/Yangeyu/lazysql/commit/81fdc229acf6e62ceda3277f7bf33c2a12fc3092))
- **export:** Page exports in primary-key order ([a38ab3f](https://github.com/Yangeyu/lazysql/commit/a38ab3fccdd634851aa5c380e3a42cb391e6fff4))
- **tui:** Switch the caret glyph to an ASCII pipe ([bd3a80e](https://github.com/Yangeyu/lazysql/commit/bd3a80ef2bb1f88cb0cf948a4d60e4a324f3615c))

### Refactoring

- **app:** Hoist toDataSourceError into domain/errors ([17e4666](https://github.com/Yangeyu/lazysql/commit/17e466624128be1cc72036264addc3c493e86959))

### Documentation

- **repo:** Sync README keybindings with export & multi-line editor ([71bae38](https://github.com/Yangeyu/lazysql/commit/71bae3894d94a709081f5e82a41979902c8498cc))

## [0.1.10](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.10) - 2026-07-02

### Features

- Multi-line SQL editor with schema-aware completion ([e9dc6b0](https://github.com/Yangeyu/lazysql/commit/e9dc6b0c03e14480d4a2f5f27c108f7735a2a7ae))
- **browse:** Edit cells in the inspector — multi-line textarea for JSON ([5abae39](https://github.com/Yangeyu/lazysql/commit/5abae39b801c406da13fe6f4245b0b5c6dfe1e70))
- **export:** Add streaming export engine (ports, usecases, formatters) ([311cbbe](https://github.com/Yangeyu/lazysql/commit/311cbbeb19f1134761930fafba7d77fef3035758))
- **browse:** Export & multi-select UI, sidebar resize, curated footer ([15c2ae7](https://github.com/Yangeyu/lazysql/commit/15c2ae77ad9c32aff413433ea4da438e8202dfa5))

### Bug Fixes

- **tui:** Brighten too-dim secondary text and unfocused borders ([4743933](https://github.com/Yangeyu/lazysql/commit/474393330e6f6cfe2868699990796b9d2fbf686f))
- **tui:** Remove a stray NUL byte in schemaKey; add refKey helper ([a3abef8](https://github.com/Yangeyu/lazysql/commit/a3abef81f6036abb1c67835a4966b7aa57157ba4))

### Refactoring

- **tui:** Remove the ⌃h/⌃l pane-focus shortcuts and their tests ([fcdedda](https://github.com/Yangeyu/lazysql/commit/fcdeddab311ad47112fea71d128f289d270ba502))

## [0.1.9](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.9) - 2026-06-29

### Bug Fixes

- **repo:** Ship an empty default connections.yml, drop the broken sample ([9dd016b](https://github.com/Yangeyu/lazysql/commit/9dd016b850f3d211ccb306730bdec781b1aa2b86))

## [0.1.8](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.8) - 2026-06-29

### Bug Fixes

- **repo:** Ship the npm bin launcher with the execute bit ([3d5e3c0](https://github.com/Yangeyu/lazysql/commit/3d5e3c0129a39bedc6daa2947744892c5261b289))

## [0.1.6](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.6) - 2026-06-29

### Features

- **repo:** Add -h/--help and -v/--version with a pure CLI parser ([4b9163a](https://github.com/Yangeyu/lazysql/commit/4b9163a9b9ff3c184c0ba1e0e8858f5667ceeb99))

## [0.1.5](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.5) - 2026-06-29

### Features

- **tui:** Remove a saved connection from the sidebar ([526fa38](https://github.com/Yangeyu/lazysql/commit/526fa388aebc2c4ee029c00d4ddc5d3a5845da90))

### Documentation

- **readme:** Clarify bun global-bin PATH requirement ([def0621](https://github.com/Yangeyu/lazysql/commit/def06212b75fe9b958cd79f4e683435ff8633955))
- **readme:** Restructure with usage/badges/license sections ([29a7b32](https://github.com/Yangeyu/lazysql/commit/29a7b326d0d78ad6332bf565411be43f8c4a3758))

## [0.1.4](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.4) - 2026-06-28

### Bug Fixes

- **datasource:** Resolve sqlite file path to absolute ([b822e3c](https://github.com/Yangeyu/lazysql/commit/b822e3c093ea99fe64b2ae646c088d7a9347469b))

### Documentation

- **readme:** Add uninstall and from-source global-install sections ([65abc83](https://github.com/Yangeyu/lazysql/commit/65abc83a91225b9adcdee07ccc6a247d87cea731))

## [0.1.3](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.3) - 2026-06-28

### Bug Fixes

- **repo:** Add repository field so OIDC provenance verifies ([ce1b88f](https://github.com/Yangeyu/lazysql/commit/ce1b88f0b05c0487a965c27db6a8388d15dd6422))

### Documentation

- **readme:** Add npm/bun install section ([a84d93a](https://github.com/Yangeyu/lazysql/commit/a84d93a7cc106c2eaf05abca2f463dfbe69f0097))

## [0.1.2](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.2) - 2026-06-28

### Bug Fixes

- **repo:** Pin bson to 7.2.0 and smoke-test release binaries ([9d5d114](https://github.com/Yangeyu/lazysql/commit/9d5d114630903ca7fcd46c3e82edeff4ec69b643))

## [0.1.1](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.1) - 2026-06-28

### Bug Fixes

- **repo:** Pin Bun to 1.2.16 for releases — 1.3.x breaks compiled binaries ([61eb6e3](https://github.com/Yangeyu/lazysql/commit/61eb6e346c666fb0d7f67b7b9902e75aa9588ad0))

## [0.1.0](https://github.com/Yangeyu/lazysql/releases/tag/v0.1.0) - 2026-06-28

### Features

- Walking skeleton — connect, introspect, browse (SQLite) ([38903d4](https://github.com/Yangeyu/lazysql/commit/38903d4341b36fd31a804efdcbf775cc7a81b1a2))
- **datasource:** Add PostgreSQL adapter ([13fa78c](https://github.com/Yangeyu/lazysql/commit/13fa78c1a42997c215cbed77cf93fc143c39f3cc))
- **browse:** Add column sorting across dialects ([a96fcae](https://github.com/Yangeyu/lazysql/commit/a96fcae3501a7627593b7d11892fab2a2038ff04))
- **browse:** Add parameterized column filtering ([9baf825](https://github.com/Yangeyu/lazysql/commit/9baf8256ac103acc30ed04852507dc024f916ade))
- **datasource:** Add MySQL/MariaDB adapter ([fd67c74](https://github.com/Yangeyu/lazysql/commit/fd67c7466dca15a90be14488c604de7a7a8bed96))
- **connection:** Add YAML config + 0600 file secret store ([4e765f6](https://github.com/Yangeyu/lazysql/commit/4e765f654831cc78dd9a93547c7dc5461da4a3ef))
- **secrets:** Add macOS Keychain secret store ([0d5c818](https://github.com/Yangeyu/lazysql/commit/0d5c818a192ea85f1685fae632aaa2766fb1c3b4))
- **tui:** Add connection picker + session switch ([a07bd6d](https://github.com/Yangeyu/lazysql/commit/a07bd6d36d3c9e27a0159aa8f6a7576b31460f35))
- **datasource:** Add RowEditable + Transactional adapters ([046f470](https://github.com/Yangeyu/lazysql/commit/046f470dc0839a023f2b64abc631211b93d7fbd6))
- **tui:** Add cell editing + row delete with confirmation ([fd670ef](https://github.com/Yangeyu/lazysql/commit/fd670efae6a7e665f53ec342d710088d4249263b))
- **query:** Add SQL query editor — execute free-form SQL + history ([2480591](https://github.com/Yangeyu/lazysql/commit/248059150fc2213de7849650c0fa1b29af683254))
- **query:** Add schema-aware SQL completion ([5c32b47](https://github.com/Yangeyu/lazysql/commit/5c32b4756915f5e5476b38f650be586042d34316))
- **llm:** Add SqlGenerator port + Claude adapter + statement classification ([a243ae9](https://github.com/Yangeyu/lazysql/commit/a243ae91c6740a923eb508e4ca1d67dd3e5e56a7))
- **query:** Wire NL→SQL into the editor (generate → review → run) ([290c61f](https://github.com/Yangeyu/lazysql/commit/290c61fe0c33a7285972dc432125cdc1b1110ef0))
- **llm:** Add Qwen (Bailian) provider via OpenAI-compatible adapter + registry ([42fb3fb](https://github.com/Yangeyu/lazysql/commit/42fb3fb727aec76b419cd8a8f6b3fe90c2ee9dab))
- **datasource:** Add Redis adapter (key/value) + capability-gated SQL editor ([d67c494](https://github.com/Yangeyu/lazysql/commit/d67c4949335cd256f1edcde259a815b2efcdb975))
- **datasource:** Add MongoDB adapter (document store) ([d52f168](https://github.com/Yangeyu/lazysql/commit/d52f168fc350157338ded18408879cbe7d8a2166))
- **tui:** Add keybinding registry and ? help overlay ([7f79d3c](https://github.com/Yangeyu/lazysql/commit/7f79d3cd3f2106b99153df35c017c3e427a505dc))
- **tui:** Collapsible connection/category/object navigation tree ([7aa2fd2](https://github.com/Yangeyu/lazysql/commit/7aa2fd27c6561934e74926fbc8d39e6b070fae59))
- **tui:** Add Data/DDL tabs to the main pane ([b5b8682](https://github.com/Yangeyu/lazysql/commit/b5b86828a35a2e03b6f70fddce3de7f0f1146104))
- **tui:** Multi-connection sidebar and in-app new-connection form ([da98b3e](https://github.com/Yangeyu/lazysql/commit/da98b3ee4ad019d9508c21775c29651e17751523))
- **tui:** Fullscreen redesign, editable connections, grid scroll, cell inspector, mouse ([197d70f](https://github.com/Yangeyu/lazysql/commit/197d70fe6d9683e1f483284c8291b656ce3dd79b))
- **tui:** Cell-level grid highlight + shared row-window geometry ([171a4cc](https://github.com/Yangeyu/lazysql/commit/171a4cc87a8edd1663cfb58ab84747ecf1b72d15))
- **tui:** Float help + cell inspector over a persistent background ([bc9a4f7](https://github.com/Yangeyu/lazysql/commit/bc9a4f73f4807151b3875987a6f5ca4a37c0107f))
- **tui:** Click to select a tree item or grid row ([60c37ee](https://github.com/Yangeyu/lazysql/commit/60c37ee016d92df27500fc1561576b6e916c1bee))
- **tui:** Migrate to OpenTUI; fix big-table stall, layout, browse-SQL echo ([2c9d60e](https://github.com/Yangeyu/lazysql/commit/2c9d60e742c4bde99b369b41dc1446fb57032404))
- **input:** Model editable text as a TextField with a real cursor ([cb0784c](https://github.com/Yangeyu/lazysql/commit/cb0784cd4703888dd91959377509cd1ca5f4a898))
- **tui:** Native <input> for the filter prompt (plan A, slice 1) ([e4c7842](https://github.com/Yangeyu/lazysql/commit/e4c7842e5966c7784d14826c10b8034be2baa784))
- **tui:** Native <input> for the cell-edit prompt (plan A, slice 2) ([b30cf7d](https://github.com/Yangeyu/lazysql/commit/b30cf7d82bca20373633fc717c53ac529311538b))
- **tui:** Native <input> for the NL ask row (plan A, slice 3) ([644ff0b](https://github.com/Yangeyu/lazysql/commit/644ff0b62d08105bda5081be3d63c1526819d53f))
- **tui:** Native <input> for the SQL editor; retire the hand-rolled stack (plan A, slice 4) ([8405a60](https://github.com/Yangeyu/lazysql/commit/8405a60bfe0f9ec8c7473ec854a7bb7222851bbb))
- Native inputs for connection form ([9680610](https://github.com/Yangeyu/lazysql/commit/9680610f8eb7528e5ed64d9642e6259fa0f15533))
- Grid click selects cell column, not just row ([ff2d6a5](https://github.com/Yangeyu/lazysql/commit/ff2d6a5c83a66da66b95a953426b0fdc620a6ac9))
- **tui:** Mouse text selection copies to the system clipboard ([460acea](https://github.com/Yangeyu/lazysql/commit/460acea28d22ada5ccfcf608d30d31fbfc5144d5))
- **tui:** Y in the cell inspector copies the full value ([f5613cd](https://github.com/Yangeyu/lazysql/commit/f5613cda1e9e45109079f4ab0391c62b0b2345ca))
- **tui:** Group Postgres objects under a schema tier in the sidebar ([869465d](https://github.com/Yangeyu/lazysql/commit/869465d86a4914c01b5b105477cc9495c02f3935))
- **tui:** R refreshes the connections list and object tree ([19b63c1](https://github.com/Yangeyu/lazysql/commit/19b63c1b16346380c07f6f1f4ab5f5cce290e608))
- **tui:** ^C clears the SQL editor draft, quitting only when empty ([88cac89](https://github.com/Yangeyu/lazysql/commit/88cac895bd637c719c47100f5eaddb91aef2617c))
- **tui:** D in the sidebar drafts a DROP for the table into the editor ([bfd4725](https://github.com/Yangeyu/lazysql/commit/bfd472506d42e8f952e6af42a03146be2286fc56))
- **schema:** Model object detail as sections; show definitions for non-table objects ([09b0cca](https://github.com/Yangeyu/lazysql/commit/09b0cca9ef3b63eff18f13afde224ccb31159caa))
- **datasource:** Introspect indexes/sequences/triggers/procedures on PG & MySQL ([9857cad](https://github.com/Yangeyu/lazysql/commit/9857cad65834fde02488504cebf1c1c12a301ea5))
- **datasource:** Dialect-correct DROP draft; quote synthesized DDL ([d3f8283](https://github.com/Yangeyu/lazysql/commit/d3f8283eda1bbeae079b491f5ea0a967ab7fa88e))
- **llm:** Add OpenAI and DeepSeek providers ([9da9367](https://github.com/Yangeyu/lazysql/commit/9da93673c69d4370f203cf28bde076ce3b03a25f))
- **app:** Config.yml liberates the NL→SQL provider from env-only ([9943cbd](https://github.com/Yangeyu/lazysql/commit/9943cbd00483c1f25be972ea552193354dc6dd0c))
- **tui:** Wheel/trackpad scrolls the panes ([8cfe55e](https://github.com/Yangeyu/lazysql/commit/8cfe55e950a369e1552186539d82e7e46f47f033))
- **tui:** Pane-jump/g-G nav, row indicator, affected-rows & write guard ([fd1b8f0](https://github.com/Yangeyu/lazysql/commit/fd1b8f0022d145732b40768aab14ee711a136fb3))
- **app:** Persist per-connection SQL history across runs ([c255948](https://github.com/Yangeyu/lazysql/commit/c2559486909803c2da2043ad6c40de78d5dd0471))
- **tui:** Confirm destructive writes in a unified dialog with CASCADE recovery ([abf0892](https://github.com/Yangeyu/lazysql/commit/abf08922a3637f4e772358373e7b023d93241427))
- **tui:** Refresh the object tree after a DDL statement runs ([35aaff6](https://github.com/Yangeyu/lazysql/commit/35aaff66e5701c697897a2737b22293ec4099203))
- **tui:** Wrap long lines in the cell inspector instead of clipping them ([c951ec7](https://github.com/Yangeyu/lazysql/commit/c951ec7c4c456dec3be67f8a08ae0a8d45c6011e))
- **repo:** Npm distribution via per-platform binary sub-packages ([f08d89f](https://github.com/Yangeyu/lazysql/commit/f08d89f9419595b4b44bfecd685e6566d2eff924))

### Bug Fixes

- **llm:** Use tool_choice 'auto' so reasoning models respond ([37db282](https://github.com/Yangeyu/lazysql/commit/37db282ebee7409db2afa439670a0b740008d563))
- **datasource:** Connect Postgres via Bun.SQL and surface real errors ([0ddb276](https://github.com/Yangeyu/lazysql/commit/0ddb276d7d526a44865333f909a879192a9bd49f))
- **tui:** Equal-looking gutters, pinned ask row, JSON cells, no grid flicker ([579db25](https://github.com/Yangeyu/lazysql/commit/579db25269663e9a2f97cd09a5ce57e4dcc5c573))
- **datasource:** Use a single SQL session, not a connection pool ([46d8cc8](https://github.com/Yangeyu/lazysql/commit/46d8cc887d8dde27ba26bebe2488617106208133))
- **datasource:** Surface the driver's error, not the echoed SQL ([3c4cbd8](https://github.com/Yangeyu/lazysql/commit/3c4cbd8faab16017ad2097bc962db30fbad98e15))
- **tui:** Virtualize the sidebar so long object lists scroll ([7f8d4c3](https://github.com/Yangeyu/lazysql/commit/7f8d4c34b5e92510e7561a39a3c9c58f6457c4d4))
- **tui:** ↓ steps forward through SQL editor history ([756d80b](https://github.com/Yangeyu/lazysql/commit/756d80bc7f42f81991011b882eae1817075001fd))
- **tui:** Tree g/G jump; replace 1/2/3 pane-jump with ^l ([838bf3a](https://github.com/Yangeyu/lazysql/commit/838bf3a5b7a7a00c0d13f62a93c69fd6a691fc38))
- **repo:** Drop the darwin-x64 (Intel Mac) release target ([d705760](https://github.com/Yangeyu/lazysql/commit/d7057603c6a9dd3d7e6f5c5c6f00f69de971a7ea))

### Refactoring

- **llm:** Extract shared prompt builders for SqlGenerator adapters ([d5005e4](https://github.com/Yangeyu/lazysql/commit/d5005e443a48f0bdbe4b61457bc029ddf2db2c5b))
- **llm:** Group provider adapters under providers/ ([4825625](https://github.com/Yangeyu/lazysql/commit/4825625b1fed8158bca1cb5c480c4d020b2bc2ad))
- **store:** Own the connection lifecycle via a ConnectionService port ([31a15f9](https://github.com/Yangeyu/lazysql/commit/31a15f9233fcae0be1922e8ff7d339cd41ac7292))
- **tui:** Persistent 3-pane layout with one focus + one results surface ([9891e78](https://github.com/Yangeyu/lazysql/commit/9891e7847c7cf1a524d42c8c738c650087f58d45))
- **tui:** Align the editor and grid widths, equal gutters, two-section editor ([db8e599](https://github.com/Yangeyu/lazysql/commit/db8e599fa40e110c02866588962ee1073b8d3bba))
- **tui:** Three distinct panels with a uniform 1-row gap ([a236b31](https://github.com/Yangeyu/lazysql/commit/a236b31f378198bdc1764283472e6c997358d53d))
- **test:** Colocate every test in a __tests__ directory ([9627449](https://github.com/Yangeyu/lazysql/commit/9627449ad958f8ce6aabd0d674f9656b5b7870aa))
- **app:** Extract computeLayout and deriveContext from App ([4bca690](https://github.com/Yangeyu/lazysql/commit/4bca6904870dd3b89ddd7884ffac12dd3f7ecf0a))
- **app:** Unify keymap into one source of behaviour and docs ([09f0b1c](https://github.com/Yangeyu/lazysql/commit/09f0b1c8b21758fc4d3fb08b3cceef9bdd02e80c))
- **tui:** Extract the Caret into one primitive ([7997912](https://github.com/Yangeyu/lazysql/commit/79979124170697f368eef50d43e88cee29be047c))
- **tui:** Compact single-line editor height + record native-input redesign ([ce44984](https://github.com/Yangeyu/lazysql/commit/ce4498469e944a363d24465fb9ae262adbc1b24c))
- **llm:** Rename the bailian provider id to alibaba ([349f978](https://github.com/Yangeyu/lazysql/commit/349f97853e24428af1fc75bce13d32b52fc692d1))
- **tui:** Editor echoes the current result's statement ([53e7833](https://github.com/Yangeyu/lazysql/commit/53e78331acee1696a4ccd0f56c77a5254f746ab0))

### Documentation

- Record multi-provider LLM strategy (ADR-0004) ([2f11c0a](https://github.com/Yangeyu/lazysql/commit/2f11c0a31bbfd4cd1f64ae297aa21bb6dde5a444))
- Record the NoSQL litmus test (ADR-0005) + Phase 6 status ([cfdd3ca](https://github.com/Yangeyu/lazysql/commit/cfdd3caa70b5a426431c573c128ff371ca4c5720))
- **repo:** Add ADR 0006 for lazygit navigation and workbench store ([0a1e6af](https://github.com/Yangeyu/lazysql/commit/0a1e6af6375a6b474c0b5a08b18a166503cc72eb))
- **tui:** Record the input-pipeline redesign (ADR 0007) ([a96e1f8](https://github.com/Yangeyu/lazysql/commit/a96e1f80d17e31339bb87c9873cb41fc0aca5f69))
- **tui:** Align layout comment with the flush right-column (gap 0) ([4eca99f](https://github.com/Yangeyu/lazysql/commit/4eca99f0de54fe20f8e21278720371498aafabac))
- **repo:** Sharpen comment convention to layer-based with anti-rot rule ([facd32d](https://github.com/Yangeyu/lazysql/commit/facd32d42903793f6ed562de1519fae0f224a7ad))
- **repo:** Rewrite README to match the current state ([4819f38](https://github.com/Yangeyu/lazysql/commit/4819f388525b36418c9cad73d346aa82d8093f8b))
