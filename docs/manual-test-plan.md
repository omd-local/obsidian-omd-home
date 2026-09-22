# OMD Home v0.1.1 人工测试计划

本文件用于 OMD Home 发布候选版（Release Candidate，简称 RC）的人工验收。请先在可丢弃的
vault 中完成安装和基础测试，再决定是否在日常 vault 中复测。不要用唯一一份重要 vault
直接做删除、冲突、模型卸载或失败注入测试。

OMD Home 是桌面插件。Calendar / EventKit 测试只适用于 macOS 14 或更新版本；其他模块仍可
在不安装 EventKit helper 的情况下测试。

## 0. 先理解这些名称和路径

- `OMD Home 源码目录`：包含 `package.json`、`src/`、`main.js` 的 Git 仓库。
- `vault 根目录`：包含笔记以及隐藏目录 `.obsidian` 的文件夹。
- `插件安装目录`：`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home`。
- `仓库 test-vault`：`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault`，专门用于隔离测试。
- `data.json`：该 vault 的 OMD Home 设置、布局和模型选择。它不是发布资产。
- `发布资产`：只包括 `main.js`、`manifest.json`、`styles.css`。
- `EventKit helper`：可选的 macOS 可执行文件 `omd-eventkit`，不属于三项 Community
  Plugins 基础资产。
- `源码 checkout`：从某个 Git commit 构建出的候选版。
- `GitHub Release`：已经打 tag 并公开发布的安装资产。它与源码分支不是同一概念。

Obsidian 没有一个必须清理的“全局插件目录”。每个 vault 都有自己的
`.obsidian/plugins/omd-home`。如果你还创建过其他 sandbox/test vault，只清理那个 vault
自己的插件目录；不要删除整个 `.obsidian`、`.obsidian/plugins`、vault 或源码仓库。

本文命令中的 `<源码目录>`、`<version>` 和 `/absolute/path/...` 都是占位符，不能
原样输入：

- `<源码目录>` 要换成 clone 下来的 `obsidian-omd-home` 文件夹。
- `<version>` 要换成 Release 页面显示的准确版本，例如 `0.1.1`。
- 路径含空格时保留外层双引号，不要自己在双引号内再加入 `\ `。

本轮测试 vault 已固定为
`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault`；本文所有 vault 安装、清理和验证命令均使用
这一准确路径。不要把源码目录 `/Volumes/Transcend_q/APPS/AI/omd-home` 本身当作 vault 删除。

不知道 vault 路径时，在 Obsidian 的 vault switcher 中找到该 vault，选择 **Show in system
explorer / Reveal in Finder**；也可以在 Finder 中找到 vault 文件夹后，把它拖进 Terminal，
Terminal 会自动填入路径。macOS Finder 按 `Command + Shift + .` 可以显示或隐藏 `.obsidian`。

<a id="guide-test-preparation"></a>

## 1. 测试前准备

### 1.1 软件与环境

至少准备：

- Obsidian Desktop 1.11.4 或更新版本。
- Node.js 24 与 npm（从源码构建时使用，和 GitHub CI 一致）。
- 一个可丢弃的测试 vault。
- 需要 Capture / Enrichment / Vault Q&A 时：兼容当前 contract 的 OMD。
- 需要本地 AI 时：正在运行的 Ollama，以及本地模型。
- 需要 Apple Calendar 时：macOS 14+、Swift/Xcode Command Line Tools 和 EventKit helper。

从源码目录检查自动化基线：

```bash
node --version
npm --version
npm ci
npm run check
npm audit --omit=dev
```

预期：typecheck、lint、全部自动测试和 production build 通过；production vulnerability 为 0。
如果 `npm ci` 失败，不要继续人工测试，先记录完整错误。

### 1.2 打开 Obsidian 开发者控制台

1. 打开要测试的 vault。
2. macOS 按 `Command + Option + I`；Windows/Linux 按 `Ctrl + Shift + I`。
3. 打开 **Console**。
4. 清空旧日志，再开始每个测试阶段。
5. 出现异常时记录：测试编号、时间、完整可见错误、Console 错误和截图。

普通的缺少 OMD/Ollama/EventKit 提示不是 Console crash。未捕获异常、重复报错循环、插件无法
加载或 Obsidian 卡死才属于阻塞问题。

### 1.3 记录本次测试身份

### 1.3A 当前候选与本轮入口（2026-09-23 NZST）

本轮先测试已经实现的 UI-13、ENRICH-01、UI-15–19，再继续此前没有完成的人工分支和最终发布门禁。
旧候选身份与已经明确 PASS 的步骤移到下方归档；不要从历史交接继续，也不要重新清空 vault。

| 字段 | 本轮准确值 |
| --- | --- |
| Home 功能源码 | `3095379837881a78d0498c4001f5dce44231065b`（branch `agent/omd-home-baseline`） |
| OMD 后端 | `113388e0b75fb6ba6b380b5d6be699ef7b4271fd`（branch `agent/release-ux-compat`） |
| 测试 vault | `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault` |
| 候选 Home bundle | `main.js` `02efa95548b030d0965d3d3783308c6ff49f47cb3a6d61a4f5abaaa95d311df6`；`styles.css` `a1fd59c28b9a599ff219d4bf930b1d1f1d7ccafe01277542c4909636c4a8e5b8`；`manifest.json` `7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb` |
| OMD executable | `/Volumes/Transcend_q/APPS/AI/omd/.venv/bin/omd`；当前使用显式候选路径，避免 Automatic 落到旧 Miniconda bundle |
| Local writing / answer model | `qwen3:4b-instruct`；2026-09-22 原生 **Check setup** 已显示 ready |
| 当前数据 | 保留原 `data.json`、笔记、Pin、布局与历史结果；开始时记录实际 Markdown 数量和 Current task |
| 自动门禁 | Home 628 / 628、TypeScript、ESLint、production build；后端 1685 / 1685、Ruff、compileall（排除 macOS `._*` 元数据） |

安装时只替换 `main.js`、`manifest.json`、`styles.css` 和已有的可选 EventKit helper，不清空
`data.json`、笔记、Pin 或历史结果。安装后的 reload smoke 只能证明插件成功载入；主题、窄窗口、
键盘和 150% 缩放仍必须按 RC-P2-01–03 人工验收。

状态词统一如下：

- **RETEST**：本轮代码改变了该路径，必须重新人工验证。
- **FIRST PASS**：以前没有完整的原生结果，本轮首次按整项给出结论。
- **KEEP PASS**：已有充分证据，放在归档，不重复消耗时间。
- **NOT RUN**：缺少凭证、第二环境或外部权限；写清原因，不算失败，也不算通过。
- **DEFERRED / P2**：本轮明确不测、不实现。

#### 当前执行队列（2026-09-23 候选）

这轮先验证刚完成的 P2 工作区，不再依赖已经 Reviewed 的 `Small local capture fixture-4.md`。每个
Review case 都从仓库复制一份明确带 `omd_home_status: inbox` 的 fixture；做完后只删除本节列出的
测试副本。插件和 OMD commit、bundle hash 以本轮最终提交／安装记录为准。

| 顺序 | 状态 | Case | 本轮只做什么 | 可直接使用的例子 |
| --- | --- | --- | --- | --- |
| 1 | RETEST | [RC-P2-01](#test-rc-p2-01) | UI-13 Capture 最后一行留白、viewport 与 150% | `small-local-file.html` |
| 2 | FIRST PASS | [RC-P2-02](#test-rc-p2-02) | ENRICH-01、UI-15、UI-19、UI-18；Review 侧栏、summary、冲突、明确 Done | 三个 `OMD Review *.md` fixture；`qwen3:4b-instruct` |
| 3 | FIRST PASS | [RC-P2-03](#test-rc-p2-03) | UI-16／17；Inbox／Recent、时间、状态、tags、筛选、窄窗口操作 | 多语言长文件名 fixture |
| 4 | RETEST | [CAP-01A](#test-cap-01a) 未完成子项 | 三种 OCR、ASR 逐模式、config / Retry；不重做扫描 PDF 与缺包隔离 | 三张 PNG、`bilingual-speech.wav`、`plain-text-web-page.html` |
| 5 | FIRST PASS / P0 | [ANSWER-02-R1](#test-answer-02-r1) | 精确 provider/model contract；可用、不可用、未知三种状态 | `gpt-4.1`、`gpt-5.4-pro`、`deepseek-v4-flash`、`deepseek-chat` |
| 6 | FIRST PASS | [CAP-06](#test-cap-06) B、C | 用户 Cancel 与 disable/enable plugin 的 child-process 清理 | `slow-bilingual-speech.wav`；tags `cap-06-user-cancel`、`cap-06-unload` |
| 7 | FIRST PASS | [OMD-01](#test-omd-01) 未完成分支、[AI-02](#test-ai-02) | missing/custom path、daemon、endpoint 与恢复 | `/tmp/omd-home-does-not-exist/omd`、`http://localhost:9999` |
| 8 | FIRST PASS / 有凭证才做 | AI-03／04／05／11 hosted 实网分支 | 每个 provider 独立检查、preview、取消和恢复 | 问题：`@Which fixture uses the blue key, and on what day?` |
| 9 | FIRST PASS | CAL-00–03 | 权限、Save、Linked sync、双向 conflict 的真实 Calendar 写入 | 标题：`OMD CAL manual test – delete after PASS` |
| 10 | FIRST PASS / Extended | AI-06／08／09／10 | 后台任务、benchmark、multilingual retrieval、reload 恢复 | 使用 `docs/benchmark-vault/`，不要提前导入 |
| 11 | 最后执行 | REL-01 | disposable clean vault、三项 bundle、reload、cold restart | 不复用当前有历史数据的 test-vault 作为 clean-vault 证据 |

在这里记录本轮结果；未做的行保持空白，不要预填 PASS：

| Case | PASS / FAIL / NOT RUN | 时间 | 截图／日志 | 一句备注 |
| --- | --- | --- | --- | --- |
| RC-P2-01 |  |  |  |  |
| RC-P2-02 |  |  |  |  |
| RC-P2-03 |  |  |  |  |
| CAP-01A 剩余子项 |  |  |  |  |
| ANSWER-02-R1 |  |  |  |  |
| CAP-06 B／C |  |  |  |  |
| OMD-01／AI-02 剩余子项 |  |  |  |  |
| Hosted 实网 |  |  |  |  |
| CAL-00–03 |  |  |  |  |
| Extended AI |  |  |  |  |
| REL-01 |  |  |  |  |

**现在从 RC-P2-01 开始。** 完成一行后记录 `PASS / FAIL / NOT RUN`、时间、截图和一句原因，再进入
下一行。不要为了做后面的测试提前修改当前 OMD 路径或删除模型。

<a id="test-rc-p2-01"></a>

#### RC-P2-01：Capture 留白与 viewport（UI-13）

1. 打开 **Capture URL or file**，粘贴但不要提交：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/small-local-file.html
   ```

2. 展开 Recognition，逐项检查 **Image text language** 与 **Speech language**。下拉框底部到分隔线应
   有完整留白；把 Speech language 改成 **No language preference**、**简体中文 + English**、
   **繁體中文 + English** 各看一次。
3. 检查 Optional local AI 的 **Polish Markdown** 与 **Review links and tags**。最后一行 helper 到卡片
   底边应与语言控件一致，开关 on／off 都不能压缩底部留白。
4. Capture modal 没有拖动 resize handle。请缩窄 **Obsidian 主窗口**，重新打开 Capture，再用
   **View → Zoom in** 到约 150%。内容可以纵向滚动，不能横向滚动、遮挡或截断底部操作。运行
   **Reset zoom** 后点击 Cancel；不得产生 note 或改变这次以前保存的默认值。

<a id="test-rc-p2-02"></a>

#### RC-P2-02：Review 侧栏、短 note、summary 与等待动效（ENRICH-01／UI-15／18／19）

**A. 准备可重置 fixture**

在 Terminal 执行以下命令；只覆盖本节的四个测试副本，不清空 vault：

```bash
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/OMD Manual Tests"
cp "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/vault-notes/OMD Review Short.md" "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/OMD Manual Tests/RC P2 Short.md"
cp "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/vault-notes/OMD Review Short.md" "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/OMD Manual Tests/RC P2 Conflict.md"
cp "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/vault-notes/OMD Review Multilingual Long Filename 中文 العربية.md" "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/OMD Manual Tests/RC P2 Multilingual Long Filename 中文 العربية.md"
cp "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/vault-notes/OMD Review User Summary Collision.md" "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/OMD Manual Tests/RC P2 User Summary Collision.md"
```

等 Obsidian File explorer 出现四份 note。它们都应进入 OMD Inbox 和 Recent；若旧副本已经
Reviewed，重新执行以上 copy 并等待 metadata 刷新，不要另做 Capture 生成随机 `-4` 后缀。

**B. Review 与 Generate 分离**

1. 对 **RC P2 Short** 点击 **Review**。主编辑区应打开目标 note，右侧出现 OMD review pane；此时
   不调用模型，状态仍为 Inbox。关闭侧栏或点 **Keep in Inbox** 都不得写 `reviewed`。
2. 再次 Review，点击 **Generate suggestions**。等待 badge 应显示一个独立的 12–14px 细环和完整
   **Generating suggestions… Please wait.**，圆环不覆盖首字，宽度不抖动。重复点击不能启动第二份
   proposal；reduced motion 下圆环静止但仍占位。
3. 短 note 必须得到可审查 proposal 或具体、可操作的模型格式错误。若模型返回未知内部 `tag-N`，只
   省略该 tag 并显示简短 warning，其他有效 summary／links／tags 仍保留。自由文本的新 tag 应作为
   默认未选中的 **New tag**，不能冒充 existing。模型本轮未触发这些分支时记录 `NOT EXERCISED`；
   确定性自动回归仍作为发布证据。
4. **Suggested note topics** 只显示未来可建笔记的想法；没有 checkbox，也不会自动成为 tag。

**C. 可选 summary 与明确完成 Review**

1. Proposal summary 中 **Add summary to note** 默认关闭。先只选择一个 link 或 tag 并 Apply；note
   仍为 Inbox，正文不得出现空 Summary heading 或 summary marker。
2. Generate again，勾选 **Add summary to note**，把最后一行改成
   `Manual edit 中文 العربية 923`。取消其他建议，使 summary 成为唯一选择；Apply 必须可用。
3. 打开 note 验证出现且只出现一次：

   ```markdown
   <!-- omd-home:summary:start -->
   ## Summary
   ...Manual edit 中文 العربية 923...
   <!-- omd-home:summary:end -->
   ```

   区块位于受管 Related notes／`## Full Content` 之前；Apply 后仍为 Inbox。再次对相同内容 Apply
   不得追加第二个区块。**Copy summary** 复制的内容应与 textarea 一致。
4. 最后点击 **Done reviewing**。只有这一步把 Property 改为 `omd_home_status: reviewed`；note 从
   Inbox 消失，但仍在 Recent，状态显示 Reviewed。Apply、Generate、Cancel、关闭侧栏都不能代替它。

**D. 冲突与用户内容保护**

1. 对 **RC P2 Conflict** Generate；保持侧栏打开，在主编辑器末尾加入
   `MANUAL-CONFLICT-KEEP-923` 并保存，再从旧 proposal 点 Apply。应显示 conflict，保留新行，不写旧
   summary／links／tags，状态仍为 Inbox。非 modal 侧栏使这一步可以完全在 Obsidian 内完成。
2. 对 **RC P2 User Summary Collision** Generate，勾选 Add summary to note 后 Apply。应明确说明该
   note 已有 OMD 不管理的 Summary；`USER-AUTHORED-SUMMARY-KEEP-923` 必须原样保留，不新增 managed
   summary，也不标记 Reviewed。Copy／Open note 等安全出口仍可使用。

<a id="test-rc-p2-03"></a>

#### RC-P2-03：Inbox／Recent、时间、tags 与响应式操作（UI-16／UI-17）

1. 在 RC-P2-02 C 点 Done 前检查：Inbox 标题数量包含三／四个新 fixture；Recent 同时包含 Inbox、
   Reviewed 和普通 note，最新 Updated／Captured 在前。Done 后只有对应 note 从 Inbox 数量中移除。
2. Recent 的 Inbox／Reviewed chip 必须有文字；普通 note 无空 badge。Inbox 不重复显示 Inbox chip。
   Hover 或键盘 focus 时间可见带时区的完整时间，行内相对时间在等待一分钟后能自行更新。
3. 每行最多显示两个 tag token 和 `+N`。点 widget header 的 filter，先选 `#review`，再选
   `#language`：多选使用 AND，父 tag 可匹配 `review/multilingual`、`language/中文` 等 nested tag；
   计数随筛选更新。Clear filters 恢复原列表，不修改 note Properties。
4. 宽窗口能到达 Review、AI tags、Summarize、Pin／Unpin。**Summarize** 打开同一个 Review pane 的
   proposal summary，不自动写正文或改变状态。缩窄 Obsidian 主窗口后，三个长文字动作折入 `…`
   menu，Pin／Unpin 仍可操作；菜单名称和顺序保持一致。
5. 用深／浅主题、100%／150% 和多语言长文件名检查。title 保留主要宽度，path、time、status、tags
   自动换行或省略；不得横向滚动、重叠、仅靠 hover 才能操作或让 Pin／Unpin 列错位。

<a id="test-rc-ui-01"></a>

#### 历史 RC-UI-01：旧候选 UI 增量回归（归档）

A. **Recent 状态与长文件名（UI-12）**

1. 回到 OMD Home，查看 Recent notes。
2. `Sources/Audio/slow-bilingual-speech.md` 应显示 **Inbox**；
   `Sources/Documents/Small local capture fixture-4.md` 应显示 **Reviewed**。
3. `OMD Captures.md`、`.raw.md` 等没有 `omd_home_status` 的普通 note 不显示状态占位，也不能因此改变
   标题、路径或 Pin 列对齐。
4. 在深色和浅色主题、正常宽度与窄窗口分别检查一次；长文件名应省略但不能推挤 Pin / Unpin。

B. **生成等待状态（UI-04）**

1. 在 `Small local capture fixture-4` 行点击 **AI tags**。
2. 生成期间必须持续显示 **Generating suggestions…**、活动标识和“请等待”的含义；屏幕阅读器状态应
   更新。连续按两次触发键不能启动两个 proposal。
3. 等待到 Review 或明确错误后再继续；不能把尚未完成显示成空白或卡死。

C. **Capture 留白与响应式布局（UI-13）**

1. 打开 **Capture URL or file**，粘贴但不要提交：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/small-local-file.html
   ```

2. 对照 Source、Tags、Recognition、Optional local AI 与底部操作区：标题、说明、dropdown、toggle
   和分隔线都要有一致的垂直留白，顶部文字不能贴着卡片底边。
3. Capture 弹窗本身没有拖动缩放手柄；请缩窄 **Obsidian 主窗口**（需要时先 Cancel、缩窄后再打开
   Capture），再用 **View → Zoom in** 逐步放大到约 150%。弹窗应随可用 viewport 收窄并允许纵向
   滚动；按钮应换行或堆叠，不能重叠、截断或产生横向滚动，底部操作始终可到达。最后运行
   **Reset zoom**，点击 Cancel，不产生 note。

D. **关闭单条历史错误（UI-14）**

1. Capture 以下确定不存在的路径：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/ui-14-dismiss-me.html
   ```

2. 等待 Needs attention 出现这一个 **Capture can be retried** 卡片；确认卡片有可读名称的 `×`，用
   Tab 聚焦并按 Space / Enter 关闭。
3. 只有这一条历史 Retry 消失；其他 issue 保留。当前 setup / daemon 等实时健康问题不能靠 `×`
   隐藏，恢复健康后应自行消失。

E. **Settings 统一排版（UI-01／02）**

按 AI-00 第 1–14 步只做视觉、键盘和响应式检查。重点检查 Recognition 的
**No language preference**、**Review links and tags**、provider model 状态和长 executable 路径；
不要在本项粘贴 key 或发起 hosted 请求。

<a id="test-cap-02-r1"></a>

#### 历史 CAP-02-R1：旧候选 Enrichment 回归（归档）

1. 保持 OMD executable 为本节顶部记录的后端候选，Local writing model 为
   `qwen3:4b-instruct`，先运行 **Check setup**。
2. 从 Home 对 `Sources/Documents/Small local capture fixture-4.md` 点击 **AI tags**；也可以新 Capture
   `small-local-file.html`，但不要同时做两个入口。
3. 生成时完成 RC-UI-01 B。进入 Review 后确认：
   - existing links / tags 默认选中，new tags 默认未选；
   - **Summary preview** 只解释 proposal，不会写进 note；
   - **Suggested note topics**／**Idea only** 是未来可建笔记的主题，Apply 不会创建 note，也不会自动
     当作 tag；只有模型同时在 New tags 提出同名 tag 时，它才是可选择的 tag；
   - 透明的新 tag 即使被小模型错误归到 existing catalog，也应被恢复成可审查的新 tag；不得再次只
     因“outside current vault catalog”使整个 proposal 失败。保留形式或无法验证的 opaque ID 仍应拒绝。
4. 只选一个 link 和一个 new tag 后 Apply。终态应显示 **Applied** 与 **Status · Reviewed**；目标 note
   只新增所选 link / tag，并写入 `omd_home_status: reviewed`。回到 Recent，该 note 显示
   **Reviewed**。
5. 如果模型本轮没有产生“新 tag 错放 existing”的输出，把这一小分支记录为 `NOT EXERCISED`
   而不是 PASS；其余确定性 UI 与 Apply 结果仍可独立判定。

<a id="test-answer-02-r1"></a>

#### ANSWER-02-R1：精确 hosted model contract

本节只在对应 provider 已有合法 developer key 时做实网检查；没有 key 就完成文案与禁用态，然后把
实网分支记为 `NOT RUN — no test credential`。不要把 key 写进截图、笔记或 Console。

1. 每次切换 provider 后运行 **Check setup**。模型目录中“存在”不等于可回答；只有状态为 supported
   且带非空 answer contract 才能 ready。
2. 当前后端的可复制例子如下；只测试当前 catalog 实际返回的 ID，catalog 没有该 ID 时记
   `NOT RUN — model absent from current catalog`，不要伪造可用性：

   | Provider | 应支持的例子 | 应阻止的例子 | 未知例子 |
   | --- | --- | --- | --- |
   | OpenAI | `gpt-4.1` | `gpt-5.4-pro`（无所需 strict schema） | `future-openai-model` |
   | Anthropic | `claude-sonnet-4-5-20250929` | `claude-sonnet-4-20250514` | `future-claude-model` |
   | DeepSeek | `deepseek-v4-flash` | `deepseek-chat` | `future-deepseek-model` |

3. 不支持和未验证型号必须在发送前被拦截，说明准确原因；不得自动切换、降级到另一个 model 或沿用
   上一次 ready。支持型号应显示 provider、model 和 contract 已验证。
4. 只对一个 supported model 打开 `@` 问题 preview，使用：

   ```text
   @Which fixture uses the blue key, and on what day?
   ```

   核对 destination、问题和 evidence excerpts 后点击 Cancel；本步骤不要求发送真实问题。

#### 已完成结果归档（KEEP PASS，不重复）

| Case / 子项 | 已确认结果 | 本轮处理 |
| --- | --- | --- |
| CAP-03 | 缺失模型、idle、Retry、设置恢复与 Automatic 状态全部 PASS | 不重复失败注入 |
| CAP-06 A、D | Home tab 后台继续；Cmd+Q 取消与重开清理 PASS | 只做 B、C |
| CAP-02 正常 Apply、UI-05、UI-06 | Apply、原生写入和 review 终态已有 PASS | 旧证据保留；新实现改由 RC-P2-02 完整复测 |
| CAP-01A 扫描 PDF | image-only PDF 显示明确不支持边界且不生成空 note | 不重复；这不代表支持扫描 PDF OCR |
| CAP-01A 缺语言 pack 隔离 | 缺 `chi_sim` 时错误列出 requested / missing / available 与安装提示 | 不重复 wrapper 测试 |
| 语音总体验收 | 用户已确认 PASS | 仅补 Auto-detect / Chinese / No preference 的逐模式证据 |
| Automatic candidate 优选 | 能跳过 enrich-only Homebrew candidate 并找到带 Recognition contract 的 OMD | 当前为精确后端路径；到 OMD-01／REL-01 再验 Automatic |
| Minimal 与 Pin 对齐 | Pin / Unpin、长标题、正常与 150% 列宽回归已有 PASS | 旧证据保留；新 note row 改由 RC-P2-03 完整复测 |

#### 仍未完成、留在后续队列

UI-07–11 的 Graph / Local Graph / Backlinks / Search / Bases 建议、ANSWER-01、Douyin／XHS cookies
bridge，以及 folder / one-item-per-line batch 仍保留在 `ui-backlog.md`。这些项目本轮没有实现；
CAP-01A 剩余模式、CAP-06 B／C、hosted、Calendar、Extended AI 与 clean-vault release gate 继续按上表
顺序执行。它们不是本轮失败，也不能在发布说明中写成已经接入。

下面的 2026-09-17／19／20 候选身份与交接只作历史证据；不要从其中的“现在继续”恢复执行。

### 1.3A.1 2026-09-17 22:54 历史交接

本次按用户要求安装之前完成的 OCR 图片入口、识别选项排版及 Suggested note topics / Idea only 文案修复。
使用已通过 `npm run check` 565 项测试、类型检查、ESLint、构建的相同源码；安装资产与构建哈希一致。
原生停用 / 启用插件后，Check setup ready，图片路径先打开预填 Capture、Recognition 自动展开，
简中选择完整可见；取消再打开恢复默认。前后 23 份 Markdown 与插件设置内容一致。

- `main.js`：`9f809a4cd8a9e6f7705e7f7d2c1a899e7bf07594040881dee0b0da1be548e903`
- `styles.css`：`4ce5a0511df5db332b459095bf363494d6ebfa3bd2a7da0307e7e928801cb857`
- `manifest.json`：`7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb`

语音测试：**PASS（用户确认）**；未把未提供的逐模式细项自动填为 PASS。
CAP-02 已停在 `capture/small-local-file.html` 的 Capture 草稿，Review links and tags 开启、
Polish Markdown 关闭、Tags 留空，尚未提交。模型仍为 qwen3:0.6b。

本轮功能验收使用原有已验证的 `/Volumes/Transcend_q/APPS/AI/omd/.venv/bin/omd`。
自动发现探测解析 `/opt/homebrew/bin/omd`，其最小能力响应支持 enrich_note v1，但无 package / protocol 身份，
不能确认含本轮后端修复；已恢复原路径。**自动发现与旧安装跳过子项仍待单独验收**，不计入本次功能通过。
[原生交接证据](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/cap-02-update/native-handoff.md>)。

### 1.3A.2 2026-09-17 20:45 历史候选

本节保留 20:45 安装身份；当前身份见 1.3A，22:54 交接见 1.3A.1。后面的 2026-09-13 记录同样保留为历史。不要为继续测试重新安装、清空 vault 或重置 Settings。

| 字段 | 当前记录 |
| --- | --- |
| 构建 / 原生复测时间 | 2026-09-17 20:43–20:45 NZST |
| 候选来源 | HEAD `bb531beb20fbc4f84d41fb0b8cf980c95da44b04` 加当前未提交修复；下面资产哈希才是本轮准确安装身份，并非已发布 Release |
| manifest / Obsidian | `0.1.1` / `1.13.7` |
| 测试 vault | `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault` |
| 自动化 | `npm run check`：563 / 563，TypeScript / ESLint / production build 通过；`git diff --check` 通过。上一轮后端 1627 项通过；本次 CSS 修正未重复运行后端 |
| UI 复测 | minimal 风格恢复；48 组浏览器布局检查通过；插件停用 / 启用后原生 Pin、Settings、Capture、Event 校验通过 |
| 数据状态 | 原生复测前后 22 份 Markdown 与插件设置内容一致；无运行中的任务 |
| 测试边界 | 未将 OCR / ASR、云请求、真实日历写入等尚未实测项目标为 PASS；未重跑 dependency audit |

当前安装资产 SHA-256：

- `main.js`：`9c17c6764603be67020876f42fde7a3a479a82964e9658950767408600a6cf6b`
- `styles.css`：`d1b7ee54247f6763d6ffeb0d31ffba3ad5dc1f34497fe7b099fd85b079787784`
- `manifest.json`：`7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb`

**当时建议的续测入口：CAP-01A 第 1、2 步。** 先检查 Recognition defaults 与 Capture 的语言选项，再分别使用 `eng`、`chi_sim+eng`、`chi_tra+eng` 转换三张现成图片。当前续测范围与状态以 1.3A 为准；素材与预期见 `docs/manual-test-fixtures/README.md` 和 CAP-01A。

保留当前模型与环境，暂不为本轮补下载 `bge-m3`；按既有 AI-03 / AI-04 缺模型与 AI-09 安装顺序执行。不要把未执行的旧案例自动改成 PASS。后续若更换插件资产，应另记新的哈希和复测范围。

### 1.3B 历史身份（2026-09-13）

开始前运行：

```bash
git rev-parse HEAD
node -p 'require("./manifest.json").version'
```

记录：

| 字段 | 值 |
| --- | --- |
| 日期与时间 | 2026-09-13 22:37 NZST |
| 测试者 | shion |
| 上一轮已记录 baseline commit | `6adac24442caa450a76184c728284ca26bdb086f` |
| 当前安装候选来源 | branch `agent/omd-home-baseline`，代码与测试 commit `8849dc7`；包含 hosted-answer、embedding recovery、grounding contract、隐私边界、错误分类、Ollama Cloud alias、malformed model metadata fail-closed、hosted key Save & check、检索方式英文文案与 Settings UI-01–03 修复；2026-09-13 22:37 NZST 重新构建并安装到 test-vault；准确 bundle 身份以下方 SHA-256 为准 |
| manifest 版本 | `0.1.1` |
| Obsidian 版本 | `1.13.7` |
| macOS 版本 | `26.6.2` |
| vault 绝对路径 | `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault` |
| OMD 版本/commit | `0.3.0b2` / `0d8765fca55ff7a93bd970a00a2d7c0d20b50fe4`；`/opt/homebrew/bin/omd` 是不兼容的旧 Homebrew launcher，兼容候选为 `/opt/homebrew/Caskroom/miniconda/base/bin/omd` 与源码 `.venv/bin/omd`；人工测试时仍以 Settings 实际解析路径为准 |
| Ollama 版本 | client / daemon `0.33.3`；`/api/status` 为 `cloud.disabled: false`、`source: none`；Cloud 状态仅作环境记录，本地模型测试不要求 `cloud.disabled: true` |
| Completion model | `qwen3:4b-instruct` 与 `qwen3:0.6b`（本地已安装）；另有 cloud-backed `gpt-oss:20b-cloud`，不得出现在 local-only model 路径 |
| Embedding model | Settings 已保存 `bge-m3`，但尚未安装；执行 AI-09 前再运行 `ollama pull bge-m3` |
| 自动化门禁 | `npm run check` 通过：TypeScript、ESLint、`495/495` 自动测试与 production build；`git diff --check` 通过。`npm audit --omit=dev` 本轮因外部 registry 访问被安全审查拒绝，不能据上次结果宣称本轮无漏洞；发布前需另行获准运行或由 CI 执行 |

不要只写“最新版本”；commit SHA 才能准确复现。

当前安装到 test-vault 的候选资产 SHA-256（2026-09-13 22:37 NZST 重新执行
`npm run build` 与 `npm run install:test-vault`；source 与 test-vault 安装副本已逐项核对一致）：

| 资产 | SHA-256 |
| --- | --- |
| `main.js` | `fb7ea4ef8c3622a50f95ab2ad47e99ddd07de23427f8c0ce2825c08c79f6d3a3` |
| `manifest.json` | `7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb` |
| `styles.css` | `8eaab08b7a639beb57fabc9ff892f90d351fcd6c1e491026ee1e3f91d8e4188d` |
| `omd-eventkit` | `78db9fd4c4df14602adcbc5d888406f4ac51185b3bc798697551ed580444a33c` |

`data.json` 仍保留既有测试身份与设置，未作为发布资产重新生成；当前 SHA-256 为
`4715cd9dea18878c7c78ffbee52e083c70d0ecb87d1263b9f16a2360046285b6`。

2026-09-11 上一轮安装后的安全检查只读取字段名和凭证是否存在，不读取凭证值：当时 `data.json` 没有
secret-like 字段名或已知 key pattern；准确的 OpenAI Keychain entry 当前为 **PRESENT**，启动本次
Terminal 的 `OPENAI_API_KEY` 为 **UNSET**。兼容 OMD bridge 已成功从 Keychain 识别凭证，读取
`api.openai.com` 的 model catalog，并确认 `o3-mini` 可用；preview-only smoke test 也成功生成了只含
1 条本地检索证据的 consent preview，未执行 provider answer。继续 AI-04 B/C 前只需在插件内
**Check setup**；除非要替换 key，否则不要重复 **Save & check**。

2026-09-07 的首次安装曾准备到 **Install-00 第 4 步完成**：当时插件目录只有三项基础资产，
尚无 `data.json`。这是历史基线，不是当前目录应满足的清理条件。当前测试已推进到
**AI-02 暂时记为 `NOT RUN`**；继续测试时保留现有 `data.json`、笔记和测试进度。进入
AI-07/CAP-02 前确认 endpoint 为 `http://localhost:11434`、Ollama 已启动，并重新
**Check setup**；不重跑 clean install。
更新候选版只替换同一次 build 的 `main.js`、`manifest.json`、`styles.css`；可选
`omd-eventkit` 可以另行保留或安装，不计入三项发布资产。当前源目录中的
`dist/omd-eventkit` 是可选 helper 的构建产物。`Manual Test Notes/` 中预装的 5 篇 Markdown fixtures 是受控
测试素材，不是从用户 vault 恢复的数据。上一轮完整 test-vault 没有永久删除，保存在：

```text
/Volumes/Transcend_q/APPS/AI/omd-home-test-vault-backups/20260909-004952-NZST-pre-final-resume
```

不要为恢复测试而把旧备份覆盖回活动 vault。`npm run install:test-vault` 会保留现有
`data.json`，但在 helper 已构建时也会安装它；只有专门重测“无 helper 的首次安装”时才按
Install-00 建立新的干净基线。`_attachments/`、`Index/` 和 `Sources/` 在初始准备时为空，
后续 Capture/index 测试可以正常在其中生成产物。

<a id="guide-test-fixtures"></a>

### 1.4 本轮已经准备的测试素材

素材总说明位于
`/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/README.md`。所有内容都是
synthetic，可安全编辑、转换和删除，不包含个人资料。

| 测试 | 素材位置 | 当前状态 |
| --- | --- | --- |
| HOME-01 / Pin / Vault tags | `test-vault/Manual Test Notes/` | 5 篇已预装；首次打开即可使用 |
| CAP-01 普通路径、空格路径、拖放 | `docs/manual-test-fixtures/capture/` 与 `generated/` | 已生成 |
| `~/` 路径 | `~/Desktop/OMD Home Test Fixtures/survival analysis sample.html` | 已复制 |
| Desktop 空格路径 | `/Users/shion/Desktop/OMD Home Test Fixtures/survival analysis sample.html` | 已复制 |
| CAP-01A OCR / scanned PDF / ASR | `docs/manual-test-fixtures/generated/` | 3 PNG、1 PDF、2 WAV 已验证 |
| AI-08 / AI-09 RAG | `docs/benchmark-vault/` | 保留在 vault 外；到相应 Case 才按步骤导入 |

短 WAV 约 7 秒，用于 ASR 正确性；`slow-bilingual-speech.wav` 约 114 秒，用于 CAP-06
后台生命周期。扫描 PDF 是一页 image-only 文档，已确认没有文本层。不要在 HOME-01 前导入
benchmark fixtures，以免改变 Recent notes 和基础检索结果。

以下内容故意不预先创建：`retry-source.html`（必须先缺失才能测试 Retry）、Calendar events
（需要通过真实 UI/EventKit 创建）、hosted provider developer keys、旧版 OMD executable，以及
待删除的 Ollama model。这些项目涉及真实权限、凭证或破坏性故障注入，应只在对应 Case 中操作。

<a id="guide-plugin-assets"></a>

## 2. 如何取得要测试的插件文件

下面三种方式只选一种。不要把不同 commit 或不同版本的文件混在一起。

### 方式 A：从当前源码 checkout 构建（发布前 RC 推荐）

如果已有源码 checkout：

```bash
cd "/absolute/path/to/obsidian-omd-home"
git status --short
git fetch origin
git switch main
git pull --ff-only
npm ci
npm run build
```

- `git status --short` 必须为空。如果有自己的未提交修改，不要强行切分支或覆盖；改用新的 clone。
- 要测试指定 commit 时，用 `git switch --detach <commit-sha>`，再运行 `npm ci` 和
  `npm run build`。
- 构建成功后，三项候选资产位于源码目录根部：
  `main.js`、`manifest.json`、`styles.css`。
- 用 `git rev-parse HEAD` 记录 commit。
- 测试结束后，如需返回主分支，运行 `git switch main`。

没有源码 checkout 时：

```bash
git clone https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
git switch main
npm ci
npm run build
```

### 方式 B：下载 GitHub Release 资产（tag 已发布后使用）

浏览器操作：

1. 打开 <https://github.com/omd-local/obsidian-omd-home/releases>。
2. 进入你要测试的**准确版本**，例如 `0.1.1`。
3. 展开 **Assets**。
4. 分别下载 `main.js`、`manifest.json`、`styles.css`。
5. 不要下载 **Source code (zip)** 或 **Source code (tar.gz)** 当作插件包；源码压缩包不等于
   已构建的 Community Plugins 安装资产。
6. 打开下载的 `manifest.json`，确认 `version` 与 Release tag 完全相同，tag 不带 `v` 前缀。
7. 三个文件必须来自同一个 Release，不能保留旧版本的任意一个文件。

如已安装 GitHub CLI，也可以：

```bash
mkdir -p "/absolute/path/to/release-assets"
gh release download <version> \
  --repo omd-local/obsidian-omd-home \
  --pattern main.js \
  --pattern manifest.json \
  --pattern styles.css \
  --dir "/absolute/path/to/release-assets"
```

如果目标版本尚未出现在 Releases（发布前 RC 通常如此），不要拿旧 Release 冒充新版本；改用
方式 A 从指定 commit 构建。

### 方式 C：安装到仓库自带的 test-vault

必须在源码目录运行：

```bash
cd "/absolute/path/to/obsidian-omd-home"
npm run build
npm run install:test-vault
```

脚本会安装到：

```text
/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home
```

它会：

- 总是复制 `main.js`、`manifest.json`、`styles.css`。
- 只有 `dist/omd-eventkit` 存在、是普通文件并且可执行时，才额外复制 helper。
- 已有 `data.json` 时不会覆盖它。
- 第一次安装且找到相邻 OMD launcher 时，可能写入一个初始 `data.json`。
- 把 `omd-home` 加入 test-vault 的 `.obsidian/community-plugins.json` enabled list。
- 在 test-vault 缺少 `.obsidian/app.json` 时创建空的 `app.json`。
- 不会安装到你的日常 vault，也不会全局安装插件。
- 不会启动或 reload Obsidian。

此脚本不是 clean 命令：它会覆盖三项 bundle，但不会先删除旧插件目录。假如旧目录中已有
`data.json` 或旧 `omd-eventkit`，它们可能继续保留。需要测试真正的首次安装或“没有 helper”
分支时，必须先按第 3 节把整个旧目录移走，再运行脚本。

然后在 Obsidian 中选择 **Open folder as vault**，打开
`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault`。

<a id="guide-clean-install"></a>

## 3. 如何安全、完整地移除旧安装

### 3.1 先决定是否保留旧设置

`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/data.json`
包含本地设置和布局。

- 要模拟真正的首次安装：把整个 `omd-home` 文件夹移出插件目录，不恢复 `data.json`。
- 要测试升级/重装：保留 `data.json`，只覆盖三项发布资产。
- 不确定时先备份。没有备份而永久删除后，旧设置无法恢复。

### 3.2 Finder 操作（推荐，可恢复）

1. 如果插件还能正常出现在 Obsidian 中，先打开 **Settings → Community plugins → Installed
   plugins → OMD Home**，从其菜单选择 **Uninstall**。这一步会让 Obsidian 同时更新 enabled
   plugins 记录；按钮名称会因 Obsidian 版本略有差异。
2. 完全退出 Obsidian；只关闭窗口不一定会卸载插件进程。
3. 在 Finder 按 `Command + Shift + G`。
4. 输入测试 vault 的准确路径，例如：
   `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins`。
5. 找到文件夹 `omd-home`。如果 Obsidian 的 Uninstall 已经把它删掉，这里看不到是正常的。
6. 如果仍存在，把整个文件夹移动到 vault 外部的备份位置或废纸篓。
7. 确认 `.obsidian/plugins` 中不再有 `omd-home`。
8. 不要移动或删除其他插件文件夹。

把整个 `omd-home` 目录移出 vault 已经是“完整移除这个 vault 的插件安装”：三项 bundle、
`data.json`、可选 `omd-eventkit` 和目录内其他残留都会一起离开。它不会删除源码仓库、OMD、
Ollama、模型或其他 vault 中的独立安装；这些也不应该在本测试中被删除。确认不再需要备份后，
可以稍后从 Finder 删除备份或清空废纸篓。

### 3.3 Terminal 操作（推荐移动备份，不直接 rm）

先检查目标，确认输出的确是要测试的 vault：

```bash
ls -la "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home"
```

然后把旧插件移到 vault 外的备份位置：

```bash
mv "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home" \
   "/absolute/path/outside-vault/omd-home-backup-before-test"
```

- 备份目标不能已经存在；如果存在，换一个明确的新名字。
- 如果 `ls` 显示 “No such file or directory”，表示这个 vault 没有旧安装，可以跳过移动。
- 不要把备份留在 `.obsidian/plugins` 内，否则 Obsidian 可能仍把它识别为插件。
- 不要运行针对 `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault`、`.obsidian` 或 `plugins`
  上级目录的递归删除命令。

确认已经从 vault 移除：

```bash
test ! -e "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home" \
  && echo "Old OMD Home install is absent"
```

如果你是手动移动目录而不是使用 Obsidian 的 Uninstall，
`/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/community-plugins.json`
中可能仍保留字符串 `"omd-home"`。这不会让缺失的代码
继续运行，但会影响“用户需要手动 Enable”的首次安装测试。普通重装可以保留它；真正的 onboarding
测试应优先用 UI Uninstall。如果 UI 无法使用，只在 Obsidian 已退出且已经备份该文件时，用文本
编辑器从 JSON 数组中删除准确的一项 `"omd-home"`，不要删除整个文件或其他插件 ID。重新打开文件，
确认 JSON 仍是类似 `["another-plugin"]` 的有效数组。

### 3.4 手动安装三项候选资产

以下是重做首次干净安装时的操作模板，不是 AI-02 暂停后的恢复步骤。继续本轮测试应保留
`data.json`，只更新三项资产。首次安装使用两个不同目录，不能混淆：

- **候选资产来源（干净 checkout）**：
  `/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean`
- **插件安装目标（实际测试 vault）**：
  `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home`

不要在原始 working repo 内再次运行 `git clone`。也不要在
`omd-home-0.1.1-clean` 中运行 `npm run install:test-vault`：那会安装到干净 checkout 自己的
`test-vault`，而不是本轮指定的 vault。

#### 第一步：确认 Obsidian 已退出，目标仍是干净状态

```bash
test ! -e "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home" \
  && echo "Ready: no previous OMD Home install"
```

必须看到 `Ready: no previous OMD Home install`。没有输出表示旧安装仍在，返回第 3.2 或 3.3 节
处理，不要直接覆盖。

#### 第二步：确认候选源码身份并重新构建

```bash
cd "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean"
git status --short
git rev-parse HEAD
node -p 'require("./manifest.json").version'
npm ci
npm run build
```

预期：

- `git status --short` 没有输出。
- commit 是 `6adac24442caa450a76184c728284ca26bdb086f`。
- manifest 版本是 `0.1.1`。
- `npm ci` 和 `npm run build` 成功。

确认三个源文件存在：

```bash
ls -lh \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/main.js" \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/manifest.json" \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/styles.css"
```

#### 第三步：创建目标插件目录

```bash
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home"
```

#### 第四步：复制同一次 build 的三个文件

```bash
cp "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/main.js" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/main.js"
cp "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/manifest.json" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/manifest.json"
cp "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/styles.css" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/styles.css"
```

#### 第五步：确认安装完整且没有混入另一版本

外接磁盘可能自动生成隐藏的 AppleDouble `._*` 元数据；它们不是插件资产，也不能进入 GitHub
Release。下面的命令忽略这些元数据，只列出实际插件文件：

```bash
find "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home" \
  -maxdepth 1 -type f ! -name '._*' -print | sort
```

首次 Community-style 安装必须只列出 `main.js`、`manifest.json`、`styles.css`。再确认安装后的
manifest：

```bash
node -p 'require("/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/manifest.json").version'
```

预期为 `0.1.1`。最后逐项比较源文件和安装文件：

```bash
cmp -s \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/main.js" \
  "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/main.js" \
  && echo "main.js matches"
cmp -s \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/manifest.json" \
  "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/manifest.json" \
  && echo "manifest.json matches"
cmp -s \
  "/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/styles.css" \
  "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/styles.css" \
  && echo "styles.css matches"
```

必须看到三个 `matches`。

#### 第六步：打开准确的 vault 并 Enable

1. 打开 Obsidian vault switcher。
2. 选择 **Open folder as vault**。
3. 只选择 `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault`。
4. 打开 **Settings → Community plugins**，允许 Community plugins。
5. 在 Installed plugins 中找到 **OMD Home** 并 Enable。
6. 如果列表没有出现 OMD Home，完全退出并重开 Obsidian，再检查目标目录与 manifest。

不要打开 `/Volumes/Transcend_q/APPS/AI/omd-home-0.1.1-clean/test-vault`；它不是本轮测试目标。

#### 后续测试“保留设置的重装”时

第一次安装不应存在 `data.json`。只有完成首次启动、插件已经创建设置后，才在再次复制前后运行：

```bash
shasum -a 256 "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/data.json"
```

预期：覆盖三项资产后，`data.json` hash 不变。

## 4. Release Candidate 测试顺序

测试编号按功能分组，并不代表执行顺序。请按下面的依赖顺序测试：先证明干净安装与无依赖 UI，
再加入 OMD、EventKit 和本地 AI；云端 provider 放在本地链路稳定之后；故障注入和最终 bundle
验收放在最后。点击 Case 名称可直接跳到对应步骤。

开始 Case 前依次完成：[测试前准备](#guide-test-preparation) →
[取得候选插件文件](#guide-plugin-assets) →
[移除旧安装](#guide-clean-install)。需要输入文件时查看
[已准备的测试素材](#guide-test-fixtures)。

> 本轮将 **[AI-02](#test-ai-02)** 暂时记为 `NOT RUN`。保留当前 `data.json` 和测试进度；
> 进入 AI-07/CAP-02 前恢复有效 endpoint 与 daemon，并重新 **Check setup**，无需重新
> 清理安装。上方 SHA-256 是当前已安装候选的身份；此后如果再次 rebuild/reinstall，必须
> 同步更新时间和 hash。

### 阶段 A：干净安装与无外部依赖 UI

1. **[Install-00：首次干净安装与重装](#test-install-00)**（Core）— 建立可信的 RC 安装基线。
2. **[HOME-01：默认布局和文字对齐](#test-home-01)**（Core）— 先验证默认 Home，不让外部工具状态干扰布局判断。
3. **[HOME-02：移动、推挤与 Resize 可发现性](#test-home-02)**（Core）— 在默认布局通过后再验证布局持久化。
4. **[CMD-01：Obsidian core/community commands 与 Recorder](#test-cmd-01)**（Core）— 验证基础命令注册和第三方命令兼容。

### 阶段 B：OMD 与基础 Capture

5. **[OMD-01：首次自动发现、缺失引导和高级覆盖](#test-omd-01)**（Core）— 后续 Capture 和 AI bridge 的共同前置条件。
6. **[CAP-01：URL、普通路径、空格路径与拖放](#test-cap-01)**（Core）— 先证明不依赖 AI 的转换主链路。
7. **[CAP-03：失败归属与 Setup health](#test-cap-03)**（Core）— 有成功基线后再注入 OMD/path 失败，错误归属更容易判断。

### 阶段 C：Calendar / EventKit

8. **[CAL-00：Helper、权限、明确选择 Calendar](#test-cal-00)**（Core）— 先安装 helper 并建立权限和 calendar selection 基线。
9. **[CAL-01：Start / End 与 All day](#test-cal-01)**（Core）— 先验证单个事件编辑。
10. **[CAL-02：Vault / Calendar / Linked filters](#test-cal-02)**（Core）— 有事件后再验证来源与筛选。
11. **[CAL-03：Linked sync 与双向冲突](#test-cal-03)**（Core）— 最后测试依赖前述事件和 filter 的双向同步。

### 阶段 D：本地 AI、Capture 增强与 RAG

12. **[AI-00：Settings 信息架构、文案与响应式布局](#test-ai-00)**（Core）— 先验证 AI 设置主流程的结构。
13. **[AI-01：本地 Ollama、模型目录与默认 local-only 选择](#test-ai-01)**（Core）— 建立本地 daemon 和 text model 基线。
14. **[AI-02：Ollama daemon、endpoint 与本地模型隔离](#test-ai-02)**（Core）— 在正常连接通过后验证 daemon/endpoint/model 状态分离。
15. **[AI-07：本地 Omnibox 结果、证据、复制与返回用时](#test-ai-07)**（Core）— 先证明真实本地问答主链路可用。
16. **[CAP-02：本地 AI 生成 links/tags，Review 后才写入](#test-cap-02)**（Core）— 同时依赖成功 Capture 与可用本地模型。
17. **[AI-06：Command Palette 诊断、后台任务与 Cancel](#test-ai-06)**（Extended）— 正常 AI 路径通过后再测诊断和取消。
18. **[CAP-06：后台继续、unload 和退出取消](#test-cap-06)**（Core）— 复用已经验证的后台任务生命周期。
19. **[AI-08：新的 Section-aware Vault Q&A benchmark](#test-ai-08)**（Extended）— 在基本 RAG 可用后评估答案质量。

### 阶段 E：云端回答与多 Provider 隔离

20. **[AI-03：Ollama Cloud 设置入口与逐题 preview](#test-ai-03)**（Core）— 保持 `bge-m3` 未安装，先验证 Cloud preview 和“未安装”降级。
21. **[AI-04：OpenAI、Anthropic 与 DeepSeek 设置入口](#test-ai-04)**（Core）— 保持 `bge-m3` 未安装，逐一验证 credential、preview、发送边界和准确的 embedding 降级原因。
22. **[AI-09：Multilingual hybrid retrieval 与 semantic rerank](#test-ai-09)**（Extended）— AI-03/04 完成 missing-model 分支后，才安装 `bge-m3` 并建立 Keyword + semantic search 基线。
23. **[AI-05：Provider 切换、每个 provider 的 model 记忆与本地工作流隔离](#test-ai-05)**（Core）— 必须在多个 provider 已配置后执行。
24. **[AI-11：Credential 状态、逐题证据与并发取消回归](#test-ai-11)**（Core）— 在正常本地/hosted 路径通过后测试状态刷新、provider 切换与待批准请求的取消。

### 阶段 F：恢复与发布资产

25. **[AI-10：Stale model、reload/unload 与故障恢复](#test-ai-10)**（Extended）— 故障注入可能改变当前环境，因此放在所有正常路径之后。
26. **[REL-01：干净 vault 与三项 bundle](#test-rel-01)**（Core）— 使用最终 clean build 做最后发布验收。

如果本轮只跑 Core，请按以上顺序跳过标记为 Extended 的 17、19、22、25，不能因为跳过而把它们
记录为 PASS；应记录为 `NOT RUN` 并写明原因。若 Core 中没有可用 hosted developer key，仍完成
AI-04 的无 key与 opt-in 关闭边界；需要有效 key/model 的 catalog、preview、cancel 和真实网络
分支记录为 `NOT RUN`，不得假装无 key 也能打开发送 preview。

每个案例记录：

| Case | PASS / FAIL / NOT RUN | 用时 | 截图/日志 | 备注 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

`NOT RUN` 必须写清原因，例如“没有第二个 Ollama 环境，不愿删除现有模型”，不能当作 PASS。

## 5. Home 与 Omnibox

<a id="test-install-00"></a>

### Install-00：首次干净安装与重装

1. 完全退出 Obsidian。
2. 按第 3 节，将目标 vault 的旧 `omd-home` 安装移出插件目录。
3. 按第 2 节取得同一 build 的 `main.js`、`manifest.json`、`styles.css`。
4. 按第 3.4 节只安装这三项文件。
5. 启动 Obsidian，打开目标 vault。
6. 打开 **Settings → Community plugins**：
   - 如果 OMD Home 已在 Installed plugins 中，先关闭再开启一次。
   - 如果看不到，确认目录名是 `omd-home`、`manifest.json` 可读取，并重启 Obsidian。
7. 用命令面板（`Command + P`）运行 **OMD Home: Open home**。
8. 确认：
   - 没有启动 crash 或无限重载。
   - Home 与 Settings 可以打开。
   - 缺少 OMD/Ollama/EventKit 时显示可操作提示，而不是“插件损坏”。
   - Home 中不存在重复的同一条错误。
9. 在不安装可选 helper 时先跑 `HOME-01`、`HOME-02`、`CMD-01`，以及
   `CAP-03` 的第 1–2 步。
10. 再配置需要的依赖：
    - OMD：先不要填写路径；等待主状态卡自动发现，再完成 `OMD-01`。
    - Advanced OMD paths：默认保持折叠；只有自动发现失败的诊断测试才打开。
    - Python executable override：先留空；macOS/Linux 测试从检测到的 OMD shebang 自动发现，Windows 测试从 OMD launcher 所在的虚拟环境自动发现 `python.exe`。
    - OMD Home bridge override：先留空，使用打包在 `main.js` 内的 bridge。自定义 bridge 属于
      开发／恢复路径；它的 answer JSON 必须包含 `grounding_contract_version: 1`，否则插件应在
      发送任何模型结果前拒绝该输出，并提示改回 bundled bridge 或升级自定义 bridge。
    - EventKit helper：只在 Calendar 阶段安装。
    - Ollama 与模型：只在 Local AI 阶段启动。
11. 完成 `AI-00` 至 `AI-05` 以及 `AI-07`。没有 hosted developer key 时，将 `AI-04` 中需要
    catalog、preview / cancel 或真实发送的分支记录为 `NOT RUN`；仍完成无 key 与 provider
    opt-in 关闭边界，但不得绕过 credential 前置条件来伪造 preview。
12. 测试保留设置的重装：
    - 不删除 `data.json`。
    - 记录其 SHA-256。
    - 再次覆盖同一 build 的三项资产。
    - 重载插件并重复步骤 7–11。
    - 确认 `data.json` SHA-256 不变。

通过条件：首次安装和保留设置重装都能加载；失败显示在 Needs attention 且可以 Retry；
Current task 不长期残留已结束的任务；插件不要求把布局或设置写到 vault 外部。

<a id="test-omd-01"></a>

### OMD-01：首次自动发现、缺失引导和高级覆盖

#### A. 普通用户主流程

1. 确保本机已有兼容 OMD，但不要在 OMD Home 中填写 executable 路径。
2. 打开 **Settings → OMD Home → OMD**。
3. 首次打开时允许状态短暂显示 **Detecting OMD**，随后应变为 **OMD ready**。
4. 确认状态说明是自动发现，并显示实际候选路径，或说明通过 app executable path 找到。
5. 确认 **Advanced OMD paths** 默认折叠；不展开它也能 Capture 和 Suggest links and tags。
6. 完全退出并重新打开 Obsidian，重复步骤 2–5；不应要求再次手填路径。

#### B. 缺失和错误路径引导

不要删除正在使用的 OMD。展开 **Advanced OMD paths**，在 **OMD executable override** 临时填入：

```text
/tmp/omd-home-does-not-exist/omd
```

1. 输入路径时确认主状态立即变为 **OMD check needed**，说明会在离开输入框后验证；按 `Tab`
   或点击输入框外部。
2. 确认插件自动完成验证并显示 custom executable 找不到。若界面仍在 checking，可点击
   **Check again** 重试。错误状态应同时出现：
   - **Use automatic**
   - **Copy install commands**（macOS）或 **Copy install steps**（Windows/Linux）
   - **Install guide**
   - **Check again**
3. 点击 Copy；macOS 剪贴板内容必须是：

```bash
brew install omd-local/omd/omd
omd doctor
```

4. 点击 **Install guide**，确认打开官方
   `https://github.com/omd-local/markdown-everything#quick-start`。
5. 确认插件没有自动打开 Terminal、没有执行 Homebrew/pip、没有弹管理员授权，也没有修改
   OMD/Python 安装。
6. 点击 **Use automatic**；确认 override 视觉上恢复为空，并重新找到原来的兼容 OMD。

如需验证真正的 **OMD not installed** 状态，只能在没有任何 OMD 的干净测试账户/虚拟机中进行；
不要为了这个 case 删除日常使用的安装。该状态也必须提供 Copy、Install guide 和 Check again。

#### C. 旧版候选

如果保留了一个可安全测试的旧版 OMD，可把它的绝对路径临时填入 override，再点击 **Check again**。
应显示 **OMD update required** 和 **Update guide**，而不是误报 not installed。完成后清空 override，
点击 **Use automatic** 或 **Check again** 恢复。

通过条件：默认流程不要求路径；自动发现能跳过 missing/old candidate 并选择兼容候选；缺失与旧版
状态不同；复制/外链行为明确且插件从不执行安装命令；手动路径只存在于折叠的 Advanced 区域。

<a id="test-home-01"></a>

### HOME-01：默认布局和文字对齐

1. 在 Home 右上角打开 widget/layout 菜单，选择重置布局。
2. 确认默认布局：
   - Today 与 OMD Inbox 是两列一行。
   - Current task 与 Needs attention 是两列一行。
   - Recent notes 与 Upcoming 是两列一行。
   - Pinned、Vault tags、System 是三列一行。
   - 默认没有 Continue widget。
3. 使用已经预装在 `Manual Test Notes/` 的 5 篇 Markdown fixtures，观察 Recent notes：
   - `A.md`：最短文件名。
   - `English Markdown Note.md`：英文正文和 `language/en`、`project/omd-home` nested tags。
   - `中文 Markdown 测试笔记.md`：中文标题、正文和 `language/zh` nested tag。
   - `This is an intentionally very long English Markdown filename used to test truncation alignment and pin controls.md`：长文件名。
   - `Synthetic OMD Inbox Capture.md`：带 `omd_home_status: inbox`，用于 Inbox Pin/Unpin；它是人工 fixture，不用于证明真实 Capture 成功。
4. 在以下三个入口分别测试可见的 **Pin** 按钮：
   - Recent notes 的一篇 Markdown 笔记。
   - OMD Inbox 的一篇 capture 笔记。
   - 在 omnibox 输入文件名后出现的 vault 搜索结果。
5. 每个入口都确认：点击 **Pin** 不会打开笔记；按钮变为 **Unpin**；笔记只在 Pinned
   出现一次；右下角出现 `Pinned to OMD Home.` 确认信息。
6. 在任一入口点击 **Unpin**，确认按钮恢复为 **Pin**、笔记从 Pinned 消失，并出现
   `Unpinned from OMD Home.`；再用文件列表右键菜单重复一次 Pin/Unpin。
7. 分别点击三个入口中的笔记标题区域，确认它仍会正常打开笔记。
8. 保持 Obsidian 左侧栏打开，逐步缩窄主内容区域。

通过条件：每条标题和路径从同一左边界开始；不会按文字长度产生不同缩进；窄窗口先堆叠，
不裁掉右列；三个入口都能直接 Pin/Unpin 且不会误打开笔记或产生重复项；Pinned 是用户主动
收藏，OMD Inbox 是新 capture 的 review queue，两者不重叠。

<a id="test-home-02"></a>

### HOME-02：移动、推挤与 Resize 可发现性

1. Hover widget，确认 drag grip、边框或移动状态清楚可见。
2. 把 widget 拖到已有 widget 的位置并释放。
3. 确认被占位置的 widget 会自然移开，不重叠、不消失。
4. 拖动右下角 resize handle。
5. 让 handle 获得键盘焦点后使用方向键。
6. 从 widget 菜单选择 **Use standard size**。

通过条件：移动/resize 中有明确 outline；其他模块会被推开；标准尺寸能恢复；刷新或重开
Obsidian 后，该设备的布局仍被保存。

## 6. AI answers 与 Vault Q&A

本节把两种能力分开验收：

- **本地回答**：选择 **Ollama on this computer** 后，`@` 问题可以读取有界 Vault 证据，并只发送到
  本机 loopback Ollama。Ollama 的 Cloud 可用状态本身不应阻止本地模型使用。
- **云端回答入口**：Ollama Cloud、OpenAI API、Anthropic API、DeepSeek API 都是
  provider-scoped 的显式 opt-in。每次真正发送之前都必须先显示 preview，并由用户逐次
  确认；选择一个 provider 不会自动启用另一个 provider。

任何设置检查都不得读取笔记正文。Vault Q&A 的本地检索、local enrichment、Polish Markdown
和 local embedding retrieval 会处理有界 Vault 内容；hosted 回答只在逐题批准后接收预览中的
question 与选定证据片段。

### 共用前置条件

1. 完成 `OMD-01`，确认 **Settings → OMD Home → OMD** 显示 **OMD ready**。
2. 普通测试保持以下 override 为空：
   - **OMD executable override**
   - **Python executable override**
   - **OMD Home bridge override**
3. 如需核对 OMD contract，在 Terminal 使用 OMD Home 状态卡显示的 executable 路径：

```bash
"/path/shown/by/omd-home" capabilities --json
```

输出必须是 JSON，且 `enrich_note.supported` 为 `true`、schema version 为 `1`。
4. 启动 Ollama App并检查 daemon：

```bash
open -a Ollama
curl -sS http://localhost:11434/api/status
ollama list
```

`curl` connection refused 表示 daemon 没有运行。`ollama list` 用来对照本机已经下载的模型，
不是让 OMD Home 自动下载模型。Cloud 可用与否只记录为环境信息，不会阻止本地模型测试。
5. 云端 provider 测试会联系设置页明确显示的 destination。只使用你愿意用于测试的 developer
API key。ChatGPT 或 Claude 的消费者订阅不等于 API 额度。没有可用 developer key 时，把对应
网络案例记为 `NOT RUN`，不要使用个人主账号密钥截图或粘贴进测试记录。
6. 验证本地模型和 AI-02 时，不修改 Ollama 的 Cloud 设置。只有进入 AI-03、且
   测试者自己曾用 `server.json` 或 `OLLAMA_NO_CLOUD` 强制 local-only 时，才撤销自己设置的
   override。不要为了制造另一种 Cloud 状态而改动用户全局配置。

<a id="test-ai-00"></a>

### AI-00：Settings 信息架构、文案与响应式布局

1. 打开 **Settings → OMD Home**。
2. 确认顶层顺序稳定：**Startup → OMD → AI answers → Calendar**。
3. 在 **AI answers** 主流程中只应看到：
   - **Answer provider**
   - 云端 provider 下的只读 **Request destination**
   - 当前云端 provider 下的 **Allow … answers** 授权开关
   - Hosted API 时的 **Developer key**
   - **Answer model**（本地 Ollama 或当前云端 provider）
   - **Answer setup** 与唯一主操作 **Check setup**
4. 确认本地或云端边界说明直接写在主描述文案里，而不是单独再出现一个
   **Local-only boundary** 或 **Cloud boundary** setting。
5. 确认设置页没有单独的 **Refresh models**、**Model catalog** 或三组 Smoke 按钮。
   这些低频诊断只保留在 Command Palette。
   **Check setup** 结果必须把「本机模型总数」与「可用于回答的 text/completion 模型」明确
   分开；不能把「已下载」暗示成可回答。本地 **Answer model** 下拉框应列出每个本机已下载
   模型：可回答的模型可以选择，embedding-only、thinking-only 或已确认不兼容的模型保留可见但
   必须禁用，并直接在 option label 解释原因。Cloud-backed 条目不混入这份本机列表。
6. **Advanced AI controls** 默认折叠。展开后只包含：
   - Vault retrieval
   - Local writing tools，以及唯一的 **Local writing model**
   - Ollama troubleshooting
   Settings 中不得再出现 **Polish Markdown** 或 **Review links and tags** 的 capture 开关副本。
   **Local writing model** 同样应显示全部本机已下载模型。旧版 Ollama 若未在 `/api/tags` 返回
   capability metadata，本机模型应标为 **completion support unverified**，允许选择后通过
   **Check setup** / 执行前检查确认；已确认 embedding-only 或 thinking-only 的条目可见但禁用，
   remote-backed 条目不混入本机列表。如果这些模型之一已经保存在旧设置中，仍应显示原值和
   醒目的 unavailable 状态，并提示选择其他本地 completion model 或运行 **Check setup**，不得
   静默替换。
7. 打开 **Capture URL or file**。确认两个 capture 动作只在 **Optional local AI** 下出现：
   **Polish Markdown** 与 **Review links and tags**。说明文字应明确两者共用 Local writing model、
   新 capture 会记住最近一次已提交的选择，并且 Retry 保留失败任务的选择。
8. 来回选择五个 provider。确认 section 只局部更新，不闪回页面顶部，不改变外层滚动位置，
   也不显示上一个 provider 的成功或错误反馈。
9. 对任一已通过检查的 provider 更换 **Answer model**。旧的成功状态应立即失效，并提示重新
   **Check setup**，不能继续把上一个 model 显示为 ready。未检查的 **Unchecked** 使用中性的
   相邻状态条，不得伪装成错误；成功 **Ready** 与缺少模型、daemon 不可达等真实错误使用更醒目、
   可区分的相邻状态条。不得只靠颜色区分，也不得把状态词藏在一大段说明文字中。
10. 先缩窄整个 Obsidian 窗口，再在宽窗口里单独缩窄 Settings 内容面板（例如加宽左侧设置导航栏），
    最后恢复。两种情况下都应按内容面板宽度切到单列；确认 label 字号和左边界不变化，dropdown、
    secret input 与按钮自然换行，不盖住说明文字，也不产生横向滚动。
11. 对照 **Startup → OMD → AI answers → Calendar** 四个同级 section：标题的字号、字重、
    间距保持一致；紧随标题的说明使用同一较弱但清楚可读的字体层级。再对照 **Advanced AI
    controls** 内的 **Vault retrieval**、**Local writing tools**、**Ollama troubleshooting**：同级
    小标题及其说明各自一致，且不与字段 label、错误或成功状态混淆。宽、窄面板均不能截断、
    重叠或让说明贴到控件边缘。
12. 选择 **DeepSeek API**，对照 **Allow DeepSeek API answers** 与 **Developer key** 两张设置卡：
    label、说明和右侧开关／密钥操作采用一致的左右对齐与垂直间距。在宽面板及缩窄到单列后
    分别检查；password 输入、**Save & check**、帮助文字及开关都应完整显示，不覆盖
    彼此，且授权开关的显式 opt-in 含义仍清楚可见。不要在本项粘贴真实 key。
13. 用键盘 Tab 遍历 dropdown、secret input、button、toggle 与 disclosure；焦点必须可见。
14. 检查文案一致性：主流程统一使用 **Check setup**，不混用 Refresh、Smoke 或 Check connection。

通过条件：普通用户不展开 Advanced 也能选择 provider、选择 model 并检查 setup；setup 摘要能
区分已下载、answer-eligible 与 embedding 模型，所有 eligible text model 均可选；高级参数不抢
主流程视觉层级；readiness 状态靠近相关控件且操作反馈带时间戳、不会跨 provider 残留。

<a id="test-ai-01"></a>

### AI-01：本地 Ollama、模型目录与默认 local-only 选择

1. **Answer provider** 选择 **Ollama on this computer**。
2. 确认 provider 说明文案明确写出：Vault evidence 与 answer generation stays on this computer，
   并说明 Cloud availability 不会改变当前所选本地模型。
3. 点击 **Check setup**。第一次检查应同时读取 daemon 版本、`/api/status` 和本地 model catalog。
4. 对照 `ollama list` 与 **Check setup** 结果，确认目录完整且分类正确：
   - 结果给出本机 model 总数与 answer-eligible 数量；
   - **Answer model** 下拉列出全部本机已下载 model；已确认 answer-eligible 的 text model
     和缺少 capability metadata、标为 unverified 的本机 model 可选择，后者须经 Check setup
     或执行前检查；已确认 embedding-only、thinking-only 或非 text-capable model 可见、禁用并带原因；
   - 同时报告 `thinking` 与 `completion` 的 model 仍属于 answer-eligible，不得误标为
     thinking-only；只有缺少 completion 能力，或已知无法稳定返回 OMD Home 可见答案的
     alias 才能禁用；UI 不向普通用户暴露内部 token budget 术语；
     默认应优先落在 `qwen3:4b-instruct` 这类 instruct model；
   - 插件不会隐藏、自动 pull 或静默替换 model。
5. 选择另一个已安装 text model，再点 **Check setup**。
6. 选择 **Custom model id…**，输入一个已安装 model 的准确 ID 并检查。
7. 输入不存在的 ID，确认显示 missing/unavailable；恢复有效 model。
8. 可选诊断：Command Palette 运行 **OMD Home: Refresh local AI models**。设置页 dropdown
   应更新，但页面不跳动。
9. 如果 Ollama App 此时显示 Cloud 可用，本地 **Ollama on this computer** 仍应保持可检查、
   可运行，不需要先把 `cloud.disabled` 重新改回 `true`。

通过条件：本地 model catalog 与 daemon 一致；摘要清楚分开 downloaded、answer-eligible text
与 embedding 模型；所有 eligible text model 均可选择，所选 model 不被静默改写；成功反馈包括
model、版本或 readiness 与时间戳。

<a id="test-ai-02"></a>

### AI-02：Ollama daemon、endpoint 与本地模型隔离

本节验证 OMD Home 能否把 daemon、endpoint 和 model 问题准确分开。核心流程不会修改
`~/.ollama/server.json` 或 `OLLAMA_NO_CLOUD`；Ollama Cloud 的启用流程由 AI-03 单独验证。
本地 provider 的 answer model 与 embedding 都依赖同一个 daemon；daemon 停止时，本地答案本身
也无法生成，因此不要在本节把 answer failure 误判成 embedding fallback。Hosted answer 仍可生成
时的 embedding-to-keyword 降级在 AI-04 D 验证。

1. **Answer provider** 选择 **Ollama on this computer**，**Answer model** 选择一个已安装、
   answer-eligible 的本地模型。保持 endpoint 为 `http://localhost:11434`，点击
   **Check setup**。记录成功状态、时间戳、Ollama 版本和模型名称。
2. 完全退出 Ollama。只关窗口不一定停止 daemon。先从 Ollama 菜单选择 **Quit Ollama**，然后运行：

```bash
curl -sS --max-time 2 http://localhost:11434/api/status
```

只有 connection refused/failed 才证明 daemon 已停止。若 App 拒绝退出，可在 Activity Monitor
中退出名称为 `Ollama` 或 `ollama` 的相关进程。不要结束其他不相关进程。
3. 此时点击 **Check setup**。应显示 daemon unreachable，而不是 model unavailable；在 macOS
   应提供 **Open Ollama app**。点击后等待 daemon 启动，再点 **Check setup**。
4. 确认恢复后显示同一个 **Answer model** 可用，model catalog 与 `ollama list` 一致，停止 daemon
   期间产生的旧错误不会继续覆盖新的成功状态。

   **暂停／交接点（第 4 步后）**：若要在这里退出测试，确认 Ollama 已重新启动，记录当前
   Answer model、daemon 状态和最后一次 Check setup 的时间。恢复测试时，先重新打开
   **Settings → OMD Home → AI answers** 并运行 **Check setup**。只有这一步通过后，才继续
   第 5 步或后续 AI-07/CAP-02。
5. 在 **Advanced AI controls → Ollama troubleshooting** 把 endpoint 临时改成
   `http://localhost:9999`。输入后应立即在输入框下方的独立整行区域显示醒目的 unsupported
   endpoint 提示，并直接列出仅允许的 `http://localhost:11434` 与
   `http://127.0.0.1:11434`；提示不得与输入框并排争抢宽度。缩窄再加宽设置面板，确认
   错误文字、输入框和卡片边缘留白正常，无重叠、贴边、横向溢出或异常断行。错误出现时焦点
   应留在可编辑输入框；用键盘或辅助功能检查，该字段应呈现 invalid 状态，且错误与字段有关联
   （例如 `aria-invalid` 和 `aria-describedby`），不能只靠颜色表达错误。该无效值不得覆盖最后
   一个有效设置，也不必等待发送任何内容。离开再重新打开设置，确认字段恢复为最后一个有效
   endpoint。
6. 把 endpoint 改成允许的替代值 `http://127.0.0.1:11434`，确认输入框下方的 validation
   error 立即消失、字段不再呈现 invalid 状态，再点 **Check setup**。成功后恢复
   `http://localhost:11434` 并再次检查；不得把替代值或 `:9999` 留给后续测试。
7. 确认 `gpt-oss:20b-cloud` 等 cloud-backed model 不会出现在本地 **Answer model** 的正常可选
   列表中。只有当 `ollama list` 或当前 daemon catalog 已显示一个 cloud-backed model 时，
   才用 **Custom…** 输入它的准确 ID；**Check setup** 必须明确显示该 model 被本地路径
   阻止，且此检查不得读取或发送 Vault 内容。当前 daemon 没有这类 model 时，把该
   手动子测试记为 `NOT RUN`，不得为此 pull Cloud model，也不得把 `selected_model_missing`
   误判为隔离失败。随后恢复本地 model。
8. 只观察当前 Cloud 状态，不为本节修改配置：

```bash
curl -sS http://localhost:11434/api/status
```

命令只输出 JSON，不会额外打印 PASS。记录 `cloud.disabled`：若当前为 `false`，再次确认本地
**Answer model** 仍可通过 **Check setup**；若当前为 `true`，本节不为了制造另一个状态而修改
用户配置，把 Cloud-available 的 GUI 覆盖留给 AI-03。自动化测试应继续覆盖 `true`、`false`、
缺少 Cloud 字段三种 status 均不改变已验证本地 model 的 eligibility。

通过条件：daemon unreachable、invalid endpoint、model unavailable 和 cloud-backed model blocked
得到彼此准确的提示；invalid endpoint 不会被保存；两个允许的 loopback endpoint 均可恢复连接；
同时具备 `thinking + completion` 的本地 model 可正常选择；Cloud availability 不会自动改变或阻止
所选本地 model，也不会导致任何 Vault 内容被发送；不得把 completion model 与 embedding model
的错误混为一谈。

<a id="test-ai-03"></a>

### AI-03：Ollama Cloud 设置入口与逐题 preview

1. 在 Ollama App 登录，然后运行 `curl -sS http://localhost:11434/api/status`，确认
   `cloud.disabled` 为 `false`。已经是 `false` 时直接继续，不要编辑配置。

   只有当它是 `true`，而且测试者确认是自己此前为测试 local-only 而创建的
   override，才执行以下恢复；如果不知道配置来源，把 AI-03 记为 `NOT RUN`，不要改动
   用户环境：

   1. 完全退出 Ollama daemon。
   2. 如果 `~/.ollama/server.json` 由测试者改过且包含
      `"disable_ollama_cloud": true`，先备份：

      ```bash
      cp ~/.ollama/server.json ~/.ollama/server.json.omd-home-backup
      ```

      在有效 JSON 中只移除 `disable_ollama_cloud` 这一个 key，保留所有无关 key；不要删除
      整个文件。
   3. 如果测试者此前设置过 launchd 环境变量，运行：

      ```bash
      launchctl unsetenv OLLAMA_NO_CLOUD
      launchctl getenv OLLAMA_NO_CLOUD
      ```

      第二条应无输出。
   4. 重启 Ollama，再查 `/api/status`，只有 `cloud.disabled: false` 才继续 AI-03。

   这是 AI-03 使用 Cloud provider 的前置恢复，不是 AI-02 额外的状态分支测试。
2. **Answer provider** 选择 **Ollama Cloud**。
3. 不选 model，先点 **Check setup**：
   - OMD Home 读取本地 Ollama App 返回的 Cloud 状态与 model metadata；
   - 如果本地还没有 Cloud model metadata，提示先在 Ollama 中运行一次 cloud model；
   - 只有 metadata 同时报告 remote model，且 remote host 严格为 `https://ollama.com`（默认
     HTTPS 端口）时，model 才能进入 Ollama Cloud dropdown；model 名称含 `cloud` 不足以证明
     它可用，其他 remote host 必须在 `/api/chat` 前被阻止；
   - 如果发现符合条件的 models，dropdown 被填充，并提示选择后再次检查。
4. 选择 cloud-backed model，再点 **Check setup**。成功只代表 credential/session 与 model
   metadata 可用。
5. 确认当前 provider 对应的 **Allow … answers** 默认关闭。这个按钮名称应直接复用当前
   下拉框中显示的 provider 名称，例如 **Allow Ollama Cloud answers**。此时在
   Home 输入一个真实问题，例如：

```text
@Summarise my private project notes.
```

预期显示“先在 Settings → OMD Home → AI answers 启用当前 provider 的 Allow … answers”一类的显式提示，而不是 silent fallback。
6. 打开当前 provider 对应的 **Allow … answers**，重新提交同一个问题。预览 modal 应先显示 provider、model、
   destination、bounded evidence excerpts、取消按钮与发送按钮。
7. 先点 **Cancel**，确认没有发送 Vault evidence，也没有产生 result。准备下面这个可稳定命中
   单篇笔记的唯一短语问题：

   ```text
   @Using only the note with the phrase “amber lighthouse checklist”, what does the source explicitly say about the lighthouse review, and what is one cautious planning inference? Label the two parts.
   ```

8. 先提交一个确定无法命中测试素材的唯一乱码问题，例如
   `@zzqvnoevidence7391`。预期显示 **No relevant vault evidence was found. No model request was
   sent.**；不得打开 consent preview，也不得调用 Ollama Cloud。然后再提交第 7 步的单来源问题。
9. 预览中的 **Selected evidence** 必须显示 `1 source`，且只包含
   `Manual Test Notes/English Markdown Note.md`。点击 **Send and answer**。
   vault-relative path 只用于这一个本机 preview，帮助测试者识别来源；真正的 provider prompt
   只能包含问题、获批片段和 `[S1]` 这类不透明标签，不能包含 Vault 文件名或路径。
10. 成功结果必须满足：
   - header 显示 `1 source`，正文第一行准确显示 **Based on 1 retrieved note.**；
   - 不得写成 “the Vault contains …”“all Vault notes …”或以其他方式暗示覆盖整个 Vault；
   - 正文中的 **Source states:** 与 **Model inference:** 各出现一次，按此顺序排列；
     不显示 provider 返回的原始 JSON、`source_states` / `model_inference` 字段名或重复标题；
   - **Source states:** 写出原文明确说明的 Thursday 10:30 和 owner Morgan；
     **Model inference:** 给出题目要求的一条审慎规划推论，并使用 “may / suggests” 等审慎表达。
     若题目没有要求推论且证据不足，允许显示 **Model inference:** 下的 **None.**，但本题不能
     用 **None.** 代替所要求的推论；
   - 每个实质性事实、列表项和推论都紧邻至少一个本次批准来源的 wiki-link 引用；
     只有末尾 source chips 或总 `Sources:` 列表不算逐结论引用；
   - 不得出现 `[S1]`、`[E1]` 等内部 placeholder。
11. 点击 **Copy result**，确认复制结果同样保留单来源范围句、逐结论引用和去重后的 `Sources:`。
12. 如果 **Keyword + semantic search** 因已保存但未安装的 `bge-m3` 降级，结果仍应成功并显示：
    **The selected embedding model is not installed in Ollama, so this answer used keyword search only.**
    同一 warning 下应有 **Install model**、**Switch to keyword search**、**Open retrieval settings**：
    - 本阶段只确认 **Install model** 存在，不要点击；页面加载、Check setup 和提问均不得自动下载；
      保持 `bge-m3` 未安装，供 AI-04 D 的“未安装”分支复测，实际安装留到 AI-09；
    - **Switch to keyword search** 应关闭 **Keyword + semantic search** 并保存此选择，影响之后的问题；
    - **Open retrieval settings** 应打开
      **Settings → OMD Home → AI answers → Advanced AI controls → Vault retrieval**，
      并定位到 **Embedding model**。
13. 检查错误详情、Needs attention、Notice 和 Console：不得泄漏 evidence excerpt、凭证、
    request body 或不必要的绝对路径，也不得跨 provider fallback。

若第 9 步发送后出现 **did not cite every claim**、**did not separate Source states from Model inference**
或 **did not provide the required Source states / Model inference structure**，本次应记为
`FAIL: grounded answer contract`，而不是 Cloud 连接或 embedding 降级通过。未经验证的正文不得显示；
插件也不得自动重发。重试必须重新提交问题、检查新的逐题 preview 并再次点击 **Send and answer**。

通过条件：Ollama Cloud 逐题 preview/批准边界成立；单来源答案明确限定为 retrieved note；
每个关键结论有来源；原文陈述与模型归纳明确分开；embedding 不可用时安全降级为 **Keyword search**，
而不是把整次云端回答标记为失败。

<a id="test-ai-04"></a>

### AI-04：OpenAI、Anthropic 与 DeepSeek 设置入口

对 **OpenAI API**、**Anthropic API**、**DeepSeek API** 逐一执行。没有真实 developer key 时，
完成 A，以及 C 第 1 步的 Allow 关闭前置阻止测试；B、C 第 2 步以后、D/E 和 provider 网络错误
分支记为 `NOT RUN`。不得把缺少 key 误记为缺少 answer model，也不得在没有 key/model 时期待
preview 出现。

#### A. 无 key 与设置文案

1. 打开 **Settings → OMD Home → AI answers**，在 **Answer provider** 下拉框选择 provider。
   `provider` 不是另一个菜单或页面。
2. 在 **Answer provider** 正下方找到独立的 **Request destination** 行，并确认固定值：
   - OpenAI API：`api.openai.com`
   - Anthropic API：`api.anthropic.com`
   - DeepSeek API：`api.deepseek.com`
   说明必须写明只有逐题 preview 中显示的问题和 evidence excerpts 才可能发送。
3. 未提供 key 时，**Answer model** 应 disabled，并显示 **Add developer key first**；不得先显示
   **Choose an answer model**。
4. 点击 **Check setup**。应显示 credential missing，并说明检查不会读取 Vault 内容；
   不得请求 model catalog，也不得回退到其他 provider。
5. 为单独验证执行顺序，暂时打开当前 provider 的 **Allow … answers**，在 Home 提交
   `@What is in my vault?`。应先提示在
   **Settings → OMD Home → AI answers** 添加 developer API key；不得显示 model missing，
   不得执行 Vault retrieval，也不得打开发送预览。完成后恢复 Allow 开关。

#### B. 提供并验证 developer key

只执行与当前测试平台对应的路径。三个 provider 的变量分别是 `OPENAI_API_KEY`、
`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`。

**macOS Keychain 路径**

1. 在 **Developer key** 的 password 输入框直接粘贴有效测试 key，输入应默认遮蔽；这里接受的是
   真正的 API key，不是 Obsidian SecretStorage 的条目名称或下拉选择。点击 **Save & check**。
2. 输入框必须清空，状态明确写出 **macOS Keychain**，并出现 **Remove key**。同一次操作必须立即
   执行 provider setup check：有可用 credential 时加载真实 model catalog；尚未选择 model 时提示
   选择 model，而不是要求用户再寻找或记住另一个 **Check setup** 按钮。保存失败时不得继续检查。
3. key 不得出现在 Notice、Console、Needs attention 或
   `test-vault/.obsidian/plugins/omd-home/data.json`。

   不要用 `cat data.json`，也不要运行会输出 key 的 `security ... -w`。可用以下只输出字段名
   或 PASS/FAIL 的方式核验当前 test-vault：

   ```bash
   OMD_HOME_DATA_FILE="/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/data.json"

   jq -r 'paths(scalars) as $p | $p | map(tostring) | join(".")' "$OMD_HOME_DATA_FILE" \
     | rg -i 'api.?key|secret|token|credential|authorization' \
     || echo "PASS: no secret-like setting names"

   if rg -qi 'sk-(proj-|ant-)?[A-Za-z0-9_-]{12,}|OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|Bearer[[:space:]]+[A-Za-z0-9._-]+' "$OMD_HOME_DATA_FILE"; then
     echo "FAIL: possible credential material in data.json"
   else
     echo "PASS: no known credential pattern in data.json"
   fi
   ```

   在 macOS 只验证 Keychain entry 存在，不读取其值：

   ```bash
   security find-generic-password -s "omd/openai/api-key" -a "OPENAI_API_KEY" >/dev/null \
     && echo "PASS: OpenAI key is in macOS Keychain"
   ```

   Anthropic 和 DeepSeek 分别替换为
   `omd/anthropic/api-key` / `ANTHROPIC_API_KEY` 与
   `omd/deepseek/api-key` / `DEEPSEEK_API_KEY`。
4. 若 **Save & check** 后还未选 model，应已加载 model catalog 并提示选择 model。
5. 选择 model 后点击 **Check setup**。成功信息应显示 provider、model、destination，并明确说明这一步只是在验证
   credential 与 model catalog；真正发送 Vault 问题仍然要回到 Home，显式打开云端答案，并经过 preview
   与逐题确认。

**Windows/Linux 环境变量路径**

1. 确认 Settings 不显示 secret input、**Save & check** 或 **Remove key**，而是显示当前 provider
   的准确环境变量名称。
2. 完全退出 Obsidian。在启动 Obsidian 的同一用户环境中设置对应变量，再重新打开 Obsidian。
   Linux 临时测试可在一个新的 Terminal 中运行以下命令；输入不会写入 shell history：

```bash
read -rsp "Provider API key: " OMD_HOME_TEST_KEY
export OPENAI_API_KEY="$OMD_HOME_TEST_KEY"  # 按 provider 更换变量名
obsidian
```

   Windows 可在 **System Properties → Environment Variables → User variables** 新建对应变量，
   然后完全退出并重新打开 Obsidian。测试后删除该测试变量并重启 Obsidian。
3. 回到 Settings，确认 Developer key 状态写明来自该环境变量，再执行两次 **Check setup**：
   第一次加载 catalog，选择 model 后第二次验证。

两条平台路径都要检查：如 provider 返回空 catalog、权限错误、rate limit 或网络错误，记录
HTTP 类别即可；UI 不得显示 key、Authorization header 或 request body。

#### C. 云回答 preview、答案范围与 billing 边界

1. 使用已通过 B 的 key 和 model。先关闭当前 provider 的 **Allow … answers**，在 Home 提交问题；
   应在 retrieval 前提示启用当前 provider，不得 silent fallback。
2. 打开 Allow 后，先提交唯一乱码问题 `@zzqvnoevidence7391`。必须显示
   **No relevant vault evidence was found. No model request was sent.**；不得打开 preview、消耗
   provider 请求或 fallback。然后提交 AI-03 的 `amber lighthouse checklist` 单来源问题。
   预览必须显示当前
   provider、model、固定 destination、`1 source` 及完整的本次有界 evidence excerpts。
   预览中显示的 vault-relative path 只是本机给用户核对的标签；发给 provider 的 prompt 使用
   不透明 source ID，OMD Home 不会额外附加来源文件名或路径。预览中的正文片段会原样发送，因此
   如果笔记正文自己写有名称或路径，它仍属于用户本次批准发送的 excerpt；确认窗必须准确说明这一点。
3. 先取消一次，确认不发送；再次提交并批准。在 preview 打开后改名或修改命中的来源，再尝试
   批准时必须判定 consent 已失效并要求重新 preview，不能用旧批准发送不同的来源身份或内容。
4. 成功结果必须重复满足 AI-03 的结果合同：
   - **Based on 1 retrieved note.**
   - 每个关键事实或推论均有本次批准来源的 wiki-link 引用；
   - **Source states:** 与 **Model inference:** 各出现一次且顺序固定；不显示原始 JSON 或内部
     `[S1]` / `[E1]` 标签。Thursday 10:30、Morgan 属于原文事实；审慎安排建议属于模型推论；
   - 不暗示检索或阅读了整个 Vault；
   - provider/model、sources、retrieval mode 和 elapsed time 正确。
5. 确认 UI 没有暗示 ChatGPT Plus/Pro 或 Claude consumer subscription 包含 API 额度。
6. provider 返回错误时必须显示安全、可行动的类别：400 为 request/model compatibility，
   401 为 key rejected，403 为 access denied，429 为 rate/quota，5xx 为 provider temporary
   failure，timeout/transport 为 network failure；provider 返回结构化 `credentials_invalid` 时也必须
   明确显示 key 被拒绝并要求替换，不能误报 model catalog unavailable。只有 bridge process 本身无法启动或解析时才可显示
   **OMD Home bridge failed**；任何错误都不得显示 key、Authorization header、response body
   或 evidence excerpt。若 Keychain entry 仍存在但 provider 已撤销或拒绝该 key，预期是 **key rejected**；
   这只通过本条 401 分支。若在插件内点击 **Remove key**，预期应是 **credential missing**，属于 E，
   两者不可互相代替。

**2026-09-14 已观察到的模型兼容性失败**：测试者选择 OpenAI API / `gpt-4` 后，实际回答请求返回
HTTP 400；换成同一 provider 的 `gpt-4o-mini` 后可收到有来源引用的回答。当前 provider catalog
仅证明模型 ID 可见，不能证明该模型支持本插件要求的严格结构化答案。`gpt-4` 的这个失败记录为
**FAIL：Answer model eligibility / Check setup 未在发送前拦截不兼容模型**，不是 key 或本地 embedding
失败；详见 [ANSWER-02](ui-backlog.md#answer-02openai-模型可见不等于支持结构化回答)。
修复后用模拟 provider 请求验证 `gpt-4` 在预览/发送前得到清楚提示，再用真实目录中有权限的
`gpt-4o-mini` 完成一次经用户批准的合成笔记问答；不得静默切换模型或绕过逐题 preview。

**OpenAI `o3-mini` 回归**

7. 仅当真实 OpenAI catalog 返回 `o3-mini` 且测试 key 有权使用时，选择 `o3-mini` 并重新
   **Check setup**；否则明确记为 `NOT RUN`，不要用相似名称冒充。
8. 提交上述单来源问题，检查 preview 后点击 **Send and answer**。请求必须成功返回
   OpenAI / `o3-mini` 结果，不得因发送不受支持的 temperature 参数而返回 HTTP 400，也不得退化成
   **OMD Home bridge failed**。人工测试不要求查看 raw HTTP request：确认结果元数据确实为
   **OpenAI API / `o3-mini`**，且请求成功返回、没有 HTTP 400，即通过真实网络回归。还可在 repo 根目录
   运行以下定向自动测试，直接验证 OpenAI task 的 `temperature` 为 `null`（序列化时省略），其他
   provider 仍为 `0`：

   ```bash
   node --test --experimental-strip-types \
     --test-name-pattern='hosted OpenAI tasks omit temperature' \
     tests/omd-bridge.test.ts
   ```

   预期匹配用例为 `pass`；同一文件中其他不匹配用例显示 `skipped` 是正常现象。

<a id="test-ai-04-structured"></a>

**结构化答案与失败分类回归（各 provider 共用）**

1. 检查本节 C 第 4 步已有的成功结果，不必为此额外付费发送：两段标题由 OMD Home 固定生成，
   各结论旁有来源引用；复制结果也应保持相同分区和引用。引用指向获批来源并不自动证明结论受
   原文支持，仍须人工核对 Thursday 10:30、Morgan 及推论的证据关系。
2. 正常 provider 不一定能稳定制造坏 JSON 或漏引用；不要通过反复发送真实 Vault 内容来碰运气。
   在 repo 根目录运行以下受控回归，使用模拟响应，不读取 Vault，也不调用云 API：

   ```bash
   node --test --experimental-strip-types \
     --test-name-pattern='AI tasks request a bounded structured answer|structured AI answers render fixed sections and reject unverified citations|OmdBridge rejects malformed or ungrounded AI answers before they reach the UI|maps hosted provider failures to safe actionable messages' \
     tests/omd-bridge.test.ts
   ```

   预期匹配的 `4` 个用例均为 `pass`；不同 Node 版本可能省略其他用例或将其标为 `skipped`。
   依次核对：provider task
   请求包含结构化 schema；缺失/错误结构或空白 claim 被拒绝且不回显原始模型正文；缺失、无效或
   不属于本次检索的引用被拒绝；格式错误和引用错误在结果区得到不同的安全提示。
3. 错误归类应准确：缺少或无效引用提示 **did not cite every claim**；受控测试中 bridge 报告
   分区校验 warning 时提示 **did not separate Source states from Model inference**；provider 未返回可解析的
   结构化结果提示 **did not provide the required Source states / Model inference structure**。
   三者都不能展示未经验证的正文，也不能变成笼统的 **OMD Home bridge failed**。如果真实请求
   偶发命中其中一类，记录 provider/model 与类别；重新发送前必须重新 preview 和确认。

#### D. Hosted answer 时的本地 embedding 降级

本节验证的是：Hosted provider 继续负责生成答案；本机 Ollama 只负责可选的 embedding。
因此 embedding 失败时，检索应退回 **Keyword search**，不能把整个云回答标记为失败。
Hosted provider 返回结构化的原文事实与审慎推论；OMD Home 将其呈现为固定的
**Source states:** / **Model inference:** 两段，并在显示前校验每项引用。D1/D2 只有在
**答案正文与 Keyword search 降级诊断同时可见**时才通过；仅看到 preview 或降级 warning 不算通过。

**固定测试例子与前置状态**

1. 选择一个已通过 C 的直连 hosted provider，例如 **OpenAI API / `o3-mini`**，保持该 provider
   的 **Allow … answers** 已开启。Anthropic API 或 DeepSeek API 也可以，但下列步骤必须始终使用
   同一个 provider/model。
2. **本节不要使用 Ollama Cloud 作为 answer provider**。停止 Ollama daemon 会同时让 Ollama Cloud
   provider 不可用，无法隔离验证“云回答正常、只有本地 embedding 降级”。
3. 确认以下 fixture 仍存在：
   `Manual Test Notes/English Markdown Note.md`。所有手工分支都提交同一个稳定的单来源问题：

   ```text
   @Using only the note with the phrase “amber lighthouse checklist”, what does the source explicitly say about the lighthouse review, and what is one cautious planning inference? Label the two parts.
   ```

4. 在 **Settings → OMD Home → AI answers → Advanced AI controls → Vault retrieval**：
   - 开启 **Keyword + semantic search**；
   - **Embedding model** 选择 `bge-m3`；
   - 关闭 **Semantic rerank**，以便只观察 embedding-to-keyword 降级；
   - 本节不要点击 **Install model**，实际安装留到 AI-09。

**D1. `bge-m3` 未安装（手工 Core）**

1. 在 Terminal 运行 `ollama list`，确认输出中没有 `bge-m3`；Settings 中应显示
   `bge-m3 (saved, not installed)`。如果它已经安装，不要为了本测试删除用户模型；本分支记为
   `NOT RUN: bge-m3 already installed`，继续 D2。
2. 提交上面的固定问题。即使 embedding 预检查失败，仍应打开逐题 preview；确认显示当前 hosted
   provider/model、`api.openai.com`（或当前 provider 的准确 destination）、`1 source`，且证据只来自
   `Manual Test Notes/English Markdown Note.md`。
3. 点击 **Send and answer**。预期云回答成功，而不是 **OMD Home bridge failed**、provider 被切换，
   或再次要求选择 answer model。
4. 结果必须同时满足：
   - header 仍显示测试开始时选择的 hosted provider/model 和 `1 source`；
   - retrieval badge 显示 **Keyword search**，不能显示 **Keyword + semantic search · bge-m3**；
   - 正文以 **Based on 1 retrieved note.** 开头；**Source states:** 写出原文明确说明的
     Thursday 10:30 与 owner Morgan，**Model inference:** 给出有标签的审慎安排建议；
     两段的每项关键结论都有这篇笔记的引用，不得只在末尾统一列来源；
   - warning 精确显示：**The selected embedding model is not installed in Ollama, so this answer used keyword search only.**
   - warning 下只显示 **Install model**、**Switch to keyword search**、**Open retrieval settings** 三个动作；
   - 没有自动下载模型、自动重新发送、自动切换 provider 或把 `bge-m3` 当 answer model。
5. 先点击 **Open retrieval settings**，预期直接打开 AI answers、展开 Advanced AI controls，并定位到
   **Embedding model**。返回结果后点击 **Switch to keyword search**，预期按钮变为
   **Keyword search selected**，且 **Keyword + semantic search** 被关闭并保存。为了继续 D2，
   随后手动重新开启 **Keyword + semantic search**，仍选择 `bge-m3`。

**D2. Ollama daemon 不可达（手工 Core）**

1. 保持同一个直连 hosted provider、answer model 和 Allow 开关。确认 **Keyword + semantic search** 已重新开启、embedding
   model 仍为 `bge-m3`。
2. 按 [AI-02 第 2 步](#test-ai-02)停止 Ollama：从菜单选择 **Quit Ollama**；若 daemon 仍在运行，在 Activity
   Monitor 中只退出 `Ollama` / `ollama` 相关进程。运行：

   ```bash
   curl -sS --max-time 2 http://localhost:11434/api/status
   ```

   只有显示 connection refused/failed 才继续；如果仍返回 JSON，本分支的前置状态尚未建立。
3. 再次提交固定问题，检查 `1 source` preview 后点击 **Send and answer**。
4. 结果必须同时满足：
   - hosted provider 的答案仍成功返回，provider/model 没有改变；
   - retrieval badge 为 **Keyword search**；
   - 正文满足 D1 的单来源、两段标签与逐项引用要求；
   - warning 精确显示：**The local Ollama service could not be reached, so this answer used keyword search only.**
   - warning 下只显示 **Switch to keyword search** 与 **Open retrieval settings**；绝对不能显示 **Install model**；
   - 不得误报 `bge-m3` 未安装、developer key 无效或整个 bridge failed。
5. 测试后立即重新打开 Ollama，等待下面命令重新返回 JSON，再继续其他案例：

   ```bash
   curl -sS --max-time 2 http://localhost:11434/api/status
   ```

**2026-09-14 人工反馈记录（D2 替代问题）**：使用 **OpenAI API / `gpt-4o-mini`**
询问 `Sources/PDFs/Presentation - Deep Learning in Nematode Detection.md`，已收到以
**Based on 1 retrieved note.** 开头的回答；`Source states:` 的各项结论均带该笔记的逐项引用，
`Model inference:` 为 `None`。测试者报告 hosted provider/model 保持不变、badge 为
**Keyword search**，warning 准确为 **The local Ollama service could not be reached, so this answer used
keyword search only.**，且只有 **Switch to keyword search** 与 **Open retrieval settings**，没有
**Install model**、missing-model、key 或 bridge 错误。**D2 的 hosted-answer/本地 embedding
故障隔离变体：PASS（依据测试者反馈；未独立核对 UI 截图或 daemon 停止命令）。**
这次并非上方固定的 `amber lighthouse checklist` 问题，且没有需要审慎推论的回答，因此
**固定题 D2 仍待执行**；须使用固定问题并核对 Thursday 10:30、Morgan、审慎建议和每项引用，
才能将完整 D2 标为 PASS。不要把这条记录当成 `bge-m3` 的语义检索成功证明。

**D3. 已安装模型不支持 embedding（自动化；手工 `NOT RUN`）**

正常 dropdown 会过滤或禁用 completion-only model。手工测试不要编辑 `data.json`、不要把
`qwen3:4b-instruct` 强塞进 embedding setting。把本分支记录为
`NOT RUN: requires controlled incompatible-model injection`，然后在 repo 根目录运行：

```bash
node --test --experimental-strip-types \
  --test-name-pattern='selected_model_incompatible|hybrid_retrieval_model_unsupported' \
  tests/main-runtime-regressions.test.ts
```

预期 `2 pass`：一个用例验证预检查把 `selected_model_incompatible` 分类为 embedding unsupported
并关闭本次语义检索；另一个验证结果 warning 使用 **does not support embeddings**，且只提供
**Switch to keyword search**、**Open retrieval settings**，不提供 **Install model**。

**D4. daemon 可达，但 catalog/model inspection 失败（自动化；手工 `NOT RUN`）**

这需要让 `/api/status` 成功，同时只让 `/api/tags` 或 `/api/show` 返回受控错误。普通手工环境不要
代理或篡改 Ollama 响应；记录为 `NOT RUN: requires controlled catalog/show failure injection`，运行：

```bash
node --test --experimental-strip-types \
  --test-name-pattern='reachable Ollama catalog fails|reachable Ollama model inspection fails' \
  tests/main-runtime-regressions.test.ts
```

预期 `2 pass`：catalog failure 与 model-inspection failure 都归类为
**The embedding check could not finish, so this answer used keyword search only.**，而不是 daemon
unreachable 或 model not installed；恢复动作只有 **Switch to keyword search** 与 **Open retrieval settings**。

**与 embedding 降级独立的答案校验失败**：如果 D1/D2 发送后出现缺少引用、
分区格式错误或结构化答案无效等 grounded-answer 错误，记录本次为
`FAIL: grounded answer contract`，附上 provider/model、错误类别及是否显示 Keyword search 诊断；
**不得**把它记为 embedding 降级通过，也不要推断这次回答来自本地模型。未经校验的回答不应展示。
插件不得自动再次发送；若要重试，重新提交同一问题、检查新的 evidence preview，
再亲自点击 **Send and answer**。重试成功也要保留第一次失败记录，以便追踪间歇性问题。
三类错误的准确提示及无需真实 API 的复现步骤见上方 **结构化答案与失败分类回归**；不要把
“标题正确但模型没有返回问题所要求的推论”记为通过。

| 分支 | 回答是否成功 | Retrieval | 必须出现的动作 | 禁止出现 |
| --- | --- | --- | --- | --- |
| D1 未安装 | 是 | Keyword search | Install model / Switch to keyword search / Open retrieval settings | 自动下载、provider 切换 |
| D2 daemon 不可达 | 是 | Keyword search | Switch to keyword search / Open retrieval settings | Install model、model-not-installed 误报 |
| D3 不支持 embedding | 自动化验证 | Keyword search | Switch to keyword search / Open retrieval settings | Install model |
| D4 catalog/show 失败 | 自动化验证 | Keyword search | Switch to keyword search / Open retrieval settings | Install model、daemon-unreachable 误报 |

通过条件：D1、D2 的答案及 Keyword search 诊断同时满足各自全部预期；D3、D4 的定向自动测试各 `2 pass`；四个分支都不
自动切换 provider、不自动发送第二次请求，且 **Install model** 只出现在确知模型未安装的 D1。

#### E. 最后移除或撤销 key

必须在 C/D 的 preview、真实发送和 embedding 降级都完成后才执行，避免提前删 key 使后续步骤
无法测试。

1. macOS Keychain 路径点击 **Remove key**，再点 **Check setup**，应回到 credential missing。
2. Windows/Linux 环境变量路径不能由插件删除。完全退出 Obsidian，删除环境变量，重新打开后
   点 **Check setup**，应回到 credential missing。
3. UI 必须准确说明 key 来源，不能在环境变量路径上假装已经保存或能够删除凭证。

通过条件：credentials 不写入插件设置；macOS 只通过 Keychain 提供 in-app Save/Remove；
Windows/Linux 只显示环境变量路径；credential → model → retrieval → preview → send 的顺序成立；
hosted 答案具备准确范围、逐结论引用和 provenance；三类 embedding 原因不互相混淆；错误安全、
可行动且不泄漏 secrets。

<a id="test-ai-05"></a>

### AI-05：Provider 切换、每个 provider 的 model 记忆与本地工作流隔离

1. 为至少三个 provider 分别选择不同 model ID。
2. 按 `Ollama on this computer → OpenAI API → Anthropic API → Ollama Cloud → Ollama on this computer`
   切换，再确认每个 provider 恢复自己的 model，不把一个 provider 的 ID 带到另一个。
3. 在 hosted provider 下展开 **Advanced AI controls**。确认：
   - **Keyword + semantic search** 与 embedding model 仍明确标注为本地；
   - Local writing model 仍然是单一共享模型，Review links and tags 与 Polish Markdown 只是在不同动作中使用它；
   - Answer provider 不会改变 capture/enrichment 的 provider。
4. 在 hosted provider 选中时运行一次 **Suggest links and tags** 或 **Polish Markdown**。若未显式
   启用云端答案，这些本地动作仍应走 loopback Ollama；Answer provider 本身不应重定向本地写入
   工作流。
5. Reload plugin 后重复步骤 2，确认 model memory 持久化，但 API key 不在 `data.json`。

通过条件：没有跨 provider model 污染、fallback 或隐藏 egress；回答 provider 与本地
capture/enrichment 的职责边界清楚。

<a id="test-ai-06"></a>

### AI-06：Command Palette 诊断、后台任务与 Cancel

前置：选择 **Ollama on this computer**。如果你正在验证 Ollama daemon 的 local-only 政策，
再额外完成 AI-02 的可选步骤；普通本地测试不需要把 Cloud 关回去。

1. Command Palette 依次运行：
   - **OMD Home: Refresh local AI models**
   - **OMD Home: Check local AI connection**
   - **OMD Home: Smoke local AI: Vault question**
   - **OMD Home: Smoke local AI: Note enrichment**
   - **OMD Home: Smoke local AI: Polish Markdown**
   - **OMD Home: Test local AI embeddings**
   - **OMD Home: Start or stop recording**
2. Smoke 只发送 synthetic prompt，不读取或写入 Vault。记录每项 latency 和结果。
3. 启动较慢的 Smoke 或 embedding test，切离 Settings 并关闭 OMD Home tab，但不要 disable
   plugin。任务应继续，由 plugin-level state 持有。
4. 重开 Home 或 Settings，确认任务完成或仍显示运行状态。
5. 再启动一个任务；只有任务仍可取消时才应显示 **Cancel**，点击后任务停止。若 capture 已由
   OMD 保存、只剩 Inbox/indexing 收尾，Current task 可以继续显示 active，但 **Cancel** 应消失，
   不能留下一个点击后无作用的按钮。
6. 在任务进行中修改 provider、endpoint 或 model。旧 tuple 的完成结果不得覆盖新设置。
7. 最后在 Community plugins disable/reload OMD Home；运行中的 request/child process 必须取消。

通过条件：低频诊断不占据主设置页；后台切 tab 不取消；显式 Cancel 与 unload 会取消；无未处理
Promise rejection 或僵尸进程。

<a id="test-ai-07"></a>

### AI-07：本地 Omnibox 结果、证据、复制与返回用时

1. 选择 **Ollama on this computer**，使用已通过 AI-02 的 text model。
2. Python executable 与 bridge override 都留空。
3. 先输入唯一乱码问题 `@zzqvnoevidence7391`。预期显示
   **No relevant vault evidence was found. No model request was sent.**；不得调用本地 completion
   model，也不得留下空的 result shell。
4. 在 Home 输入：
   `@Who owns the lighthouse review, and when is it scheduled?`
   预期 **Source states:** 回答 Morgan、Thursday 10:30，并逐项引用
   `[[Manual Test Notes/English Markdown Note.md]]`；题目未要求推论时，**Model inference:** 可以为
   **None.**，不得编造额外计划。
   再输入：
   `@中文测试笔记里谁负责检查阳台番茄，什么时候检查？`
   预期 **Source states:** 回答小林、周五下午三点，并逐项引用
   `[[Manual Test Notes/中文 Markdown 测试笔记.md]]`。
5. 确认回答出现在独立结果区域，不与 Home widgets 重叠。
6. Header 显示 provider/model、source 数、**Keyword search** 或 **Keyword + semantic search**，以及 **Returned in …**。
7. 点击 **Copy result**，粘贴到临时 Markdown 笔记。
8. 复制内容应包含固定顺序、各出现一次的 **Source states:** / **Model inference:**、完整回答
   与去重后的 `Sources:`；来源使用 Obsidian wiki links，不含原始 JSON 或 `[S1]` / `[E1]`。
9. Copy 按钮短暂变成 **Copied**；键盘也能触发。
10. 滚动长结果，切换 light/dark theme，再关闭结果；widgets 应自然回流。
11. 重复一次问题，确认不存在 `[S#]` 或 `[E#]` placeholder。

通过条件：Copy 不修改原笔记；时间从用户提交问题开始计算到最终结果；中文及含空格路径可
准确恢复；每个实质性结论有邻近来源引用且原文事实/模型推论不混写。结构或引用不合格时不显示
未经验证的正文，错误显示在结果区并同步到带时间戳的 Needs attention；失败分类复现见
[AI-04 的结构化答案回归](#test-ai-04-structured)。

<a id="test-ai-08"></a>

### AI-08：新的 Section-aware Vault Q&A benchmark

这些 fixtures 是原创 synthetic Markdown，不依赖旧的 bouldering captures。当前推荐使用新的
Phase 2 set 来验证 settings-aware retrieval 与 source hygiene。先从源码目录执行：

```bash
cd "/Volumes/Transcend_q/APPS/AI/omd-home"
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark"
cp "docs/benchmark-vault/Sources/Benchmark/OMD Home Phase 2 Answer Rules.md" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Sources/Benchmark/OMD Home Cloud Setup Checklist.md" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Sources/Benchmark/OMD Home Release Checklist.md" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
```

确认三个文件出现在 Vault。前两篇是 ground truth；release checklist 是 distractor。评分细则
位于 `docs/benchmark-vault/benchmark-cases.md`。

选择本地 provider，依次运行：

1. **P01**，连续三次：
   `@What stays local in the Phase 2 answer flow, even for cloud providers?`
   必须回答 retrieval、source selection、local writing tools stay local，cloud answers 仍需 preview。
2. **P02**：
   `@What is the exact Ollama Cloud setup sequence before a cloud answer can be sent?`
3. **P03**：
   `@Which actions share the local writing model, and how are they different?`
4. **P04**：
   `@What should the recording command surface say, and what should it avoid guessing?`
5. **P05**：
   `@Summarise the phase 2 answer flow in one paragraph, using only the two primary notes.`
6. 每次记录：回答、Copy result、sources、retrieval mode、warnings、elapsed time、4 分制得分。
   所有非空答案均应由固定的 **Source states:** / **Model inference:** 两段组成，每个关键
   事实、行动、比较或推论旁都有对应 primary note 引用；推论不能伪装成原文事实。P01、P02、P05
   若没有合理推论，**Model inference:** 可以为 **None.**。查看 Copy result 时也要核对分区和引用。
7. P01/P02/P03/P04 必须 4/4；P05 至少 3/4。任何 distractor citation、编造 cloud 发送路径、
   缺少逐结论引用、分区错误或 `[S#]` / `[E#]` placeholder 泄漏都是 release blocker。

通过条件：section evidence 不退化成 title-only；计数、分类、overlap 与 abstention 正确；
sources 精确且不包含 distractors。

<a id="test-ai-09"></a>

### AI-09：Multilingual hybrid retrieval 与 semantic rerank

先从源码目录导入 legacy tomato fixtures；AI-08 的三篇 Phase 2 fixtures 不需要删除：

```bash
cd "/Volumes/Transcend_q/APPS/AI/omd-home"
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark"
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Calendar/Events"
cp "docs/benchmark-vault/Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md" \
   "docs/benchmark-vault/Sources/Benchmark/阳台番茄新手常见三个错误.md" \
   "docs/benchmark-vault/Sources/Benchmark/Hydroponic Lettuce Yield Log.md" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Calendar/Events/2026-09-18-garden-swap.md" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Calendar/Events/"
```

确认共 4 篇 legacy fixtures 出现在 Vault。前两篇 tomato notes 是 ground truth；lettuce 与
calendar event 是 distractors。准确答案和评分位于 `docs/benchmark-vault/benchmark-cases.md`。

1. 先确认已保存的推荐 embedding model `bge-m3` 尚未下载时，**Vault retrieval** 中显示为
   missing/unavailable，而不是 Ready 或可直接运行。界面必须在该模型附近提供 **Install model**。
   页面加载、**Check setup** 和提问都不得自动下载；只有测试者明确点击 **Install model** 后，
   插件才可调用本地 Ollama pull，并应显示 installing、success 或准确的 failure 状态。
   如果要验证手动替代路径，不点按钮，改在 Terminal 运行：

   ```bash
   ollama pull bge-m3
   ```

   两条路径二选一，不要同时运行。等待完成并重新打开/刷新本地模型状态。
2. 命令完成后点击 **Check setup**，确认 `bge-m3` 在 **Answer model** 下拉中作为禁用的 embedding
   model 可见，而不能被选作回答模型；在 **Embedding model** 中则可选择。也可以用 Command
   Palette 运行 **OMD Home: Refresh local AI models**；除明确点击 **Install model** 外，插件不得
   自行 pull。
3. 在 **Advanced AI controls → Vault retrieval** 开启 **Keyword + semantic search**，Embedding model
选择 `bge-m3`，先关闭 **Semantic rerank**，点击 **Test embeddings**。
   点击后 **Advanced AI controls** disclosure 必须仍保持展开，以便直接看到 embedding model、
   Test embeddings 结果和相邻的 readiness/error 状态。
4. 测试必须返回同维度且大于 0 的 vectors；不得因 Test embeddings 自动 pull、接受 remote-backed model 或把
   vector 写进 note/frontmatter。
5. 连续三次运行 **D01**：
   `@这些阳台番茄笔记给新手哪些建议？`
6. 运行 **M01**：
   `@Summarise the tomato mistakes in Chinese, then restate the fixes in English.`
7. 每次应命中相应 tomato notes，不引用 lettuce/calendar；header 显示
**Keyword + semantic search · bge-m3**。
8. 开启 **Semantic rerank**，重复 D01，并直接运行 B04：
   `@Which recommendations overlap across both tomato notes? Cite each overlap.`
   顺序可变，但不得引入 distractor、移除正确 overlap evidence，或把单篇来源内容伪装成两篇
   都明确支持的 overlap。成功答案仍须使用固定的 **Source states:** / **Model inference:**；
   B04 的每项明确交集须引用两篇 tomato notes，不能只在末尾列出 sources。若只是模型推测的
   相似点，应放在 **Model inference:** 并以审慎措辞说明，不能写成双方原文都确认的交集。
9. 关闭 **Keyword + semantic search**，再问 D01。Header 应显示 **Keyword search** 且不发 embedding request；之后恢复。
10. 可选：暂时让 embedding model unavailable。回答应降级为 **Keyword search**，并按准确原因显示 warning：
    未安装时提供 **Install model**、**Switch to keyword search**、**Open retrieval settings**；daemon 不可达或
    model 不支持 embedding 时只提供后两个动作，不得错误建议安装。恢复 model 后再次
    **Test embeddings**，并确认 Advanced AI controls 仍展开。
11. 修改一篇 fixture 后重问，再撤销测试修改。已变更 note 应重新 embedding，未变更 note 可复用
cache；query embedding 不持久化。

通过条件：embedding traffic 只到默认 loopback Ollama；cache 在 Vault 笔记之外并按 model
digest 隔离；除明确点击 **Install model** 外不自动下载；按钮安装与手动 `ollama pull bge-m3`
都可被验证且不会并发重复；Test embeddings 后 Advanced disclosure 保持展开；missing、daemon
unreachable、unsupported、timeout、malformed 或 dimension mismatch 都以相邻醒目状态安全降级为 Keyword search。

<a id="test-ai-10"></a>

### AI-10：Stale model、reload/unload 与故障恢复

1. 记录当前 provider 与每个 workflow model。
2. 选择一个可重新下载的测试 model，执行 `ollama rm <model-id>`。不要删除唯一且昂贵的模型。
3. 运行 Command Palette 的 **Refresh local AI models**，再点 **Check setup**。
4. 旧选择应显示 `saved, not listed` / missing；插件不得自动选替代 model。
5. 用 `ollama pull <model-id>` 恢复，并重新检查。
6. 分别制造一次：
   - OMD executable missing/old
   - bundled bridge override 被错误自定义路径覆盖
   - Ollama daemon unreachable
   - selected model missing
   - hosted provider credential missing
7. 每个错误都应给出不同、可执行的恢复提示与时间戳；修复后旧错误应清除，不在 Needs attention
重复出现。错误/ready 状态必须紧贴受影响的 provider、model 或 endpoint 控件，而不是作为
描述文字中的 **Ready** / **Unchecked** 词汇；恢复配置后相邻错误立即清除。
8. 重载 plugin，确认 provider/model memory 仍在；进行中的网络 request 和 child process 已取消。
9. 保持 **OMD executable override** 为空并重新执行 CAP-02 的自动发现回归；旧候选故障恢复后，
   Capture 和紧接着的 enrichment 仍使用兼容的已解析 OMD。
10. 检查 Console，不得有 secret、Vault excerpt、未处理 rejection 或重复 interval/listener。

通过条件：恢复路径可完成；错误归属和时间清楚；reload/unload 后没有 stale ready state、僵尸
process 或跨 provider 反馈；Capture 后的 link/tag enrichment 不会把自动发现回退/切换到旧 OMD。

<a id="test-ai-11"></a>

### AI-11：Credential 状态、逐题证据与并发取消回归

在 AI-03/AI-04 的正常 provider 流程通过后执行。使用 synthetic fixtures；无真实 developer key
时，完成可用的本地、缺少凭证与取消分支，hosted 发送分支记录为 `NOT RUN`，不得记为 PASS。

1. 选择一个 hosted provider，等待 credential 状态加载结束。保持 Settings 打开 30 秒，再展开
   Advanced、滚动、切走并切回 provider。状态检查应在完成后停止：无持续 loading、重复进程、
   按钮闪烁或 Console 报错循环；成功或缺少凭证均不得触发无限 hydration/re-render。
2. 不点击 **Save & check**，在 provider A 的 **Developer key** 输入一个明确的非真实测试草稿，例如
   `not-a-real-key-a`。点击 **Check setup**，再切到 provider B 输入 `not-a-real-key-b`，最后切回 A；
   每次重绘后 password 输入仍应保留该 provider 自己的草稿，不能串到另一个 provider，也不能因
   hydration 或 Check setup 被清空。删除这些测试草稿，不要保存。之后如用真实测试 key 验证保存，
   只有 Keychain 明确确认成功后才清空刚提交且未被替换的输入；失败或较新的草稿必须保留。
3. 在 provider A 的 **Check setup** 或 **Save & check** 仍运行时切到 provider B。此时 B 的
   **Check setup**、credential 保存/删除、embedding 检查等共用 AI setup 动作必须清楚显示为
   busy/disabled，不能并行启动第二项。等待 A 完成后再执行 B 的检查。A 的迟到成功、失败或取消
   不得覆盖 B 的 model、credential 来源、反馈或按钮状态；回到 A 时不得显示属于 B 的 ready。
   若 provider/model 变更取消了正在运行的 Keychain 操作，所有 setup 控件必须保持 disabled，直到
   被取消的子进程真正结束；中间点击不得启动重叠的 Save、Remove 或 Check setup。
4. 发起较慢的本地诊断并取消，立即开启新检查；旧请求的 abort/收尾不得清除新任务或把新结果
   标为 cancelled。修改 provider/model 时也应取消失效任务，且不向另一个 provider 自动发送。
5. 连续提交两个本地问题：先提交一个预计较慢的 `@` 问题 Q1，在结果返回前立即提交不同的 Q2。
   最终结果区只能显示 Q2 的回答、来源与 elapsed time；Q1 必须被取消，不能在稍后覆盖 Q2，也不能
   在 **Needs attention** 留下 cancelled/status unavailable 等旧错误。再用普通 OMD 搜索作为 Q1、
   `@` 问题作为 Q2 重复一次，迟到的搜索不得清空或覆盖 Q2。
6. 用至少两个可检索的 synthetic notes 发起 hosted 问题。批准前确认 preview 显示准确的 question、
   provider、model、destination，以及**完整的本次已选有界证据片段**和 vault-relative source paths；
   不是只显示标题、source count、摘要或再次截短的片段。此处“完整”指将发送的选定片段，不是整篇笔记。
   path 仅在本机 preview 显示，provider prompt 必须以不透明 source ID 代替文件名。对照本轮
   synthetic 预览/测试请求记录，确认批准后的请求只使用该次批准的 question 和 evidence，
   不重新检索并替换为未预览的证据；来源 identity 或内容在 preview 后发生变化时旧 consent
   必须失效。不要在日志中保存真实凭证或私人正文。
7. hosted Q1 的 preview 保持打开时提交 Q2。Q1 preview 必须立即关闭或失效；只有 Q2 可以被批准
   和发送。然后分别用 **Cancel**、Escape 和关闭 modal 取消预览。每次都不得发送云请求；再次提问必须重新
   preview。更改 provider/model、撤销该 provider 的 Allow answers 或启动替代问题后，旧预览不能
   批准新设置的请求，也不能复用旧 consent。
8. 保持 preview 打开且尚未批准，disable/reload 插件；再重复一次并完全退出 Obsidian。待批准
   modal 应关闭或失效，等待中的 decision/request 应结束，不向云端发送，不留下 orphan task 或
   未处理 rejection。重新启用后新问题必须获得新的 preview 和明确批准。
9. 运行本地 `@` fixture 问题，在等待回答时依次输入 `+`、普通 capture 路径和 `>` command。
   每种切换都必须取消旧回答并收起空的 **OMD result** 壳；新的 capture/command 动作仍可正常完成。
10. 运行本地 `@` fixture 问题，在等待回答时只更改 **Recognition defaults** 中的 OCR/ASR 语言。
   问答应继续，不因仅影响 capture 的语言默认值被取消、失去 ready 或报缺少 OCR/ASR capability。
   更改后的默认值只在新 Capture 中生效；旧版 OMD 缺少可选 recognition override 能力时，仍可
   使用其已支持的 Q&A 功能。恢复默认语言后再次确认 Capture 使用新值。

通过条件：credential 状态无刷新循环；AI setup 动作不会重叠；provider 切换和 abort 只影响所属
请求；所有异步结果遵守 latest-submission-wins；云端发送严格绑定本次批准的证据；待批准时 unload
零发送；OCR/ASR 默认值不阻断无关 Vault Q&A。

## 7. Commands

<a id="test-cmd-01"></a>

### CMD-01：Obsidian core/community commands 与 Recorder

1. 在 Home 点击 **Commands**，搜索一个 Obsidian core command 并运行。
2. 启用一个提供无害 command 的 community plugin，再搜索运行。
3. 启用 Obsidian 自带 Recorder，reload OMD Home，并确认命令列表里有
   **OMD Home: Start or stop recording** 这个包装命令。
4. 确认有准确 toggle 时显示 Recording；只有 Start/Stop command 时分别显示，不猜测状态。
5. 在 omnibox 或 Command palette 搜索并运行：
   - **OMD Home: Refresh local AI models**
   - **OMD Home: Check local AI connection**
   - **OMD Home: Smoke local AI: Vault question**
   - **OMD Home: Smoke local AI: Note enrichment**
   - **OMD Home: Smoke local AI: Polish Markdown**
   - **OMD Home: Refresh macOS calendars**
   - **OMD Home: Start or stop recording**

通过条件：OMD Home 调用 Obsidian 已注册 command，不实现第二套 recorder；维护命令无需先打开
Settings，结果仍进入相应状态区。

## 8. Calendar / EventKit

### 共用前置条件与 helper 安装

1. 确认 macOS 14+ 与 Swift：

```bash
sw_vers
xcode-select -p
swift --version
```

2. 在源码目录构建 helper：

```bash
cd "/absolute/path/to/obsidian-omd-home"
npm run build:eventkit
./dist/omd-eventkit version
```

预期最后输出 `{"ok":true,"version":1}`。

3. 安装到仓库 test-vault：

```bash
npm run build
npm run install:test-vault
```

脚本只有在 helper 可执行时才复制。安装后验证：

```bash
"/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/omd-eventkit" version
```

4. 安装到其他 vault 时手动复制并保持可执行：

```bash
cp "/absolute/path/to/obsidian-omd-home/dist/omd-eventkit" \
   "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/omd-eventkit"
chmod 700 "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home/omd-eventkit"
```

复制后 reload OMD Home。Community-style 三项基础安装不包含此 helper；这是单独的 macOS
Calendar 测试步骤。

<a id="test-cal-00"></a>

### CAL-00：Helper、权限、明确选择 Calendar

1. EventKit helper override 留空。
2. Settings 应显示解析到插件目录旁的 helper，路径以
   `.obsidian/plugins/omd-home/omd-eventkit` 结束。
3. 点击 **Refresh calendars**。
4. macOS 询问 Calendar 权限时选择允许。若未弹窗且失败，打开
   **System Settings → Privacy & Security → Calendars**，允许 Obsidian，然后 reload。
5. 确认 macOS Calendar app 中可见的 calendars 出现在列表。
6. Google/Outlook 只有先在 macOS **Internet Accounts/Calendar** 添加账户并能在 Apple
   Calendar 中看到，才会通过 EventKit 出现。
7. 只开启你明确同意同步的 calendars。
8. 在 **Default calendar** 选择一个已开启且 writable 的 calendar；read-only calendar
   不能成为 default。
9. 输入无效 custom helper 路径：Settings 应立即显示 missing/not executable；Refresh
   显示明确错误。点击 **Use bundled** 后再次 Refresh。
10. 把 Settings 滚动到 Calendar 中段，展开 **Advanced Calendar helper**，再执行 Refresh 或切换
    一个 calendar。页面不得跳回顶部；Startup、OMD、AI answers 不应被重建，Calendar 之外的
    disclosure 状态应保持不变。

通过条件：missing helper、permission denied、真正空 calendar list 和成功状态有不同提示；
成功包含 calendar 数量和时间戳；不会自动选择所有 calendars。

<a id="test-cal-01"></a>

### CAL-01：Start / End 与 All day

1. 用 **OMD Home: Create event** 或 Calendar 中的 **New event**。
2. 输入 title `CAL-01 Timed Fixture`。
3. Start 设为 `2026-09-15 10:00`，End 设为 `2026-09-15 11:00`；使用本地
   `datetime-local` 控件并确认时区和可读性。
4. 保存这一小时的同日 event，再重新打开。
5. 开启 **All day**；Start/End 应切换为 date。
6. 保存再打开。

通过条件：End 始终晚于 Start；同日 timed event 转 all-day 后，End 是排他的下一日；无效范围
不能保存并显示明确提示。

<a id="test-cal-02"></a>

### CAL-02：Vault / Calendar / Linked filters

先在同一可见日期范围准备：

- Vault-only：`CAL-02 Vault Only`，`2026-09-16 09:00–10:00`，New event 的 Destination
  选 **Vault note only**。
- Linked：`CAL-02 Linked`，`2026-09-16 11:00–12:00`，选择
  **Vault + <default calendar>**。
- Calendar-only：`CAL-02 Calendar Only`，`2026-09-16 13:00–14:00`，直接在 macOS
  Calendar 创建，Refresh 后显示。
- 如果外部 event 为 read-only，可用 **Create linked vault note** 建立 linked note，但不能
  修改外部 calendar。

然后：

1. 切到非当前月份或 Week view。
2. 分别点击 Vault、Calendar、Linked filter。
3. 观察 pressed state 和 event 消失/出现。
4. 尝试关闭最后一个仍启用的 source。

通过条件：filter 立即生效且不重置当前日期/view；至少保留一个 source enabled。

<a id="test-cal-03"></a>

### CAL-03：Linked sync 与双向冲突

1. Settings 中已选择 writable default calendar。
2. 创建 title 为 `CAL-03 Conflict Fixture`、时间为 `2026-09-17 10:00–11:00` 的
   **Vault + <default calendar>** event。
3. 运行 **OMD Home: Sync linked calendar events**。
4. 确认 Markdown note 与 Apple Calendar event 都存在且字段一致。
5. 完全同步后，在 Markdown event frontmatter 修改 title 或时间。
6. 在 macOS Calendar 中也修改同一 event 的相同或不同字段。
7. 两边都保存后再运行 Sync。
8. 预期显示 **Calendar conflict**，说明在选择前不会覆盖。
9. 选择 **Keep note**，验证 Calendar 变为 note 版本。
10. 重新制造冲突，选择 **Keep calendar**，验证 Markdown 变为 Calendar 版本。
11. 测试过程中不要手工删除 linkage ID；如果 event unavailable，使用明确的 Recreate/Detach
    操作，而不是普通 Save。

通过条件：绝不静默选边；冲突状态阻止普通 edit/drag；resolution 后两边一致并回到 clean。

## 9. Capture 与 Enrichment

<a id="test-cap-01"></a>

### CAP-01：URL、普通路径、空格路径与拖放

1. 点击 **Capture URL or file**，粘贴公开测试 URL `https://example.com/` 并提交。预期生成的
   `Sources/Web/Example Domain*.md` frontmatter 包含 `omd_home_status: inbox`，Home 的 OMD Inbox
   出现该记录，并且不显示 “output path could not be verified”。若外置磁盘索引较慢，允许先显示
   “saved to OMD inbox” 提示；重新打开 Home 后记录仍必须出现。
2. 选择一个小型本地文件，用普通绝对路径 capture。使用已经准备好的：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/small-local-file.html
   ```

   在 Home 点击 **Capture URL or file**，把整行路径粘贴到输入框后提交；不要把文件路径当作
   Terminal 命令执行。预期：任务先进入 Current task；OMD 转换器完成临时文件时不能提前显示
   **Complete**。只有最终 Markdown 已存在、通过 vault 路径验证，并写入
   `omd_home_status: inbox` 后，才允许出现成功提示，System 才显示 **Last run completed**，同时
   OMD Inbox 出现一条待 review 的记录。完成后 Current task 回到 **No task running** 属于正常
   状态。重复运行时文件名可能带 `-2`、`-3` 等防覆盖后缀，这是正常的。
   如果最终 Markdown 缺失或 Inbox 状态写入失败，任务必须显示错误并进入 Needs Attention，不能
   显示成功。
3. 使用已准备的 `~/Desktop/OMD Home Test Fixtures/survival analysis sample.html`；插件应展开
   `~/`，并把包含空格的整段路径作为一个 source。这里不再使用 `omd-home-example.pdf`：该文件是
   专门用于识别无文本层扫描 PDF 的样本，不能同时作为普通路径成功用例。
4. 使用已准备的空格路径：
   `/Users/shion/Desktop/OMD Home Test Fixtures/survival analysis sample.html`。
   在 OMD Home 输入框直接粘贴这一整行，不要加入 shell 用的反斜杠。如果从 Terminal 复制出
   `OMD\ Home\ Test\ Fixtures`，插件也应还原，但普通用户主路径以无反斜杠形式为准。
5. 分别验证两个独立的拖放入口：
   - **Home omnibox**：用 `Command + P` 运行 **OMD Home: Open home**。在 OMD Home 页面顶部，
     找到带放大镜、placeholder 为 **Search, capture, command, note, event, or ask OMD** 的长输入框，
     把本地文件拖到这条输入框上并释放。
   - **Capture dialog**：点击 Home 输入框下方的 **Capture URL or file**，在弹窗中找到
     **Drop a local file here** 区域，再把本地文件拖到该区域并释放。

   两处都拖入这个已准备的文件：
   `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/english-ocr.png`。
   这两项是分别测试两个入口，不是要求把同一个任务从 omnibox 继续拖进弹窗。两处都应自动填入
   文件路径并开始或允许确认 capture，且不会把路径当作 shell 命令执行。
6. 输入不存在的路径，例如
   `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/english.png`。
   预期显示：`File not found: <刚才输入的完整路径>. Check the filename and location, then try again.`；
   Needs Attention 也保留该路径。不能显示笼统的 “Check the OMD setup” 错误，因为此时 OMD
   配置本身没有问题。
7. 验证普通 non-AI capture 不依赖 Ollama：
   1. 在 Home 点击 **Capture URL or file**，记录 **Optional local AI** 下
      **Polish Markdown** 与 **Review links and tags** 的初始状态。
   2. 翻转两个开关后点击 **Cancel**，再次打开 Capture。预期仍显示第 1 步记录的状态，因为
      Cancel 不应修改以后 capture 的默认选择。
   3. 关闭 Capture，打开 **Settings → OMD Home → AI answers**。确认这里没有这两个开关的
      重复副本。
   4. 展开默认折叠的 **Advanced AI controls**，向下找到 **Ollama troubleshooting →
      Ollama endpoint**。说明文字应明确显示默认值 `http://localhost:11434`，以及唯一允许的备用
      地址 `http://127.0.0.1:11434`。把当前值临时改为不可用的 `http://localhost:9999`；这个值只用来
      证明关闭 AI 的 capture 不会连接 Ollama，不要点击 **Check setup**。
   5. 回到 Home，再次点击 **Capture URL or file**。关闭两个 Optional local AI 开关，然后使用
      `docs/manual-test-fixtures/capture/small-local-file.html` 完成 capture。开关应为灰色且滑块位于左侧。
   6. 预期结构转换成功并进入 OMD Inbox；无效 Ollama endpoint 不应把这次 capture 标记为失败，
      也不应出现 “output path could not be verified” 提示。外部磁盘上的新文件可能需要数秒才会被
      Obsidian 索引，这段等待属于正常现象。
   7. 再次打开 Capture，确认两个关闭状态已成为下一次新 capture 的起始状态；然后点击 Cancel。
      这证明只在提交 Capture 后记住选择。
   8. 测试后立即把 **Ollama endpoint** 恢复为 `http://localhost:11434`。需要继续本地 AI 测试时，
      点击 **Check setup** 重新验证。若要恢复第 1 步的开关状态，请在下一次真实 capture 提交前恢复；
      只修改后点击 Cancel 不会保存。

通过条件：有效 URL/文件都到达 OMD；空格路径被还原但不通过 shell 执行；missing path 有具体
错误；两个可选 AI 动作均关闭时，普通 non-AI capture 不因无效 Ollama host 被阻止。

<a id="test-cap-language"></a>

<a id="test-cap-01a"></a>

### CAP-01A：OCR / ASR 语言、Config 优先级与 Retry

已经准备以下 7 个小型样本，全部位于源码目录的 `docs/manual-test-fixtures/`：

| 用途 | 准确相对路径 |
| --- | --- |
| 纯英文截图 | `generated/english-ocr.png` |
| 简体中文 + 英文截图 | `generated/simplified-chinese-english-ocr.png` |
| 繁体中文 + 英文截图 | `generated/traditional-chinese-english-ocr.png` |
| 纯文字网页 | `capture/plain-text-web-page.html` |
| 无文本层扫描 PDF | `generated/scanned-bilingual-page.pdf` |
| 中英文语音 | `generated/bilingual-speech.wav` |
| 首次失败后可恢复的输入 | `capture/retry/retry-source.ready.html` |

所有输入都是 synthetic，无个人数据。PDF 已验证为一页 image-only 文档；音频约 7 秒。

本节中“简体中文 + English / No language preference”分别指 **Image text language / Speech language**
两个控件。图片的 **No language preference** 不代表自动检测：它使用 OMD 配置或默认值，
当前测试环境实际为 `eng`。请在 Capture 弹窗选择图片语言后提交；单次选择不会覆盖 Settings 默认值。

2026-09-17 人工发现：从首页搜索框直接提交简中图片绕过语言选择，侧车记录
`requested=null / effective=eng / source=default`，原始 OCR 已乱码。记为 **FAIL，待修复安装后原生复测**。
已合入源码修复：首页本地图片进入预填 Capture 并展开 Recognition，下拉框完整显示语言；
565 项自动测试及 6 个布局场景通过；22:50 已安装 / 原生重载，图片入口与语言显示检查通过（1.3A.1）。原始 OCR 内容用例仍保留失败记录，待你显式选语言复测。
独立 CLI 对照：`chi_sim+eng` 恢复中文主体（仍有标点 / 空格差异），网页三种语言正文相同，
扫描 PDF 退出失败且无笔记；这些不替代你的原生 UI 验收记录。

扫描 PDF 原生验收补充：用户截图时间 **17 Sept 22:26**，显示 **Capture failed**，
并明确说明无法提取可读内容，建议改用页面图片 OCR 或带文字层的 PDF。
读取 test-vault 未发现该来源生成的 Markdown。本项记为 **PASS（不支持功能的限制处理）**，
不表示扫描 PDF OCR 转换成功；相同文件和设置直接 Retry 不能解除此限制。
[用户截图](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/ocr-simplified-investigation/scanned-pdf-native-user.png>)。


1. 首次测试或先在 **Settings → OMD Home → Recognition defaults** 把两个选项都设为
   **No language preference**，然后打开 Capture 并展开
   **Recognition (optional)**。确认 **Image text language** 从 **No language preference**
   开始，并可选 `eng`、`chi_sim+eng`、`chi_tra+eng`；**Speech language** 从
   **No language preference** 开始，并把明确的 **Auto-detect**、
   `en` 与 `zh` 分开显示。界面不得出现 Inherit 或 adapter default 这类内部术语。
   提交一次使用其他语言选项的 capture 后重新打开弹窗，确认它仍使用 Settings 中的 vault
   defaults，而不是把上一次 item-only 选择静默保存成默认值；取消弹窗同样不得改变默认值。
   然后在 Settings 修改一个 recognition default，再打开 Capture，确认新默认值生效。
2. 分别以 `eng`、`chi_sim+eng`、`chi_tra+eng` capture 三张截图，确认文字与语言相符。直接使用：

   | UI 选择 | 文件 | 至少应准确出现 |
   | --- | --- | --- |
   | English | `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/english-ocr.png` | `English invoice code: BLUE-417`、`Meeting: Tuesday 10:30` |
   | 简体中文 + English | `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/simplified-chinese-english-ocr.png` | `简体中文 OCR 测试`、`蓝色灯笼在窗户旁边。`、`SIM-204` |
   | 繁體中文 + English | `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/traditional-chinese-english-ocr.png` | `繁體中文 OCR 測試`、`藍色燈籠在窗戶旁邊。`、`TRA-305` |

   少量空格或标点差异可以记录为 OCR quality note；语言错用、稳定 code 错误或正文大面积乱码为 FAIL。
   再用缺少其中一个 pack 的隔离测试环境重测，不要改动日常安装；确认错误指出缺失 pack，并提示
   诊断/安装后重试。

   **2026-09-19 缺包隔离分支：PASS。** 临时 wrapper 只向 OMD 暴露 `eng` 与 `osd`；Recognition
   下拉只显示 English 是预期的预防性过滤，不表示 wrapper 默认值失效。以 **No language preference**
   提交后，OMD 仍按 wrapper 默认请求 `chi_sim+eng`，原生错误准确显示 Requested `chi_sim+eng`、
   Missing `chi_sim`、Available `eng, osd`，并给出各平台安装方式与 retry 下一步。22:53 只读核对
   test-vault 未发现这次失败生成的新 Markdown。复测结束后必须把 OMD executable override 从临时
   wrapper 恢复为 `/Volumes/Transcend_q/APPS/AI/omd/.venv/bin/omd`，再运行 **Check setup**；不要带着
   隔离环境继续正常 OCR 或后续 Case。
3. 点击首页 **Capture URL or file** 按钮（或 Cmd+P → **OMD Home: Capture URL or file**），
   将 `docs/manual-test-fixtures/capture/plain-text-web-page.html` 的完整本地路径填入 **URL or file path**。
   展开 **Recognition (optional)**，在 **Image text language** 中选 **English**，
   **Speech language** 保持 **No language preference**。关闭 **Polish Markdown** 与
   **Review links and tags**，点击 **Capture**。重新打开弹窗，对同一文件再转换两次，
   分别选 **简体中文 + English**、**繁體中文 + English**。
   三份笔记的 **Full Content 正文**应完全一致，均含 `Stable token: copper-river-204.`；
   文件名编号、Source、Captured 时间及元数据不参与比较。此项验证文字网页不会受图片 OCR 语言影响。
4. 同样从 Capture 弹窗提交 `generated/scanned-bilingual-page.pdf` 的完整路径，
   **Image text language** 可选 **简体中文 + English**，两个 AI 开关保持关闭。
   此文件只有扫描图片、没有文字层。当前支持单张图片 OCR 和 PDF 文字层提取，
   不支持直接对 PDF 页面做 OCR；更换识别语言或开启润色不能补救。
   预期界面提示无法提取内容，并建议将页面作为图片捕获或使用带文字层的 PDF。
   清楚说明限制且不生成空笔记，才是本项“限制提示”测试的 PASS；这不表示已支持扫描 PDF OCR。
   模糊错误、无下一步提示，或空正文仍显示成功，均记录 FAIL 并保存截图。
5. 对同一个语音样本
   `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/bilingual-speech.wav`
   分别选择 ASR **Auto-detect** 与 **Chinese**，确认前者传递明确 auto-detect，后者传递明确
   `zh` hint；再验证 **No language preference** 不等同于 Auto-detect。原音内容只有两句：

   ```text
   English: The blue lantern is beside the window.
   中文：蓝色灯笼在窗户旁边。
   ```

   Auto-detect 应保留两种语言的主要含义；Chinese 至少应正确识别中文句。No language preference
   使用 adapter/config 默认值，记录实际 effective language，不要把它写成“自动检测”的同义词。
6. 用尚不存在的准确路径
   `/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/retry/retry-source.html`
   触发一次可重试失败。出现 Needs attention 后，在 Terminal 执行：

   ```bash
   cp "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/retry/retry-source.ready.html" \
      "/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/retry/retry-source.html"
   ```

   再点击 **Retry**，确认原 OCR、ASR、polish、tags 与 suggest-links 选项全部保留。测试完成后
   删除刚生成的 `retry-source.html`，保留 `.ready.html` 给下一轮测试。
7. 在 Terminal 运行 `omd config path` 与 `omd config show --json`，确认 config 是带版本的有效
   JSON。依次用显式参数、环境变量、config 与 adapter/builtin 默认值验证优先级从高到低。
8. 对 OMD Home 显示的 executable 运行 `--version` 与 `capabilities --json`，确认与插件探测结果
   一致；切换到另一个/旧 executable 时错误应指出实际路径与能力不匹配。

通过条件：OCR 与 ASR 从 UI 到 argv 全程分离；English、简体 mixed、繁体 mixed、纯 web text、
scanned PDF limitation、ASR Auto/zh 都符合边界；Retry 不丢选项；不出现已发布 automatic OCR
language detection 的文案；polish 不被描述为 OCR 或 translation。

<a id="test-cap-02"></a>

### CAP-02：本地 AI 生成 links/tags，Review 后才写入（历史完整 case）

**不要按下面的旧按钮语义执行。** 本轮入口是顶部 [RC-P2-02](#test-rc-p2-02)。下面 1–11 步只保留
2026-09-17–22 的完整 case 与历史证据；当时 Apply 会直接写 Reviewed，当前版本已改成 Apply 保持
Inbox、只有 **Done reviewing** 完成状态。Automatic candidate 优选另在 OMD-01／REL-01 验收。

1. 在 Capture 的 **Optional local AI** 下记录两个 toggle 的初始状态，再开启
   **Review links and tags**。按测试需要决定是否同时开启 **Polish Markdown**；两个动作应保持独立，
   并记录提交时的最终状态，供第 8 步比较。
2. Capture `docs/manual-test-fixtures/capture/small-local-file.html`，等待 proposal。
3. Proposal 出现后不要 Apply。记录右上角 TARGET，点击 Cancel，从 Recent / Inbox 打开这份 note；
   确认它仍为 `inbox`，正文、links 和 tags 没有 proposal 写入，Summary preview 与 Suggested note
   topics 也没有写进 note。再对该 note 运行 **Suggest links and tags**，生成后续步骤使用的新 proposal。
4. 保持 proposal 的 Review 弹窗打开，尝试再次打开 **Capture URL or file**。预期提示另一个 OMD
   动作仍在进行，并且不打开第二个 Capture。取消 Review 后应可正常打开 Capture。反向再用一个
   较慢 capture 验证：capture 进行时运行 **Suggest links and tags**，也应被阻止，不能同时写 vault。
5. 查看 existing/new tag、links、Suggested note topics 和 warnings。Idea only 表示独立笔记主题建议，Apply 不会创建笔记或把主题写作 tags。
6. 取消选择至少一个建议，再点击 **Apply**。
7. 确认只写入已选 links/tags，并设置 `omd_home_status: reviewed`。
8. 再打开 Capture，确认 toggle 记住上次选择。
9. 冲突保护改为发布自动回归，不再要求普通用户保持模态 Review 弹窗的同时，
   再用 Finder / 文本编辑精确修改同一 `.md` 文件。旧步骤在本轮**没有执行，不计 PASS**。
   发布前运行：

   ```bash
   node --experimental-strip-types --test \
     tests/enrichment-apply.test.ts \
     tests/enrichment-obsidian-adapter.test.ts
   ```

   回归必须验证：Generate 后、Apply 前的外部正文修改返回 **Note changed**；用户新增行保留；
   旧 proposal 的 managed links / tags / reviewed 状态都不写入；OMD Home 自己的原子写入刷新
   inode / `TFile` 后可重新绑定，而写入前的外部身份变化仍被拒绝。自动冲突测试不代替
   本用例中的正常 Apply 原生复测。
10. 如果 Generate 阶段被 OMD 拒绝，核对错误分类：模型 proposal 格式、tag 或 candidate 校验失败
   应提示重新生成或更换 **Local writing model**；目标 note/candidate 消失应显示
   **Note unavailable**，只允许关闭并从仍存在的 Markdown note 重新开始；
   只有真实的 executable、Ollama 或 endpoint 故障才提示检查 setup。不得把所有失败统一显示成
   “Check OMD, Ollama, the model, and endpoint”。
11. Capture 完成后，从刚生成的 note 再运行 **Suggest links and tags**。两个入口的 enrichment
   都必须继续使用当前同一兼容 OMD，不得在 Capture 后切到另一个 launcher 或报 capability 错误。
   记录 UI 可见的 executable 路径和任何错误；此检查不要求 Apply。在 OMD-01 专门测试 Automatic
   时，再把本项重复一次以确认自动候选不会漂移。

通过条件：Generate/Review 阶段零写入；新 tags 默认 unchecked；Apply 可选择；失败不声称成功，
frontmatter 失败时回滚或明确报告 recoverable partial failure。

**2026-09-17 本轮人工反馈与复测：** 原生正常 Apply 曾返回 partial failure：目标笔记已有
Related notes，`omd_home_status` 仍为 inbox。源码诊断为 OMD Home 写完正文后仍使用旧 inode /
`TFile` 绑定，把自己的原子写入误判为外部冲突。原现场已只读存档，未替用户修改。

修复安装后已真正停用 / 启用插件并通过 Check setup，再以独立测试笔记和 `qwen3:0.6b`
执行正常 Apply。结果为 **PASS**：终态显示 **Applied**，保存 5 个选中 links、4 个 tags，
`omd_home_status` 为 `reviewed`；保存内容不含 Proposal summary，也没有再出现 Review required。
这只关闭 UI-05 和 UI-06 的正常 Apply 阻塞。Automatic setup 前置已经另行通过，但不替代第 11 步
尚未完成的 Capture + enrichment 两入口验收。

旧的 Finder / 文本编辑冲突步骤没有执行，**不计人工通过**；现改为上述确定性自动回归。
frontmatter / 磁盘故障与保护性回滚使用故障注入测试验证，不要求普通用户制造文件系统竞态。

<a id="test-cap-03"></a>

### CAP-03：失败归属与 Setup health

开始前记录当前 **Local writing model**，确认 OMD 卡片显示 **OMD ready**；展开
**Advanced OMD paths**，确认 **OMD executable override** 为空。空 override（输入框占位文字
**Automatic discovery**）表示正在使用自动发现，界面不会另显示一个 **Automatic** 状态标签。本用例
不删除、不降级日常 OMD，也不 pull 测试模型。

1. 在 **Capture URL or file** 提交固定的不存在路径：

   ```text
   /tmp/omd-home-cap03-does-not-exist/document.pdf
   ```

   关闭两个 Optional local AI 开关以隔离 source 错误。预期显示缺少本地文件，Current task 回到
   idle，不创建 Markdown；Needs attention 保留带 source 和时间的 **Retry capture**。
2. 打开 **Settings → OMD Home → OMD → Advanced OMD paths**，在 **OMD executable override** 填：

   ```text
   /tmp/omd-home-cap03-does-not-exist/omd
   ```

   离开输入框或点击 **Check again**。预期为 **Custom OMD path not found**，并提供
   **Use automatic**；不能显示 OMD update required。
3. 把 override 改成仓库内固定的“不支持 enrichment”测试程序：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/tools/omd-unsupported-enrichment
   ```

   点击 **Check again**。预期为 **OMD update required**，说明 custom OMD 太旧或不支持当前能力，
   并显示 **Update guide**；不能误报 path missing。不要用 `/opt/homebrew/bin/omd` 代替这个 case：
   当前机器上的该 launcher 支持 enrichment schema v1，只是没有完整 Recognition contract。
4. 点击 **Use automatic**，再点 **Check again**。预期恢复 **OMD ready**，并重新解析到兼容候选；
   确认 override 已清空后再继续。
5. 在 **Advanced AI controls → Local writing model** 记录当前值，选择 **Custom…**，输入一个
   `ollama list` 中不存在的 ID（本轮固定使用 `omd-home-cap03-missing-model:latest`），点击
   **Save model**，不要 pull。回到 Home，Capture：

   ```text
   /Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/capture/small-local-file.html
   ```

   开启 **Polish Markdown**，并记录 **Review links and tags**、OCR、ASR 的选择后提交。预期在写入
   新 note 前得到明确的 local model missing / unavailable 错误，Current task 回到 idle；
   Needs attention 提供这次请求的 **Retry capture**，而不是把它归为 OMD executable 错误。
   错误出现后立刻查看 Current task；不得依靠 Check setup、切换页面或其他后续动作才刷新为 idle。
6. 保留第 5 步失败，运行 **Check setup**。即使 Setup 显示 missing model，之前的
   **Retry capture** 仍应作为独立操作可见；点击 Retry 后，Capture 应恢复同一个 source、OCR、ASR、
   Polish Markdown 和 Review links and tags 选择。只检查恢复值，然后点击 Cancel，不再次提交。
7. 把 **Local writing model** 恢复为开始时记录的真实本地模型，按需要点击 **Save model**，再点击
   **Check setup**；确认恢复后的模型不再显示 missing / unavailable。OMD 卡片应继续显示 **OMD ready**；
   展开 **Advanced OMD paths**，确认 **OMD executable override** 为空。这里的 Automatic 是空 override
   所代表的配置状态，不会作为单独标签出现。以上条件恢复后再继续 CAP-06 或其他本地 AI 测试。

通过条件：第 5 步 Current task 立即回到 idle，Needs attention 显示一条包含安全 source/detail 的
timestamped capture failure 和一个 Retry；第 6 步 Check setup 可以另显示一次 setup health，但两类
状态各只出现一次，且 failed capture 的 Retry 不会被覆盖；missing 与 old executable 不混淆；
同一错误不同时重复出现在多个 panels；结束时 OMD 显示 ready、executable override 为空，且原
Local writing model 已恢复。

2026-09-20 原生结果：修复前用户观察到错误和 Retry 正确出现，但 Current task 没有立即回到 idle，
因此该轮记为 **PARTIAL / FAIL**。修复将终态重绘延后到 capture lifecycle 已清理之后；安装 production
bundle 并真正停用／启用插件后，以相同不存在的模型和 fixture 复测，错误出现时 Current task 已立即
显示 **No task running**，System 为 **OMD idle / Last run error**，Needs attention 同时提供准确的
missing-model 说明与 **Retry capture**，且没有写入新 note。Retry 目视确认恢复 source、Polish
Markdown、Review links and tags；OCR / ASR 保持本轮记录的 No language preference。测试者随后把
Local writing model 恢复为 `qwen3:4b-instruct` 并运行 **Check setup**；界面直接显示 **OMD ready**。
配置复核确认 `omdExecutable` 为自动发现值，Advanced OMD paths 中的 override 为空。因此第 1–7 步
均 PASS，CAP-03 完整通过。

<a id="test-cap-06"></a>

### CAP-06：后台继续、unload 和退出取消

使用同一份约 114 秒的合成双语音频，不使用私人或超大文件：

```text
/Volumes/Transcend_q/APPS/AI/omd-home/docs/manual-test-fixtures/generated/slow-bilingual-speech.wav
```

开始前确认 **OMD ready**。每次打开 Capture 后，无论开关当前显示什么，都要逐项确认
**Polish Markdown** 和 **Review links and tags** 已手动切到 off（灰色／关闭位置）；任一开关仍为
on 时不要提交。Image text language 与 Speech language 选择 **No language preference**，从而只测试
capture 生命周期。每个场景使用下面指定的唯一 tag；用左侧 ribbon 的放大镜打开 **Obsidian 原生
Search**（或在 Command palette 运行 **Search: Search in all files**），再以
`tag:#cap-06-background` 等查询核对是否真正生成 note。不要把这些查询输入 OMD Home 顶部的
omnibox；它执行 OMD 内容检索，不解析 Obsidian 的 `tag:` 运算符。若本机在操作前已经完成任务，该次不计入
相应取消场景；保留它作为完成证据，换成 `-retry-1` 后缀的新 tag 立即重试。

#### A. 关闭 Home view 后后台继续

1. 打开 **Capture URL or file**，粘贴上面的 WAV 路径；Tags 填
   `cap-06-background`，提交。
2. 看到 Current task 为 active 且出现 **Cancel** 后，立即切到任意普通 note；只关闭 OMD Home tab，
   不点击 Cancel，也不 disable plugin。
3. 在其他 tab 停留约 30 秒，然后从 ribbon 重新打开 OMD Home。
4. 若仍在运行，Current task 应继续显示当前阶段；等待完成。若已经完成，Recent / Inbox 应出现新
   note，Obsidian 原生 Search 的 `tag:#cap-06-background` 恰好有一个结果。

此场景中关闭或隐藏 Home view 不能取消 plugin-owned capture；不得新增 Needs attention 错误。

2026-09-20 原生结果：**A PASS。** Home view 关闭期间任务继续，生成
`Sources/Audio/slow-bilingual-speech.md`；note 带 `cap-06-background` 和
`omd_home_status: inbox`。完成后另弹出 enrichment 的 **Could not finish**，原因是该次实际保存的
`capturePolish` 与 `captureSuggestLinksAndTags` 都仍为 `true`，模型随后把一个新 tag 错报为现有
catalog tag，validator 安全拒绝 proposal；界面明确说明没有 proposal 写入。此错误不推翻 A，也
不需要 Generate again；关闭弹窗，在 B 的 Capture 中明确把两个开关切到 off 后继续。

#### B. 用户明确点击 Cancel

1. 再次 Capture 同一 WAV，Tags 改为 `cap-06-user-cancel`。
2. Current task 为 active 且 **Cancel** 可见时立即点击 **Cancel**。
3. 等待 5 秒；确认 Current task 回到 **No task running**，左侧边栏的 Obsidian 原生 Search
   `tag:#cap-06-user-cancel` 为 0，OMD Inbox 没有相应新 note。OMD Home 顶部 omnibox 返回的
   相似内容结果不计入数量。
4. Needs attention 不得新增这次取消的 capture failure 或 **Retry capture**；允许显示一次简短的
   cancelled Notice。之前其他测试留下的无关错误不计入本项。

#### C. Disable / enable plugin 时取消 child process

1. 可选但推荐：在 Terminal 先记录空闲基线：

   ```bash
   ps -axo pid=,ppid=,command= | grep -E '(^|[[:space:]/])(omd|mlx_whisper|ffmpeg)([[:space:]/]|$)'
   ```

   这条命令只使用 macOS 自带的 `grep`，不要求另装 `rg`／ripgrep，并使用命令边界避免把路径中的
   `omd-home` 误判为 `omd` 进程。没有输出表示当前没有匹配进程；基线已有的无关进程只记录，不结束。
2. Capture 同一 WAV，Tags 填 `cap-06-unload`。确认 Current task active 且 **Cancel** 可见，但不要
   点击 Cancel。
3. 立即打开 **Settings → Community plugins → Installed plugins**，关闭 **OMD Home** 开关；等待
   5–10 秒。
4. 再运行同一条只读进程命令。与基线相比，不得残留本次新增的 OMD、`mlx_whisper` 或 `ffmpeg`
   PID。
5. 重新启用 OMD Home，从 ribbon 打开 Home。Current task 应为 **No task running**；Obsidian 原生 Search
   `tag:#cap-06-unload` 为 0，Inbox、Recent 和 Needs attention 均不得把这次中断显示为完成、
   stale active 或新的可重试失败。

#### D. 完全退出 Obsidian 时取消 child process

1. Capture 同一 WAV，Tags 填 `cap-06-quit`。确认 Current task active 且 **Cancel** 可见。
2. 不点击 Cancel，直接使用 **Cmd+Q** 完全退出 Obsidian；关闭窗口或 Home tab 不算此步骤。
3. 等待 5–10 秒，在 Terminal 用场景 C 的命令确认没有比空闲基线多出的 OMD、`mlx_whisper` 或
   `ffmpeg` PID。
4. 重新打开 Obsidian 和 OMD Home。Current task 应为 **No task running**；Obsidian 原生 Search
   `tag:#cap-06-quit` 为 0，且没有 partial note、Inbox/index 条目、stale active 状态或新增 Retry。
5. 最后再用 `tag:#cap-06-background` 确认场景 A 的成功 note 仍存在；unload / quit 不得删除此前
   已完成的 capture。

2026-09-20 原生结果：**D PASS（用户确认）。** 在任务 active 时使用 **Cmd+Q** 完全退出 Obsidian；
重开后没有残留该任务、错误 Retry 或 `cap-06-quit` 对应的完成 note，场景 A 已完成的
`cap-06-background` note 仍保留。本结果只关闭 D，不替代 B、C 各自的取消与进程基线证据。

通过条件：A 后台继续并只生成一个完成 note；B、C、D 都不生成对应 tag 的 note。B 回到 idle 且不把
用户取消记为失败；C、D 在 10 秒内恢复到进程基线，重开后没有 orphan task、stale active、partial
success 或错误的 Retry。只有场景 B 点击 UI 的 Cancel；C、D 必须通过 unload / quit 触发取消。

## 10. Release bundle

<a id="test-rel-01"></a>

### REL-01：干净 vault 与三项 bundle

1. 使用本轮 disposable test-vault，确认
   `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/.obsidian/plugins/omd-home` 不存在。
2. 从同一 commit build 或同一 GitHub Release 取得三项资产。
3. 只复制 `manifest.json`、`main.js`、`styles.css` 到新 `omd-home` 目录。
4. Enable OMD Home。
5. Disable/enable 一次，再完全退出并重开 Obsidian。
6. 打开 Settings 与 Home。
7. 确认 name、description、version 正确，无 missing asset 或 Console exception。
8. 此阶段不要安装 OMD、Ollama 或 EventKit，先确认无依赖时其他模块仍可用。
9. 如果测试的是已发布 Release，计算本地三项 hash，并与下载的 Release 资产逐项一致。

通过条件：只凭三项资产即可 Marketplace-style 安装、enable、disable、reload 和 cold restart；
缺少可选依赖只影响对应模块。

## 11. 何时停止、如何报告

立即停止后续测试并标为 blocker：

- Obsidian 或插件启动 crash。
- vault 笔记被意外覆盖、删除或泄漏。
- local-only gate 未通过却发送了 vault 内容。
- Calendar conflict 静默覆盖一边。
- shell-escaped path 被当作 shell command 执行。
- disable/quit 后仍留下 OMD/Python/EventKit orphan process。
- Release 三项资产版本不一致。

普通功能 FAIL 可以继续测试无关模块，但要记录：

1. 测试编号。
2. commit/version。
3. 精确操作步骤。
4. 预期与实际结果。
5. Notice、Needs attention、Current task 文本。
6. Console error。
7. 截图或短录屏。
8. 是否重试可恢复。

测试结束后：

- 如果 AI-03 中撤销了测试者自己创建的 Ollama local-only override，按测试前记录恢复；
  AI-02 本身不创建 `server.json` 备份。
- 恢复删除的模型或记录未恢复原因。
- 删除 disposable vault，或明确标记它不能作为日常 vault。
- 需要保留旧设置时，从 vault 外备份恢复 `data.json`。
- 只有 Core 全部 PASS、必要 Extended 通过且 release checklist 完成后，才推 matching tag、
  创建 GitHub Release 并提交 Obsidian Community directory。
