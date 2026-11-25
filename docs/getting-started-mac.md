# 在 Mac 上安装并完成第一次 Capture

[返回 OMD Home 首页](../README.md) · **简体中文** · [English](getting-started-mac.en.md)

先完成一个可以检查的流程：**安装 Obsidian 插件 → 安装 OMD 转换后端 → 把网页或文件保存成 Markdown → 在 Inbox 打开结果**。之后按需增加转录、AI 或 Apple Calendar。

本指南对应 **OMD Home 0.2.2 + [OMD 0.3.0b5](https://github.com/omd-local/markdown-everything/releases/tag/v0.3.0b5)**。两个项目的公开 `main` 已同步这次发布的源码；下面用固定 tag 和下载链接复现这个版本。插件、后端、模型和 Calendar helper 分别安装。OMD 的浏览器 UI 暂未发布；使用 Obsidian 的 OMD Home 即可。

## 1. 检查 Mac 并准备 Vault

1. 在 **Apple menu → About This Mac** 查看系统和 **Chip / Processor**。本指南 Homebrew 路线以 **Apple Silicon、macOS 15 或以上**为受支持环境；Homebrew 将 Intel 列为 Tier 3。旧系统和 Intel 的安装体验不在本指南保证范围内。见 [Homebrew 系统要求](https://docs.brew.sh/Installation)。
2. 从 [Obsidian 官网](https://obsidian.md/download)安装桌面版 **1.11.4 或以上**；在 **Settings → General** 查看版本。
3. 用 **Create new vault** 创建 `OMD Demo`，保存在自己的 Documents 文件夹，再打开一次，让 Obsidian 建立 `.obsidian`。

本文以 `~/Documents/OMD Demo` 为例。`~` 是你自己的用户目录；位置不同时换成自己的 Vault 路径。Vault 就是保存笔记的普通文件夹。

**升级已有 Vault：**先备份整个 Vault，停止 Capture，停用插件，另存 `.obsidian/plugins/omd-home/` 文件夹。更新只替换下面三个文件，**保留原来的 `data.json`** 和笔记；该文件保存插件设置。不要用演示设置覆盖已有资料库。

## 2. 下载三个插件文件

打开 [OMD Home 0.2.2 发布页](https://github.com/omd-local/obsidian-omd-home/releases/tag/0.2.2)，下载 **Assets** 中三个文件：

| 必需文件 | 固定版本下载 |
|---|---|
| `main.js` | [Download main.js](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/main.js) |
| `manifest.json` | [Download manifest.json](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/manifest.json) |
| `styles.css` | [Download styles.css](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/styles.css) |

三个文件必须来自同一版本。保留原文件名，避免 `.txt` 或 `(1)` 后缀。**Source code (zip)** 是源码，不能直接当插件安装。三个文件不包含 OMD、Python、Whisper、Ollama 或 Calendar helper。

## 3. 放进隐藏的插件文件夹

1. 在 **Finder** 按 **Command–Shift–G** 打开 **Go to Folder**，输入：

   ```text
   ~/Documents/OMD Demo/.obsidian/
   ```

2. 在 `.obsidian` 内找到或新建 `plugins`，再在里面新建 `omd-home`。
3. 把三个文件直接放进 `omd-home`：

   ```text
   OMD Demo/
   └── .obsidian/
       └── plugins/
           └── omd-home/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

   已有的 `data.json` 留在这里。不要多套一层 `omd-home/omd-home/`，也不要放整个源码目录。
4. 在 Obsidian 打开 **Settings → Community plugins**。如有 **Turn on community plugins**，信任插件后启用；刷新列表，必要时退出并重开 Obsidian。
5. 在 **Installed plugins** 启用 **OMD Home**。按 **Command–P**，运行 **OMD Home: Open home**。

看到 Home 页面说明插件已启用；Capture 还需要后端。

## 4. 安装 OMD 后端

打开 **Terminal**：

```bash
brew --version
```

若找不到 `brew`，按 [Homebrew 官方页面](https://brew.sh/)安装，完成安装器的 **Next steps**（包括 `brew shellenv`），再新开 Terminal 检查。使用内部磁盘的标准安装位置，避免外置盘、网络盘或受保护的 Documents 等目录。配方需要源码构建工具；如提示缺少 Xcode Command Line Tools，运行并完成系统安装后继续：

```bash
xcode-select --install
```

每次复制一行并按 Return：

```bash
brew install omd-local/omd/omd
omd --version
omd doctor
omd capabilities --json
```

应看到 **0.3.0b5**。配方同时安装 Python 3.12、ffmpeg/ffprobe、Tesseract、OCR 语言包和 yt-dlp；无需另装 Python。见[公开配方](https://github.com/omd-local/homebrew-omd/blob/main/Formula/omd.rb)。Whisper 程序和模型、Ollama、cookies、Calendar helper 按需另装。

已有旧版时运行：

```bash
brew update
brew upgrade omd-local/omd/omd
omd --version
omd capabilities --json
```

回到 **Settings → OMD Home → OMD**，点 **Detect OMD** 或 **Check again**。b5 提供本次 Mac 工作流使用的语言、社交抓取及本地 Ollama 接口；具体可用性仍取决于 capability 检查和外部工具。`doctor` 中缺少可选 AI 或转录工具不代表网页转换不可用。

自动发现失败时运行：

```bash
printf '%s\n' "$(brew --prefix omd-local/omd/omd)/bin/omd"
```

将输出的完整绝对路径填到 **Advanced OMD paths → OMD executable override**，再检查。使用本机输出，不复制别人的 `/Users/...` 路径。Python 和 bridge override 通常留空，使用后端环境与插件自带 bridge。

**Copy install commands** 只复制，**Install guide** 只打开说明，插件不会执行安装。更新 tap 取得公开发布版，不包含未发布实验。

## 5. 确认语言与首次 Capture 选项

打开 **Settings → OMD Home → OMD → Recognition defaults**。新 Vault 默认 **Image text language: English**、**Speech language: Auto-detect speech**；b5 可直接使用，**无需按旧 b4 指南清除两项偏好**。

中文 OCR 可选简体或繁体加英文；语音可自动检测或明确选 English / Chinese。OCR 影响支持的图片文字识别，不翻译正文，也不代表普通 PDF 会自动 OCR。单次 Capture 改语言只作用于该项，Retry 保留该项选择。

首次基础测试在 **Capture URL or file** 关闭 **Polish Markdown** 和 **Review links and tags**，先验证转换，无需先装 Ollama。这是选装 AI 工作，不是新后端的兼容补丁；AI 检查通过后可开启。提交 Capture 才保存本次开关选择，取消不保存。

## 6. 完成第一次 Capture

1. 在 Home 点 **Capture URL or file**，或运行 **Command–P → OMD Home: Capture URL or file**。
2. 填无需登录的简单网页，如 `https://example.com/`；或拖入小型本地 HTML 或 PDF 文件、粘贴完整路径。一次一个来源。
3. 保持两项 AI 开关关闭，点 **Capture**。
4. **Current task** 在执行时显示进度；快任务可能一闪而过。完成后到 **Inbox** 打开 Markdown，确认正文和原始来源。

**在 Inbox 能打开生成笔记才算完成。**文件通常在 `Sources/<source type>/`，旁边有 `.omd.json` 元数据。Capture 立即写入新笔记；可选链接标签建议按 **Apply** 才写入，**Done reviewing** 才标记 Reviewed。

网页抓取需要访问来源网站；本地文件无需访问来源网站。失败时看 **Needs attention**，修复后 **Retry capture**。首次检查避免需登录、频繁限流或很长的视频。

## 7. 选装：Apple Silicon 本地语音转录

需要 **Apple M 系列芯片**；MLX 不是 Intel 路线。基础后端已有 ffmpeg，但没有 Whisper 程序和模型。

```bash
brew install pipx
pipx install --python "$(brew --prefix python@3.12)/bin/python3.12" mlx-whisper
pipx ensurepath
```

按提示新开 Terminal，再检查：

```bash
command -v mlx_whisper
omd doctor
```

用自己有权使用的 **10–30 秒本地音频**，通过 OMD Home 的 **Capture URL or file** 测试。保持 **Auto-detect speech**，关闭两项 AI 开关；等 Inbox 出结果，打开笔记并核对转录文字。

**必须测试 OMD 自己的流程。**默认模型是 `mlx-community/whisper-large-v3-turbo`，首次需联网下载并准备足够磁盘空间。单独运行 `mlx_whisper` 默认示例可能下载另一个 tiny 模型，不能证明 OMD 模型已就绪。演示前先成功完成真实 Capture。原始转录无需 Ollama，AI 整理另配。见 [mlx-whisper 官方说明](https://pypi.org/project/mlx-whisper/)。

**Intel Mac：**本指南未验证其完整 Home 转录安装路线。不要安装 MLX 后预期同样效果；先演示网页或文档，参考 [OMD 转录与手动安装说明](https://github.com/omd-local/markdown-everything#quick-start)选择适合平台的方案。

## 8. 选装：本地 AI、格式整理和语义检索

1. 从 [Ollama 官网](https://ollama.com/download)安装 Mac app，放进 **Applications** 并打开，完成 CLI 设置，保持 app 运行。当前要求 macOS 14+；Apple M 支持 CPU/GPU，Intel 使用 CPU。见[系统说明](https://docs.ollama.com/macos)。
2. 下载本地文本模型，例如：

   ```bash
   ollama pull qwen3:4b-instruct
   ollama list
   ```

3. 在 **Settings → OMD Home → AI answers** 选 **Ollama on this computer**、已下载模型，再 **Check setup**。列表未刷新时运行 **OMD Home: Refresh local AI models**。下载大小和速度取决于机器；下载完成不等于每项工作流都检查通过。
4. 在 **Advanced AI controls → Local writing tools → Local writing model** 选本地文本模型并完成检查。它用于 **Improve formatting**、**Polish Markdown** 和 **Review links and tags**，不使用云端 answer provider。先对测试笔记预览格式建议，再决定 **Apply**。
5. 要语义检索时再装独立的 embedding model：

   ```bash
   ollama pull bge-m3
   ```

   在 **Advanced AI controls → Vault retrieval** 选 `bge-m3`，按 **Test semantic search**。也可明确点击 **Install bge-m3** 下载；打开设置不自动下载。只需关键词时关闭 **Keyword + semantic search**，无需 embedding model。语义检索失败会标明关键词回退。
6. 在 Home omnibox 输入 `@` 和能从测试笔记回答的问题，检查引用并打开原笔记。Vault Q&A 只读。

保留默认 endpoint `http://localhost:11434` 即可。手动地址只接受本机 loopback 主机和明确端口，需 **Save endpoint** 再检查。模型出现在列表也可能不兼容特定功能。

本地模型不要求关闭全部 Ollama cloud 功能。若希望 Ollama 自身进入 local-only，按[官方说明](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features)在 `~/.ollama/server.json` 保留其他设置并加入 `"disable_ollama_cloud": true`，退出再重开 Ollama。这也会禁用 Ollama Cloud。

## 9. 选装：云端答案

云端答案需独立账号或开发者 API 权限，可能计费；本地 Capture、原始转录、本地写作不需要它。

| Provider | 配置与检查 |
|---|---|
| **Ollama Cloud** | 运行 `ollama signin`，按[官方 Cloud 说明](https://docs.ollama.com/cloud)准备云模型；在 AI answers 选择 Ollama Cloud、Check setup 和模型。须关闭 Ollama local-only 模式。 |
| **OpenAI API / Anthropic API** | 在对应密码框填真实开发者 API key，点 **Save & check** 存入 macOS Keychain，再选择列出的模型。ChatGPT / Claude 订阅不等于 API 余额。 |
| **DeepSeek API** | 此次 b5 验证策略尚未放行；即使界面有选项也会拒绝请求，不作为可用演示路线。 |

开启所选 provider 的 **Allow … answers** 后，每次仍需查看目的地、模型和有限证据片段，明确确认才发送；取消不发送，也不自动换 provider。只发送问题和批准片段，检索仍在本地。格式整理、链接标签建议和 embedding 仍用本地 Ollama。

## 10. 选装：抖音或小红书来源

b5 支持 Capture 中含**恰好一个 HTTP(S) URL** 的抖音或小红书 / Rednote 分享文字。普通网页只贴 URL，不支持一次多个来源。平台可能要求登录或限制抓取，不保证每个帖子可用。

需要登录时，用自己账号导出的 Netscape 格式 `cookies.txt`，在 **Settings → OMD Home → OMD → Social capture access** 或 Capture 的 **Site access** 填对应平台绝对路径。两个平台分别配置，不互相替代。只保存路径；本地 OMD 会把匹配的 cookie 发送到获准的来源平台 HTTPS 请求，不会发给 AI provider。不要把 cookie 文件提交到 Vault、GitHub 或问题报告。先用自己浏览器能打开的短公开内容测试；视频转录仍需第 7 节的程序和模型。

## 11. 选装：Apple Calendar

Vault 内的 Markdown 事件无需 helper。同步 Apple Calendar，以及已加入 macOS Calendar 的 Google / Outlook 账户，需要 **macOS 14+、独立 EventKit helper、Calendar 权限和明确选定的日历**。三个标准插件文件不含 helper。

目前从同一插件 tag 本机编译。先有最新 Xcode Command Line Tools（`xcode-select --install`，已装则不重复），用 `swift --version` 确认 **Swift 6 或以上**，然后：

```bash
brew install node
mkdir -p ~/Developer
cd ~/Developer
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git omd-home-0.2.2
cd omd-home-0.2.2
npm ci
npm run build:eventkit
```

同名目录已存在时换一个新的名字，不覆盖。成功后有 `dist/omd-eventkit`。复制到实际 Vault 的 `.obsidian/plugins/omd-home/omd-eventkit`，本例为：

```bash
cp dist/omd-eventkit "$HOME/Documents/OMD Demo/.obsidian/plugins/omd-home/omd-eventkit"
```

保留可执行权限。也可留在固定位置，在 **Settings → OMD Home → Calendar → Advanced Calendar helper** 填完整绝对路径；不要填源码或 `dist` 文件夹。

回 Calendar 设置点 **Refresh calendars**，在 macOS 提示时授予权限；只打开允许 OMD 读取的日历，选一个可写 **Default calendar**。先建测试事件，核对 Vault 和指定日历。双方都改动时需选择保留哪边；首次不要用重要日历。拒绝权限后可到 **System Settings → Privacy & Security → Calendars** 调整。

## 12. 升级、备份与演示前检查

插件更新保留 `data.json`，只替换同版本三个文件；helper 有更新时另行构建替换。后端用第 4 节的 Homebrew upgrade。重开 Obsidian，重新检查 OMD 及所用 AI / Calendar。回退时停用插件，恢复备份的文件和设置，不删除笔记。

| 演示项目 | 完成标志 |
|---|---|
| 基础 Capture | 简单网页和本地 HTML／PDF 都能在 Inbox 打开，来源正确 |
| 转录（若使用） | 实际 OMD Capture 已下载所用模型，短音频文字已人工核对 |
| 本地 AI（若使用） | Check setup 通过，答案引用能打开，修改先预览 |
| Calendar（若使用） | helper 可执行、权限通过、仅选定日历参与，测试事件可核对 |

演示前完成模型下载和系统授权；仅看到 Home 或 doctor 不代表选装功能全部可用。

## 常见问题

| 情况 | 下一步 |
|---|---|
| Installed plugins 没有 OMD Home | 查文件名、当前 Vault、文件夹层次，重开 Obsidian |
| Terminal 找不到 brew | 完成官方 Next steps / shellenv，新开 Terminal；不用 `sudo brew install` |
| OMD 未发现或仍是 b4 | brew update / upgrade，检查实际 executable override，再 Check again |
| recognition preference / hardened local Ollama transport 检查失败 | 确认实际用 b5 及其 capabilities；旧 b4 临时基础抓取可清除两项语言偏好并关闭两项 AI，完整流程仍需升级 |
| OCR 语言包缺失 | `tesseract --list-langs` 检查，安装所需包；b5 不会补齐缺失外部工具 |
| mlx_whisper 不可用 | 查 Apple Silicon、pipx 路径和 doctor；重开 Obsidian，再做真实短音频 Capture |
| AI 模型或连接失败 | 打开 Ollama，查 `ollama list`，Refresh local AI models，再 Check setup；文本与 embedding 分别检查 |
| DeepSeek 被拒绝 | 本次策略未放行，改用已验证 provider 或本地 Ollama |
| 完成后 Current task 消失 | 卡片只显示执行中工作，到 Inbox 打开结果 |
| 网页 403 / 需登录 | 换公开页、检查相应平台配置，或 Capture 自己获准保存的本地副本 |
| Calendar 无结果 | 查 helper 可执行文件、权限、Refresh calendars 及选定日历 |

反馈提供插件和 OMD 版本、capabilities、Mac 芯片、操作及错误文字即可；无需整个 Vault、API key 或 cookie 内容。

## 开发者：固定版本源码构建

普通用户无需构建。复现 **0.2.2** 时准备 Git、Node.js/npm，然后：

```bash
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

结果仍是三个插件文件，不安装后端或模型。公开 main 与本次发布同步，未来仍会变化；固定 tag 方便复现。桌面验收见 [0.2.2 manual test plan](https://github.com/omd-local/obsidian-omd-home/blob/0.2.2/docs/manual-test-plan.md)。
