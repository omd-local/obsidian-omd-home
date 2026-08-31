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

开始前运行：

```bash
git rev-parse HEAD
node -p 'require("./manifest.json").version'
```

记录：

| 字段 | 值 |
| --- | --- |
| 日期与时间 | 2026-08-31 17:26 NZST |
| 测试者 | shion |
| 上一轮已记录 baseline commit | `6adac24442caa450a76184c728284ca26bdb086f` |
| 本轮 Phase 2 RC commit | 待完成 clean commit / GitHub Release 后填写；不要用上面的 baseline SHA 代表当前未提交 worktree |
| manifest 版本 | `0.1.1` |
| Obsidian 版本 | `1.13.7` |
| macOS 版本 | `26.5.2` |
| vault 绝对路径 | `/Volumes/Transcend_q/APPS/AI/omd-home/test-vault` |
| OMD 版本/commit | `0.3.0b2` / `d9829166c15d4590a90fb3bd733c21ad51345092`；`/opt/homebrew/bin/omd` 是不兼容的旧 Homebrew launcher，兼容候选为 `/opt/homebrew/Caskroom/miniconda/base/bin/omd` 与源码 `.venv/bin/omd`；人工测试时仍以 Settings 实际解析路径为准 |
| Ollama 版本 | daemon `0.32.5`；`http://localhost:11434` 已连接；`cloud.disabled: true`（local-only） |
| Completion model | `qwen3:4b-instruct`（已安装）；另有 `qwen3:4b`（已安装） |
| Embedding model | Settings 已保存 `bge-m3`，但尚未安装；执行 AI-09 前再运行 `ollama pull bge-m3` |

不要只写“最新版本”；commit SHA 才能准确复现。

本轮 pre-commit 候选资产 SHA-256（基于上述 baseline 加当前未提交的 Phase 2 worktree；最终
Release 仍需用 clean commit 重新构建并更新记录）：

| 资产 | SHA-256 |
| --- | --- |
| `main.js` | `954d3b7ba40a7c8c3470f3f992c14865e4189e5ad6f739c8f5863e2c625068ff` |
| `manifest.json` | `7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb` |
| `styles.css` | `131f4455b183904d459a13e6e0d372caa7c924b2b8c55502c5c9e72addc1fa39` |
| `omd-eventkit` | `78db9fd4c4df14602adcbc5d888406f4ac51185b3bc798697551ed580444a33c` |

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

本轮测试使用两个不同目录，不能混淆：

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

先完成 Core。Extended 用于更深入的隐私边界和 RAG 质量测试。

| 阶段 | 测试编号 | 结果 | 说明 |
| --- | --- | --- | --- |
| Core | `Install-00`、`OMD-01`、`HOME-01`、`HOME-02`、`AI-00`、`AI-01`、`AI-02`、`AI-03`、`AI-04`、`AI-05`、`AI-07`、`CMD-01`、`CAL-00`、`CAL-01`、`CAL-02`、`CAL-03`、`CAP-01`、`CAP-02`、`CAP-03`、`CAP-06`、`REL-01` |  | 安装、设置体验、本地与云端边界、命令、Calendar、Capture、生命周期和 bundle。 |
| Extended | `AI-06`、`AI-08`、`AI-09`、`AI-10` |  | 诊断、后台任务、RAG benchmark、multilingual retrieval 与故障恢复。 |

每个案例记录：

| Case | PASS / FAIL / NOT RUN | 用时 | 截图/日志 | 备注 |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

`NOT RUN` 必须写清原因，例如“没有第二个 Ollama 环境，不愿删除现有模型”，不能当作 PASS。

## 5. Home 与 Omnibox

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
    - Python executable override：先留空，测试从检测到的 OMD shebang 自动发现。
    - OMD Home bridge override：先留空，使用打包在 `main.js` 内的 bridge。
    - EventKit helper：只在 Calendar 阶段安装。
    - Ollama 与模型：只在 Local AI 阶段启动。
11. 完成 `AI-00` 至 `AI-05` 以及 `AI-07`。没有 hosted developer key 时，将 `AI-04` 的
    真实连接分支记录为 `NOT RUN`，但仍完成无 key 与 fail-closed 检查。
12. 测试保留设置的重装：
    - 不删除 `data.json`。
    - 记录其 SHA-256。
    - 再次覆盖同一 build 的三项资产。
    - 重载插件并重复步骤 7–11。
    - 确认 `data.json` SHA-256 不变。

通过条件：首次安装和保留设置重装都能加载；失败显示在 Needs attention 且可以 Retry；
Current task 不长期残留已结束的任务；插件不要求把布局或设置写到 vault 外部。

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

### HOME-01：默认布局和文字对齐

1. 在 Home 右上角打开 widget/layout 菜单，选择重置布局。
2. 确认默认布局：
   - Today 与 OMD Inbox 是两列一行。
   - Current task 与 Needs attention 是两列一行。
   - Recent notes 与 Upcoming 是两列一行。
   - Pinned、Vault tags、System 是三列一行。
   - 默认没有 Continue widget。
3. 准备短文件名、长文件名、中文和英文 Markdown 笔记，观察 Recent notes。
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
  已验证为 local-only 的 loopback Ollama。
- **云端设置入口**：Ollama Cloud、OpenAI API、Anthropic API、DeepSeek API 可以保存或读取
  凭证、加载模型目录、验证模型可用性。当前 build 不会把 Vault 问题或证据发送给这些 provider。
  真正的云端 Vault Q&A 必须在后续版本具备逐题 evidence preview 与明确授权后才能开启。

任何设置检查都不得读取笔记正文。只有本地 `@` 回答、local enrichment、capture polish 或
local embedding retrieval 会处理 Vault 内容。

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
不是让 OMD Home 自动下载模型。
5. 云端 provider 测试会联系设置页明确显示的 destination。只使用你愿意用于测试的 developer
API key。ChatGPT 或 Claude 的消费者订阅不等于 API 额度。没有可用 developer key 时，把对应
网络案例记为 `NOT RUN`，不要使用个人主账号密钥截图或粘贴进测试记录。

### AI-00：Settings 信息架构、文案与响应式布局

1. 打开 **Settings → OMD Home**。
2. 确认顶层顺序稳定：**Startup → OMD → AI answers → Calendar**。
3. 在 **AI answers** 主流程中只应看到：
   - **Answer provider**
   - **Local-only boundary** 或 **Cloud boundary**
   - Hosted API 时的 **Developer key**
   - **Answer model**
   - **Answer setup** 与唯一主操作 **Check setup**
4. 确认设置页没有单独的 **Refresh models**、**Model catalog** 或三组 Smoke 按钮。
   这些低频诊断只保留在 Command Palette。
5. **Advanced AI controls** 默认折叠。展开后只包含：
   - Vault retrieval
   - Local capture and links
   - Ollama troubleshooting
6. 来回选择五个 provider。确认 section 只局部更新，不闪回页面顶部，不改变外层滚动位置，
   也不显示上一个 provider 的成功或错误反馈。
7. 对任一已通过检查的 provider 更换 **Answer model**。旧的成功状态应立即失效，并提示重新
   **Check setup**，不能继续把上一个 model 显示为 ready。
8. 缩窄设置面板到单列宽度，再恢复。确认 label 字号和左边界不变化，dropdown、secret input
   与按钮自然换行，不盖住说明文字。
9. 用键盘 Tab 遍历 dropdown、secret input、button、toggle 与 disclosure；焦点必须可见。
10. 检查文案一致性：主流程统一使用 **Check setup**，不混用 Refresh、Smoke 或 Check connection。

通过条件：普通用户不展开 Advanced 也能选择 provider、选择 model 并检查 setup；高级参数不抢
主流程视觉层级；操作反馈带时间戳且不会跨 provider 残留。

### AI-01：本地 Ollama、模型目录与默认 local-only 选择

1. **Answer provider** 选择 **Ollama on this computer**。
2. 确认 boundary 明确显示 destination 为 **This computer**，并说明每次回答前都会验证 local-only。
3. 点击 **Check setup**。第一次检查应同时读取 daemon 版本、`/api/status` 和本地 model catalog。
4. 对照 `ollama list`，确认所有已下载模型出现在 **Answer model**：
   - text completion model 可选择；
   - embedding-only 或非 text-capable model 带明确 warning；
   - thinking-only alias 建议使用 instruct model；
   - 插件不会隐藏、自动 pull 或静默替换 model。
5. 选择另一个已安装 text model，再点 **Check setup**。
6. 选择 **Custom model id…**，输入一个已安装 model 的准确 ID 并检查。
7. 输入不存在的 ID，确认显示 missing/unavailable；恢复有效 model。
8. 可选诊断：Command Palette 运行 **OMD Home: Refresh local AI models**。设置页 dropdown
   应更新，但页面不跳动。

通过条件：本地 model catalog 与 daemon 一致；所选 model 不被静默改写；成功反馈包括 model、
版本或 readiness 与时间戳。

### AI-02：Ollama local-only gate 与恢复路径

1. 保持 endpoint 为 `http://localhost:11434`，点击 **Check setup**。
2. 完全退出 Ollama。只关窗口不一定停止 daemon。先从 Ollama 菜单选择 **Quit Ollama**，然后运行：

```bash
curl -sS --max-time 2 http://localhost:11434/api/status
```

只有 connection refused/failed 才证明 daemon 已停止。若 App 拒绝退出，可在 Activity Monitor
中退出名称为 `Ollama` 或 `ollama` 的相关进程。不要结束其他不相关进程。
3. 此时点击 **Check setup**。应显示 daemon unreachable，并在 macOS 提供 **Open Ollama**。
   点击后等待 daemon 启动，再点 **Check setup**。
4. 在 **Advanced AI controls → Ollama troubleshooting** 把 endpoint 临时改成
   `http://localhost:9999`。应在发送任何内容前拒绝。测试后恢复默认值。
5. 查看当前 Cloud 状态：

```bash
curl -sS http://localhost:11434/api/status
```

记录 `cloud.disabled` 与 `source`。命令只输出 JSON，不会额外打印 PASS。
6. 如果需要测试 Cloud-available 分支，先完全退出 daemon 并备份配置：

```bash
cp ~/.ollama/server.json ~/.ollama/server.json.omd-home-backup
```

保留无关 JSON key，只移除 `"disable_ollama_cloud": true`，并运行：

```bash
launchctl unsetenv OLLAMA_NO_CLOUD
launchctl getenv OLLAMA_NO_CLOUD
```

第二条应无输出。重启 Ollama 后确认 `cloud.disabled` 为 `false`。
7. 切回 **Ollama on this computer** 并点击 **Check setup**。本地 `@`、enrichment、capture polish、
embedding retrieval 都必须被 local-only gate 阻止。
8. 恢复备份，或在有效 JSON 中加入 `"disable_ollama_cloud": true`；完全重启 Ollama，确认
`cloud.disabled` 为 `true`，再点 **Check setup**。

通过条件：daemon、invalid host、Cloud available、Cloud unknown 和 local-only ready 是不同
状态；无法证明 local-only 时，不发送任何 Vault 内容。

### AI-03：Ollama Cloud 设置入口，回答保持 fail-closed

1. 在 Ollama App 登录并允许 Cloud，确认 `/api/status` 的 `cloud.disabled` 为 `false`。
2. **Answer provider** 选择 **Ollama Cloud**。
3. 不选 model，先点 **Check setup**：
   - OMD Home 读取本地 Ollama App 返回的 Cloud 状态与 model metadata；
   - 如果本地还没有 Cloud model metadata，提示先在 Ollama 中运行一次 cloud model；
   - 如果发现 models，dropdown 被填充，并提示选择后再次检查。
4. 选择 cloud-backed model，再点 **Check setup**。成功只代表 credential/session 与 model
   metadata 可用，不代表 Vault Q&A 已开启。
5. 在 Home 输入一个真实问题，例如：

```text
@Summarise my private project notes.
```

预期立即显示“cloud answer provider is not enabled in this build”一类消息。它必须在 OMD
capability check、Vault retrieval 和 model generation 之前返回。
6. 检查结果区、Needs attention 和 Console：不得出现 evidence chip、note excerpt、绝对路径或
跨 provider fallback。
7. 恢复 `cloud.disabled: true`，以便继续本地 AI 测试。

通过条件：Ollama Cloud 的设置入口可检查，但 `@` 不会发送 Vault 内容；不会自动降级到
OpenAI、Anthropic、DeepSeek 或本地 Ollama。

### AI-04：OpenAI、Anthropic 与 DeepSeek 设置入口

对 **OpenAI API**、**Anthropic API**、**DeepSeek API** 逐一执行。没有真实 developer key 时，
先完成 A 和 D，B/C 记为 `NOT RUN`。

#### A. 无 key 与设置文案

1. 选择 provider。
2. 确认 **Cloud boundary** 显示固定 destination：
   - OpenAI: `api.openai.com`
   - Anthropic: `api.anthropic.com`
   - DeepSeek: `api.deepseek.com`
3. 确认说明写明：Check setup 会认证并读取 model catalog，但不发送 Vault 内容。
4. 不填写 key，点击 **Check setup**。应显示 credential missing，不得回退其他 provider。

#### B. 提供并验证 developer key

只执行与当前测试平台对应的路径。三个 provider 的变量分别是 `OPENAI_API_KEY`、
`ANTHROPIC_API_KEY`、`DEEPSEEK_API_KEY`。

**macOS Keychain 路径**

1. 在 **Developer key** 输入有效测试 key，点击 **Save key**。
2. 输入框必须清空，状态明确写出 **macOS Keychain**，并出现 **Remove key**。
3. key 不得出现在 Notice、Console、Needs attention 或
   `test-vault/.obsidian/plugins/omd-home/data.json`。
4. 点击 **Check setup**。若还未选 model，应先加载 model catalog，并提示选择 model。
5. 选择 model 后再次点击。成功信息应显示 provider、model、destination，并再次说明 hosted
   Vault Q&A 仍未开启。

**Windows/Linux 环境变量路径**

1. 确认 Settings 不显示 secret input、**Save key** 或 **Remove key**，而是显示当前 provider
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

#### C. 移除或撤销 key

1. macOS Keychain 路径点击 **Remove key**，再点 **Check setup**，应回到 credential missing。
2. Windows/Linux 环境变量路径不能由插件删除。完全退出 Obsidian，删除环境变量，重新打开后
   点 **Check setup**，应回到 credential missing。
3. UI 必须准确说明 key 来源，不能在环境变量路径上假装已经保存或能够删除凭证。

#### D. 云回答拒绝与 billing 边界

1. 保持该 provider 选中，在 Home 输入 `@What is in my vault?`。
2. 确认在 retrieval 前 fail-closed，不显示 sources，也不自动切换 provider。
3. 确认 UI 没有暗示 ChatGPT Plus/Pro 或 Claude consumer subscription 包含 API 额度。

通过条件：credentials 不写入插件设置；macOS 只通过 Keychain 提供 in-app Save/Remove；
Windows/Linux 只显示环境变量路径；Check setup 只做认证/model catalog；真实 Vault Q&A 仍被
阻止；错误不泄漏 secrets。

### AI-05：Provider 切换、每个 provider 的 model 记忆与本地工作流隔离

1. 为至少三个 provider 分别选择不同 model ID。
2. 按 `Ollama on this computer → OpenAI API → Anthropic API → Ollama Cloud → Ollama on this computer`
   切换，再确认每个 provider 恢复自己的 model，不把一个 provider 的 ID 带到另一个。
3. 在 hosted provider 下展开 **Advanced AI controls**。确认：
   - Hybrid retrieval 与 embedding model 仍明确标注为本地；
   - Enrichment model、capture polish model、links 和 tags 仍只使用 loopback Ollama；
   - Answer provider 不会改变 capture/enrichment 的 provider。
4. 在 hosted provider 选中时运行一次 **Suggest links and tags** 或 capture polish。若 Ollama
不是 local-only，必须被阻止；若 local-only，仍使用本地 model，并进入 review-first 流程。
5. Reload plugin 后重复步骤 2，确认 model memory 持久化，但 API key 不在 `data.json`。

通过条件：没有跨 provider model 污染、fallback 或隐藏 egress；回答 provider 与本地
capture/enrichment 的职责边界清楚。

### AI-06：Command Palette 诊断、后台任务与 Cancel

前置：选择 **Ollama on this computer**，完成 AI-02 并恢复 `cloud.disabled: true`。

1. Command Palette 依次运行：
   - **OMD Home: Refresh local AI models**
   - **OMD Home: Check local AI connection**
   - **OMD Home: Smoke local AI: Vault question**
   - **OMD Home: Smoke local AI: Note enrichment**
   - **OMD Home: Smoke local AI: Capture polish**
   - **OMD Home: Test local AI embeddings**
2. Smoke 只发送 synthetic prompt，不读取或写入 Vault。记录每项 latency 和结果。
3. 启动较慢的 Smoke 或 embedding test，切离 Settings 并关闭 OMD Home tab，但不要 disable
   plugin。任务应继续，由 plugin-level state 持有。
4. 重开 Home 或 Settings，确认任务完成或仍显示运行状态。
5. 再启动一个任务并点 **Cancel**。
6. 在任务进行中修改 provider、endpoint 或 model。旧 tuple 的完成结果不得覆盖新设置。
7. 最后在 Community plugins disable/reload OMD Home；运行中的 request/child process 必须取消。

通过条件：低频诊断不占据主设置页；后台切 tab 不取消；显式 Cancel 与 unload 会取消；无未处理
Promise rejection 或僵尸进程。

### AI-07：本地 Omnibox 结果、证据、复制与返回用时

1. 选择 **Ollama on this computer**，使用已通过 AI-02 的 text model。
2. Python executable 与 bridge override 都留空。
3. 在 Home 输入一个能命中测试笔记的问题。
4. 确认回答出现在独立结果区域，不与 Home widgets 重叠。
5. Header 显示 provider/model、source 数、Sparse 或 Hybrid，以及 **Returned in …**。
6. 点击 **Copy result**，粘贴到临时 Markdown 笔记。
7. 复制内容应包含完整回答与去重后的 `Sources:`，来源使用 Obsidian wiki links。
8. Copy 按钮短暂变成 **Copied**；键盘也能触发。
9. 滚动长结果，切换 light/dark theme，再关闭结果；widgets 应自然回流。
10. 重复一次问题，确认不存在 `[S#]` 或 `[E#]` placeholder。

通过条件：Copy 不修改原笔记；时间从用户提交问题开始计算到最终结果；中文及含空格路径可
准确恢复；错误显示在结果区并同步到带时间戳的 Needs attention。

### AI-08：新的 Section-aware Vault Q&A benchmark

这些 fixtures 是原创 synthetic Markdown，不依赖旧的 bouldering captures。先从源码目录执行：

```bash
cd "/Volumes/Transcend_q/APPS/AI/omd-home"
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark"
mkdir -p "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Calendar/Events"
cp "docs/benchmark-vault/Sources/Benchmark/8 Balcony Tomato Tips for Small-Space Beginners.md"    "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Sources/Benchmark/阳台番茄新手常见三个错误.md"    "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Sources/Benchmark/Hydroponic Lettuce Yield Log.md"    "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Sources/Benchmark/"
cp "docs/benchmark-vault/Calendar/Events/2026-09-18-garden-swap.md"    "/Volumes/Transcend_q/APPS/AI/omd-home/test-vault/Calendar/Events/"
```

确认四个文件出现在 Vault。前两篇是 ground truth；lettuce log 与 calendar event 是 distractors。
评分细则位于 `docs/benchmark-vault/benchmark-cases.md`。

选择本地 provider，依次运行：

1. **B01**，连续三次：
   `@How many explicit beginner tomato tips are present? List each once.`
   必须回答 8 项，只引用 tips note。
2. **B02**：
   `@Which note contains explicit tomato tips, and which note contains three mistakes?`
3. **B03**：
   `@What are the three beginner mistakes, and what should the grower do instead?`
4. **B04**：
   `@Which recommendations overlap across both tomato notes? Cite each overlap.`
   overlap 应包括 deep watering、direct sun、early support，并引用两篇来源。
5. **B05**：
   `@Combine the advice from both tomato notes. Separate explicit tips from lessons inferred from mistakes, and remove duplicates.`
6. **B06**：
   `@What exact fertiliser grams per plant do these tomato notes recommend?`
   证据没有 grams per plant，必须明确 abstain。
7. 每次记录：回答、Copy result、sources、retrieval mode、warnings、elapsed time、4 分制得分。
8. B01/B02/B03/B04/B06 必须 4/4；B05 至少 3/4。任何 distractor citation、编造 fertiliser
数值或 placeholder 泄漏都是 release blocker。

通过条件：section evidence 不退化成 title-only；计数、分类、overlap 与 abstention 正确；
sources 精确且不包含 distractors。

### AI-09：Multilingual hybrid retrieval 与 semantic rerank

1. 准备本地 embedding model：

```bash
ollama pull bge-m3
```

2. 在 **Advanced AI controls → Vault retrieval** 开启 **Hybrid retrieval**，Embedding model
选择 `bge-m3`，先关闭 **Semantic rerank**，点击 **Test embeddings**。
3. 测试必须返回同维度且大于 0 的 vectors；不得 auto-pull、接受 remote-backed model 或把
vector 写进 note/frontmatter。
4. 连续三次运行 **D01**：
   `@这些阳台番茄笔记给新手哪些建议？`
5. 运行 **M01**：
   `@Summarise the tomato mistakes in Chinese, then restate the fixes in English.`
6. 每次应命中相应 tomato notes，不引用 lettuce/calendar；header 显示
**Hybrid · bge-m3**。
7. 开启 **Semantic rerank**，重复 D01 与 B04。顺序可变，但不得引入 distractor 或移除正确
overlap evidence。
8. 关闭 Hybrid，再问 D01。Header 应显示 **Sparse** 且不发 embedding request；之后恢复。
9. 可选：暂时让 embedding model unavailable。回答应降级为 Sparse 并显示明确 warning，而不是
完全失败。恢复 model 后再次 **Test embeddings**。
10. 修改一篇 fixture 后重问，再撤销测试修改。已变更 note 应重新 embedding，未变更 note 可复用
cache；query embedding 不持久化。

通过条件：embedding traffic 只到默认 loopback Ollama；cache 在 Vault 笔记之外并按 model
digest 隔离；missing、timeout、malformed 或 dimension mismatch 都安全降级为 Sparse。

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
重复出现。
8. 重载 plugin，确认 provider/model memory 仍在；进行中的网络 request 和 child process 已取消。
9. 检查 Console，不得有 secret、Vault excerpt、未处理 rejection 或重复 interval/listener。

通过条件：恢复路径可完成；错误归属和时间清楚；reload/unload 后没有 stale ready state、僵尸
process 或跨 provider 反馈。

## 7. Commands

### CMD-01：Obsidian core/community commands 与 Recorder

1. 在 Home 点击 **Commands**，搜索一个 Obsidian core command 并运行。
2. 启用一个提供无害 command 的 community plugin，再搜索运行。
3. 启用 Obsidian 自带 Recorder，reload OMD Home。
4. 确认有准确 toggle 时显示 Recording；只有 Start/Stop command 时分别显示，不猜测状态。
5. 在 omnibox 或 Command palette 搜索并运行：
   - **OMD Home: Refresh local AI models**
   - **OMD Home: Check local AI connection**
   - **OMD Home: Smoke local AI: Vault question**
   - **OMD Home: Smoke local AI: Note enrichment**
   - **OMD Home: Smoke local AI: Capture polish**
   - **OMD Home: Refresh macOS calendars**

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

### CAL-01：Start / End 与 All day

1. 用 **OMD Home: Create event** 或 Calendar 中的 **New event**。
2. 输入 title。
3. Start/End 使用本地 `datetime-local` 控件；确认时区和可读性。
4. 创建一小时的同日 event，保存并重新打开。
5. 开启 **All day**；Start/End 应切换为 date。
6. 保存再打开。

通过条件：End 始终晚于 Start；同日 timed event 转 all-day 后，End 是排他的下一日；无效范围
不能保存并显示明确提示。

### CAL-02：Vault / Calendar / Linked filters

先在同一可见日期范围准备：

- Vault-only：New event 的 Destination 选 **Vault note only**。
- Linked：选择 **Vault + <default calendar>**。
- Calendar-only：直接在 macOS Calendar 创建，Refresh 后显示。
- 如果外部 event 为 read-only，可用 **Create linked vault note** 建立 linked note，但不能
  修改外部 calendar。

然后：

1. 切到非当前月份或 Week view。
2. 分别点击 Vault、Calendar、Linked filter。
3. 观察 pressed state 和 event 消失/出现。
4. 尝试关闭最后一个仍启用的 source。

通过条件：filter 立即生效且不重置当前日期/view；至少保留一个 source enabled。

### CAL-03：Linked sync 与双向冲突

1. Settings 中已选择 writable default calendar。
2. 创建一个 **Vault + <default calendar>** event。
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

### CAP-01：URL、普通路径、空格路径与拖放

1. 用一个公开、允许测试的网页 URL，点击 **Capture URL or file**，粘贴 URL 并提交。
2. 选择一个小型本地文件，用普通绝对路径 capture。
3. 使用真实 `~/Desktop/example.pdf`；插件应展开 `~/`。
4. 使用包含空格的真实路径，例如
   `/Users/example/data\ science/survival\ analysis.pdf`。
5. 把本地文件拖到 Home omnibox，再拖到 Capture dialog。
6. 输入不存在的路径，确认错误显示准确 missing path。
7. 关闭 capture polish，把 Ollama host 临时设为 `http://localhost:9999`，再 capture 一个
   小文件；完成后恢复 host。

通过条件：有效 URL/文件都到达 OMD；空格路径被还原但不通过 shell 执行；missing path 有具体
错误；capture polish 关闭时，普通 non-AI capture 不因无效 Ollama host 被阻止。

### CAP-02：本地 AI 生成 links/tags，Review 后才写入

1. 开启 **Suggest links and tags after capture**。
2. Capture 一份测试文档，等待 proposal。
3. Proposal 出现后先检查目标 note hash/内容未改变。
4. 查看 existing/new tag、links、concepts 和 warnings。
5. 取消选择至少一个建议，再点击 **Apply**。
6. 确认只写入已选 links/tags，并设置 `omd_home_status: reviewed`。
7. 再打开 Capture，确认 toggle 记住上次选择。
8. 在 Generate 与 Apply 之间修改目标 note；Apply 应提示 conflict，不能覆盖新修改。

通过条件：Generate/Review 阶段零写入；新 tags 默认 unchecked；Apply 可选择；失败不声称成功，
frontmatter 失败时回滚或明确报告 recoverable partial failure。

### CAP-03：失败归属与 Setup health

1. 提交不存在的本地路径。
2. 展开 **Advanced OMD paths**，在 OMD executable override 填不存在路径，点击 **Check again**。
3. 改为旧版/不支持 enrich_note 的 OMD，再点 **Check again**。
4. 点击 **Use automatic** 恢复正确 OMD。
5. 从 Home 触发一次 Ollama local AI failure。

通过条件：Current task 回到 idle；Needs attention 只显示一条 timestamped failure，包含安全的
source/detail/Retry；missing 与 old executable 不混淆；同一错误不同时重复出现在多个 panels。

### CAP-06：后台继续、unload 和退出取消

1. 启动一个故意较慢的 capture，确认 Current task 显示 active。
2. 切到另一 Obsidian tab，至少等待 30 秒。
3. 只关闭 OMD Home tab，不 disable plugin。
4. 从 ribbon 重新打开 OMD Home。

预期：capture 继续；重新打开后显示当前状态或完成 note。“后台”指隐藏/关闭 view，不是 disable
插件。

5. 再启动慢 capture，在 Community plugins disable/reload OMD Home。
6. 重复一次并在任务 active 时完全退出 Obsidian。

通过条件：plugin unload/quit 会取消 child process；重开后没有 orphan task、stale active state
或 partial success。只有明确测试用户取消时才点击 Cancel。

## 10. Release bundle

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

- 恢复 AI-02 备份的 Ollama `server.json`。
- 恢复删除的模型或记录未恢复原因。
- 删除 disposable vault，或明确标记它不能作为日常 vault。
- 需要保留旧设置时，从 vault 外备份恢复 `data.json`。
- 只有 Core 全部 PASS、必要 Extended 通过且 release checklist 完成后，才推 matching tag、
  创建 GitHub Release 并提交 Obsidian Community directory。
