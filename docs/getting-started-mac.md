# 在 Mac 上安装并完成第一次 Capture

[返回 OMD Home 首页](../README.md) · **简体中文** · [English](getting-started-mac.en.md)

按 **准备 Vault → 安装插件 → 安装 OMD 后端 → 保存第一篇网页** 的顺序操作。**第一次只需完成第 1–6 节**；语音转录、AI 和 Apple Calendar 都是之后的选装项。

本指南对应 **OMD Home 0.2.2 + [OMD 0.3.0b5](https://github.com/omd-local/markdown-everything/releases/tag/v0.3.0b5)**。插件提供 Obsidian 界面，独立后端负责转换；安装插件不会同时安装后端或模型。OMD 的独立浏览器 UI 暂未发布，也不是使用 Home 的前提。

| 你想做什么 | 安装到哪里为止 |
|---|---|
| 先看看 Home、搜索笔记和 Markdown 日历 | 完成第 1 节，再选第 2 或第 3 节安装插件 |
| 把网页或文件保存为 Markdown | 继续完成第 4–6 节 |
| 转录音频、使用 AI、同步 Apple Calendar | 基础 Capture 成功后，再选相应的第 7–11 节 |

## 1. 检查 Mac 并准备 Vault

1. 点屏幕左上角 **苹果菜单 → 关于本机（About This Mac）**，查看芯片和 macOS 版本。本指南的 Homebrew 路线适用于 **Apple Silicon（M 系列芯片）、macOS 15 或以上**。Intel 或更旧系统请先查 [Homebrew 系统要求](https://docs.brew.sh/Installation)，不要照搬本指南的 Apple Silicon 路径。
2. 已安装 Obsidian 时直接打开。尚未安装时，从 [Obsidian 官网](https://obsidian.md/download)下载 Mac 版，打开下载文件，把 Obsidian 拖到 **Applications / 应用程序**，再从应用程序打开。需要桌面版 **1.11.4 或以上**。
3. **已有 Vault：** 打开自己打算使用 OMD 的资料库。插件是按 Vault 安装的，要始终在同一个 Vault 中操作。
4. **第一次用 Obsidian：** 在资料库管理窗口找到 **Create new vault → Create**，名称填 `OMD Demo`，点 **Browse** 选择自己的 Documents 文件夹，再点 **Create**。已在笔记界面时，可从左下角资料库菜单进入 **Manage Vaults…**。详见[官方资料库说明](https://obsidian.md/help/manage-vaults)。

Vault 就是保存笔记的普通文件夹。打开它后，Obsidian 会创建隐藏的 `.obsidian` 设置目录；**你不需要自己创建这个隐藏目录**。下面推荐的 BRAT 路线完全不需要找它。

本文保留英文按钮名称，方便对应 OMD 当前界面。**Settings / 设置** 可点 Obsidian 左下角齿轮或按 **⌘,** 打开；**⌘** 是 Command，**⇧** 是 Shift，Return 是回车键。

## 2. 推荐：用 BRAT 安装插件，不用找文件夹

<a id="install-plugin"></a>

[BRAT](https://community.obsidian.md/plugins/obsidian42-brat) 是另一个第三方社区插件，作者是 **TfTHacker**。它替你下载并放好 OMD Home 文件。**OMD Home 目前尚未上架社区目录，因此这里先搜索 BRAT，再由 BRAT 安装 OMD Home。** 不想安装 BRAT 时，直接用[第 3 节的手动方法](#manual-install)；两种方式选一种即可。

1. 在目标 Vault 打开 **Settings → Community plugins / 社区插件**。如果看到 **Turn on community plugins / 启用社区插件**，先阅读提示并开启。
2. 点 **Browse / 浏览**，搜索 `BRAT`，确认作者为 **TfTHacker**，点 **Install / 安装**，完成后点 **Enable / 启用**。
3. 回到设置，在左侧找到 **BRAT**。找不到时，在 Community plugins 的已安装列表中找到 BRAT，点它的齿轮按钮。
4. 点 **Add beta plugin / 添加 Beta 插件**，把下面这行粘贴到仓库地址输入框：

   ```text
   https://github.com/omd-local/obsidian-omd-home
   ```

5. 点输入框外，等仓库检查和版本列表加载。在 **Select a version / 选择版本** 中选 **0.2.2**，不加 `v`。这是公开仓库，**GitHub token 可以留空，不需要注册 GitHub 账号**。
6. 勾选 **Enable after installing the plugin / 安装后启用此插件**，点 **Add plugin / 添加插件**，等待完成。若没有自动启用，回 **Community plugins → Installed plugins**，刷新列表并打开 **OMD Home** 的开关。
7. 关闭设置，按 **⌘P**，输入 `OMD Home: Open home`，点该命令。

**完成标志：** 看到 OMD Home 页面。接下来[直接去第 4 节](#install-backend)，不用再做第 3 节。插件此时可以打开，但 Capture 仍要安装后端。

选择 **0.2.2** 会固定这个版本，不会自动升级 OMD Home。BRAT 的 **Latest version** 选项和更新检查属于另一种更新方式；不要在首次安装时误选。BRAT 也不会替你安装后端、模型或 Calendar helper。遇到 GitHub 请求额度限制时，可以稍后重试或改用手动方法，不必为了首次安装创建 token。参考 [BRAT 作者指南](https://tfthacker.com/brat-quick-guide)。

## 3. 备用：手动下载并安装插件

<a id="manual-install"></a>

**已经通过第 2 节看到 Home？跳过本节。** 如果是在已有 Vault 升级，先按[第 12 节](#12-升级备份与演示前检查)备份并停用插件，保留原来的 `data.json`。

### 3A. 下载三个文件

打开 [OMD Home 0.2.2 发布页](https://github.com/omd-local/obsidian-omd-home/releases/tag/0.2.2)，展开页面下方的 **Assets**，分别点击这三个文件；也可以直接用下表链接。文件通常出现在 Finder 的 **Downloads / 下载** 中。

| 必需文件 | 下载 |
|---|---|
| `main.js` | [下载 main.js](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/main.js) |
| `manifest.json` | [下载 manifest.json](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/manifest.json) |
| `styles.css` | [下载 styles.css](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.2/styles.css) |

**不要选 Source code (zip) 或 Source code (tar.gz)。** 无需解压这三个单独文件，也无需用代码编辑器打开。三个文件必须同版本，名称不能多出 `.txt` 或 `(1)`；Safari 或其他浏览器若给重复下载加了后缀，请先确认并改回上表名称。

### 3B. 从 Obsidian 直接打开安装位置

1. 回到**目标 Vault**，打开 **Settings → Community plugins**，如有需要先开启社区插件。
2. 在 **Installed plugins / 已安装插件** 一行旁找到**文件夹图标** 并点击。Finder 会打开这个 Vault 的插件目录。图标含义见 [Obsidian 官方说明](https://help.obsidian.md/community-plugins)。
3. 在打开的目录中按 **⌘⇧N**，新建一个普通文件夹，名称填 `omd-home`。它已经存在时直接打开，**不要再在里面新建一层同名文件夹**。
4. 在 Downloads 中选中三个下载文件，按 **⌘C**；回到 `omd-home` 文件夹，按 **⌘V**。最终应是：

   ```text
   <your vault>/
   └── .obsidian/
       └── plugins/
           └── omd-home/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

   这是位置示意图，**不要把 `<your vault>` 当作要创建的文件夹名**。已有的 `data.json` 和 `omd-eventkit` 留在原处。
5. 回到 Obsidian 的 Community plugins，点已安装列表旁的**刷新图标**。如仍未出现，按 **⌘Q** 完全退出 Obsidian，再重新打开同一个 Vault。
6. 找到 **OMD Home** 并打开开关。关闭设置，按 **⌘P**，运行 **OMD Home: Open home**。

**完成标志：** Home 页面打开。然后去[第 4 节](#install-backend)。

<details>
<summary><strong>找不到文件夹按钮、plugins 不存在，或 Finder 不显示 .obsidian？</strong></summary>

`.obsidian` 只是默认隐藏，不是不能使用的目录。先让 Obsidian 打开过目标 Vault，再按下面的方法操作：

1. 在 Finder 打开**实际的 Vault 文件夹**；新建示例 Vault 时，就是自己选定的 Documents 中的 `OMD Demo`。
2. 按 **⌘⇧.**（Command、Shift 和英文句号）显示隐藏项目，就能看到 `.obsidian`。打开它。操作完可再按同一快捷键隐藏。
3. 如果没有 `plugins`，在 `.obsidian` **内部** 按 **⌘⇧N** 新建普通文件夹 `plugins`；打开它，再新建普通文件夹 `omd-home`。这两个名字都不以句号开头。
4. 如果已经知道自己的 Vault 路径，也可在 Finder 按 **⌘⇧G**，输入现有设置目录的位置，按 Return。**仅当你确实按示例创建了 Vault** 时，才复制下面这行：

   ```text
   ~/Documents/OMD Demo/.obsidian/
   ```

   `~` 代表你的用户目录；Vault 在别处时要用实际位置。**前往文件夹只打开已存在的目录，不会创建目录。** 找不到 `.obsidian` 时，回 Obsidian 确认打开的是这个 Vault；不要在 Downloads 或另一个资料库里另外创建 `.obsidian`。
5. 回到 **3B 的第 4 步** 复制三个文件。

参考：[Obsidian 设置目录](https://obsidian.md/help/data-storage)、[Apple 的 Finder 快捷键](https://support.apple.com/en-sg/102650)。

</details>

## 4. 安装 OMD 后端

<a id="install-backend"></a>

插件只安装一次；**需要 Capture 才做本节**。Homebrew 会安装 OMD 及其 Python 环境，不用先自己安装 Python。下面是 Apple Silicon、macOS 15+ 的路线。

### 4A. 打开终端，检查是否已有 Homebrew

按 **⌘Space** 打开 Spotlight，输入 `Terminal`，按 Return。下面的代码都粘贴在这个 Terminal 窗口中，**不是 Obsidian 的搜索框、Capture 输入框或设置项**。每次粘贴一个代码框，按 Return；看到命令完成、输入提示符再次出现后，再做下一步。不要把代码框的 `bash` 标记一起输入。

```bash
brew --version
```

看到 `Homebrew` 和版本号，直接跳到 **4C**。找不到 `brew` 时，做 **4B**。

### 4B. 首次安装 Homebrew

1. 在 Terminal 运行：

   ```bash
   xcode-select --install
   ```

   如果系统弹出开发工具窗口，点 **Install / 安装**，等系统明确完成；不必安装整个 Xcode app。若提示工具已安装，继续下一步。
2. 打开 [Homebrew 官网](https://brew.sh/)，选择官网提供的 **.pkg installer**。打开下载的 `.pkg`，按系统安装器继续并安装；要求授权时用自己的 Mac 登录密码。此包的系统要求见 [Homebrew 安装说明](https://docs.brew.sh/Installation)。
3. 包安装完成后，在 Terminal 粘贴下面**整个代码框** 并按 Return。它为 macOS 默认的 zsh 设置 Homebrew 路径，保留原有 `.zprofile` 内容；仅首次安装时做一次。已自行更换 shell 时，按 Homebrew 完成页的 **Next steps** 配置自己的 shell。

   ```bash
   echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
   eval "$(/opt/homebrew/bin/brew shellenv)"
   brew --version
   ```

**完成标志：** 出现 Homebrew 版本号。如果官网下载方式不同，按官方安装器最后显示的 **Next steps** 完成路径设置，再回来运行 `brew --version`；不要用 `sudo brew install`。

### 4C. 安装并连接 OMD

先运行安装命令。它会下载转换工具，可能需要一段时间；等 Terminal 回到可输入状态再继续。

```bash
brew install omd-local/omd/omd
```

然后确认版本：

```bash
omd --version
```

应看到 **0.3.0b5**。配方同时安装 Python 3.12、文档转换所需依赖、ffmpeg/ffprobe、Tesseract、OCR 语言包和 yt-dlp；Whisper、Ollama、模型及 Calendar helper 仍是选装项。见[公开配方](https://github.com/omd-local/homebrew-omd/blob/main/Formula/omd.rb)。

回 Obsidian，打开 **Settings → OMD Home**，向下找到 **Capture and processing**，点 **Detect OMD**（已检查过时叫 **Check again**）。看到 **OMD is ready** 或就绪状态后继续。这里**不是** 上方 AI answers 的 **Check setup** 按钮。

<details>
<summary><strong>版本还是旧的、没检测到 OMD，或需要诊断？</strong></summary>

旧版用下面三行升级，再回 Capture and processing 点 **Check again**：

```bash
brew update
brew upgrade omd-local/omd/omd
omd --version
```

终端版本正确但 Home 找不到时，运行下面一行，复制输出的完整路径：

```bash
printf '%s\n' "$(brew --prefix omd-local/omd/omd)/bin/omd"
```

在 **Capture and processing → Advanced OMD paths → OMD executable override** 中粘贴路径，不加引号。点输入框外，再点 **Check again**。**Python executable override** 和 **OMD Home bridge override** 通常留空；不要复制别人的 `/Users/...` 路径。

需要反馈诊断时再运行：

```bash
omd doctor
omd capabilities --json
```

`doctor` 提到缺少选装 AI 或转录工具，不代表基本网页转换失败。**Copy install commands** 只复制文字，**Install guide** 只打开说明，插件不会替你执行安装。

</details>

## 5. 确认语言与首次 Capture 选项

首次用英文网页测试时，保留语言默认值即可。需要中文图片 OCR 时，在 **Settings → OMD Home → Capture and processing** 展开 **Recognition defaults**，把 **Image text language** 选为简体或繁体加英文。**Speech language** 默认 **Auto-detect speech**，也可明确选 English / Chinese。

OCR 只影响支持的图片文字识别，不翻译正文，也不表示普通或扫描 PDF 会自动 OCR。单次 Capture 改语言只作用于该项，Retry 保留该项选择；b5 不需要旧 b4 的清空偏好补丁。

## 6. 完成第一次 Capture

<a id="first-capture"></a>

1. 关闭设置。按 **⌘P**，输入并运行 **OMD Home: Capture URL or file**；也可以在 Home 点击同名按钮。
2. 在 **URL, share text, or file path** 输入框粘贴 `https://example.com/`。先不要用需登录的网页或长视频。
3. 关闭 **Polish Markdown** 和 **Review links and tags** 两个 AI 开关，其他可选项先留空。这样无需先装 Ollama。
4. 点 **Capture**。这时才会开始处理。**Current task** 只在执行时显示，快任务可能一闪而过。
5. 完成后到 Home 的 **Inbox**，打开新生成的 Markdown，核对正文和来源链接。

**完成标志：在 Inbox 能打开并读到生成笔记。到这里，基础安装已经完成；后面全部按需选择。**

再试本地文件时，从 Finder 把**一个小型 HTML 或 PDF 文件** 拖到 Capture 弹窗里的 **Drop a local file here** 区域，确认路径已填入，再点 **Capture**。不需要手写路径，也没有另一个 Choose file 按钮。每次只提交一个来源。

笔记通常在 `Sources/<source type>/`，旁边有 `.omd.json` 元数据；`<source type>` 是程序生成的分类，不要自己创建同名占位目录。Capture 会立即写入新笔记；可选链接标签建议要按 **Apply** 才写入，**Done reviewing** 才标记 Reviewed。提交才保存本次开关选择，取消不保存。失败时读 **Needs attention**，修复原因后点 **Retry capture**。

## 7. 选装：Apple Silicon 本地语音转录

**基础 Capture 成功后再做。** 需要 Apple M 系列芯片；MLX 不是 Intel 路线。后端已有 ffmpeg，但 Whisper 程序和模型需另外安装。

在 Terminal 运行下面整个代码框，等每行完成：

```bash
brew install pipx
pipx install --python "$(brew --prefix python@3.12)/bin/python3.12" mlx-whisper
pipx ensurepath
```

按提示**关闭这个 Terminal 窗口，再新开一个**，运行：

```bash
command -v mlx_whisper
```

应显示程序路径。然后按 **⌘Q** 退出并重开 Obsidian；无需填写 Whisper 的程序路径。

在 Capture 弹窗的 **Drop a local file here** 区域放入自己有权使用的 **10–30 秒本地音频**，保留 **Auto-detect speech**，关闭两项 AI 开关，再点 **Capture**。默认模型是 `mlx-community/whisper-large-v3-turbo`，第一次使用要联网下载，需磁盘空间和等待时间。**完成标志是 Inbox 笔记中有可人工核对的转录文字**，不是仅看到程序路径。

演示前先成功做一次真实 OMD Capture；单独跑其他 Whisper 示例可能下载不同模型。原始转录无需 Ollama。见 [mlx-whisper 官方说明](https://pypi.org/project/mlx-whisper/)。Intel 用户应参考[后端的其他安装路线](https://github.com/omd-local/markdown-everything#quick-start)，本指南未验证 Intel 的完整转录安装。

## 8. 选装：本地 AI、格式整理和语义检索

1. 从 [Ollama 官网](https://ollama.com/download)下载 Mac app，打开下载文件，把 Ollama 拖进 **Applications**，再从应用程序打开并完成首次设置。若询问安装命令行工具，按提示完成；保持 Ollama 运行。系统要求见 [Ollama Mac 说明](https://docs.ollama.com/macos)。
2. 在**新开的 Terminal** 下载一个本地文本模型：

   ```bash
   ollama pull qwen3:4b-instruct
   ollama list
   ```

   等下载完成并看到模型名称。Terminal 找不到 `ollama` 时，先回 Ollama 完成首次命令行设置，再重开 Terminal；不要更改 OMD 的 Python 路径。
3. 在 **Settings → OMD Home → AI answers**，把 **Answer provider** 设为 **Ollama on this computer**，点 **Check setup** 读取模型，再在答案模型下拉框选已下载模型，重新 **Check setup**。列表仍旧时运行命令 **OMD Home: Refresh local AI models**。
4. 需要格式整理或链接标签建议时，展开 **Advanced AI controls → Local writing tools**，在 **Local writing model** 选文本模型；然后**回上方 AI answers 点 Check setup**。该模型行没有另一个检查按钮。这些写作功能只用本地 Ollama。
5. 需要语义检索时再下载独立 embedding 模型：

   ```bash
   ollama pull bge-m3
   ```

   在 **Advanced AI controls → Vault retrieval** 开启 **Keyword + semantic search**、选择 `bge-m3`，点 **Test semantic search**。也可主动点 **Install bge-m3** 下载；打开设置不会自动下载。只需关键词检索时关闭该开关，无需 embedding 模型。
6. 关闭设置，在 Home 的 omnibox 输入 `@` 和能从自己测试笔记回答的问题。**完成标志：答案有引用，点击引用能打开原笔记。** Vault Q&A 只读；格式整理先在测试笔记预览，再决定 Apply。上述检查通过后，才在下一次 Capture 开启所需 AI 开关。

保留 endpoint `http://localhost:11434` 即可，无需填写 Ollama 程序路径。自定义地址只接受本机 loopback 和明确端口，保存时要点 **Save endpoint**。模型下载成功不代表适合所有功能，按每项检查结果处理。

本地模型不要求关闭全部 Ollama cloud 功能。若希望 Ollama 自身只用本地模型，可另看[官方 local-only 说明](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features)；这个设置会同时禁用 Ollama Cloud，不是本指南的必做项。

## 9. 选装：云端答案

云端答案需要独立账号或开发者 API 权限，可能计费；本地 Capture、原始转录、本地写作不需要它。

| Provider | 操作 |
|---|---|
| **Ollama Cloud** | 按[官方 Cloud 指南](https://docs.ollama.com/cloud)完成 `ollama signin` 和云端模型准备；在 AI answers 选 Ollama Cloud，点 Check setup，再选可用模型。Ollama local-only 不能开启。 |
| **OpenAI API / Anthropic API** | 在 AI answers 选对应 provider，把真正的开发者 API key 粘贴到 **Developer key** 密码框，点 **Save & check** 保存到 macOS Keychain 并检查，再选模型。ChatGPT / Claude 订阅不含 API 额度。 |
| **DeepSeek API** | 本次 b5 策略未放行；即使显示选项也会拒绝请求，不作为可用安装路线。 |

打开当前 provider 的 **Allow … answers** 后，每次提问仍要核对目的地、模型和有限证据片段，再明确同意发送。取消不发送，也不自动换 provider；只发送问题和批准的片段，检索仍在本地。写作、链接标签建议和 embedding 仍用本地 Ollama。

## 10. 选装：抖音或小红书来源

b5 支持含**恰好一个 HTTP(S) URL** 的抖音或小红书 / Rednote 分享文字。普通网页只贴 URL；平台可能要求登录或限制抓取，不保证每个帖子可用。视频转录仍需第 7 节的程序和模型。

需要登录时，用自己账号导出的 Netscape 格式 `cookies.txt`。在 Finder 找到实际文件，右键后按住 **Option**，选 **Copy … as Pathname / 拷贝为路径名称**，就能复制绝对路径；粘贴到设置时不加引号。见 [Apple 的路径复制说明](https://support.apple.com/en-mn/guide/terminal/apd3cf6fe02-3ec8-48f1-951f-866e52955fc8/mac)。

打开 **Settings → OMD Home → Capture and processing → Social capture access**，把路径填进匹配平台的字段；也可用 Capture 弹窗的 **Site access**。两个平台分别配置，不互相替代。只保存路径；本地 OMD 把匹配 cookie 用于获准的来源平台 HTTPS 请求，不会发给 AI provider。不要把 cookie 文件放入 Vault、GitHub 或问题报告。先用自己浏览器能打开的短内容测试。

## 11. 选装：Apple Calendar

**这是进阶选装，不影响基础 Capture 或 Vault 内的 Markdown 日历。** 同步 Apple Calendar，以及已加入 macOS Calendar 的 Google / Outlook 账户，需要 **macOS 14+、独立 EventKit helper、Calendar 权限和明确选定的日历**。BRAT 和三个标准插件文件都不包含 helper。

### 11A. 编译 helper

目前需要在这台 Mac 上从同一 tag 编译。使用第 4B 节的 Xcode Command Line Tools；若跳过了该节且缺少工具，先完成 `xcode-select --install`。在 Terminal 检查：

```bash
swift --version
```

需要 **Swift 6 或以上**；更旧时先更新开发工具。下面的 helper 脚本直接使用 Swift，**无需为它安装 Node.js 或执行 npm ci**。

将下面整个代码框粘贴进 Terminal 并按 Return。它在任何一步失败时停止，不覆盖已有源码目录。如果提示 `~/Developer/omd-home-0.2.2` 已存在，把下面 clone 末尾和 cd 中的目录名一起换成一个新名字，再重试。

```bash
(
set -e
mkdir -p ~/Developer
cd ~/Developer
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git omd-home-0.2.2
cd omd-home-0.2.2
sh scripts/build-eventkit.sh
open dist
)
```

成功时 Terminal 会输出 helper 版本信息，Finder 打开 `dist` 并显示 **omd-eventkit** 可执行文件；不要双击这个文件。

### 11B. 用 Finder 复制，不用输入隐藏路径

1. 在 `dist` 选中 **omd-eventkit**，按 **⌘C**。
2. 回 Obsidian 的 **Settings → Community plugins**，点文件夹图标，再在 Finder 打开 **omd-home**。
3. 按 **⌘V** 复制 helper，与 `main.js`、`manifest.json`、`styles.css` 放在同一层；保留可执行权限。更新 helper 时先停用 OMD Home，替换后再启用。
4. 回 **Settings → OMD Home → Calendar**，点 **Refresh calendars**，系统询问时授予日历访问权限。
5. 只打开允许 OMD 访问的日历开关，并把一个可写的测试日历设为 **Default calendar**。
6. 关闭设置，按 **⌘P** 运行 **OMD Home: Create event**。填测试标题、Start 和 End，在 **Destination** 选 **Vault + 你的测试日历名称**，点 **Save**。
7. 在 OMD Home 的 Calendar 和系统 Calendar app 核对这个事件，并打开它的 Vault 笔记。只在系统 Calendar 新建一个普通事件，不会自动生成 Vault 笔记。

**完成标志：选中的日历和测试事件能加载并核对。** 双方都修改时需要选择保留哪边。拒绝权限后可到 **System Settings → Privacy & Security → Calendars** 调整。

如果希望 helper 保存在别处，复制实际可执行文件的路径，在 **Calendar → Advanced Calendar helper → Helper override** 中粘贴；不要选源码或 `dist` 文件夹。源码目录被移动后要更新 override。

## 12. 升级、备份与演示前检查

升级前备份整个 Vault，停止 Capture，在 Community plugins 停用 OMD Home。把原 `.obsidian/plugins/omd-home/` 文件夹另存一份，尤其保留 `data.json`（设置）、笔记和已安装 helper。

- **BRAT 安装：** 第 2 节固定在 0.2.2，后续版本不会自动替换它。准备升级时在 BRAT 的插件列表中修改该插件的版本选择；选择要用的新版本后再更新，不必改成 Latest version。
- **手动安装：** 从目标 release 下载同版本三个文件，只替换 `main.js`、`manifest.json`、`styles.css`，保留 `data.json` 和 `omd-eventkit`。不要删除整个插件文件夹来更新。
- **后端：** 使用第 4 节展开项中的 `brew update` / `brew upgrade`；与插件分开升级。
- **Calendar helper：** 有更新时按第 11 节从匹配 tag 重新编译并替换。

重新启用插件并重开 Obsidian，检查 OMD 及实际使用的 AI / Calendar。回退时停用插件，恢复备份文件和设置，不删除笔记。不要用演示 Vault 的设置覆盖自己的资料库。

| 演示项目 | 完成标志 |
|---|---|
| 基础 Capture | 简单网页和一个本地 HTML／PDF 都能在 Inbox 打开，来源正确 |
| 转录（若使用） | 实际 OMD Capture 已下载所用模型，短音频文字已人工核对 |
| 本地 AI（若使用） | Check setup 通过，答案引用能打开，修改先预览 |
| Calendar（若使用） | helper 可执行、权限通过、仅选定日历参与，测试事件可核对 |

## 常见问题

| 卡住的位置 | 下一步 |
|---|---|
| 社区目录搜不到 OMD Home | 当前尚未上架；按第 2 节搜 BRAT，再添加 OMD Home 仓库；或第 3 节手动安装。 |
| BRAT 没出现版本列表或请求被限流 | 核对仓库地址，点输入框外并等待；稍后重试，或用手动方法。公开仓库不要求 token。 |
| Finder 看不到 .obsidian，或前往文件夹找不到路径 | 优先点 Obsidian 的插件文件夹图标；再看第 3 节展开的备用步骤，确认是实际 Vault。 |
| Installed plugins 没有 OMD Home | 确认同一个 Vault、三个文件名和一层 omd-home 目录；刷新列表，必要时 ⌘Q 后重开。 |
| Terminal 找不到 brew | 完成 Homebrew 的 shell 路径设置；重新验证 brew --version，不用 sudo brew install。 |
| OMD 没检测到或版本旧 | 看第 4 节诊断，更新后回 Capture and processing 点 Check again；不要用 AI 的检查按钮代替。 |
| OCR 语言包缺失 | 用 tesseract --list-langs 检查并安装所需包；不要靠清空偏好来掩盖缺失依赖。 |
| mlx_whisper 不可用 | 检查 Apple Silicon、pipx 和程序路径，重开 Obsidian，再做短音频 Capture。 |
| Terminal 找不到 ollama | 打开 Ollama app，完成首次 CLI 设置并新开 Terminal；不改 OMD/Python override。 |
| AI 检查失败 | 保持 Ollama 运行，确认模型已下载；在 AI answers 点 Check setup，文本和 embedding 分别检查。 |
| 完成后 Current task 消失 | 卡片只显示执行中工作，到 Inbox 打开结果。 |
| 网页拒绝访问或需登录 | 换无需登录的公开页，或 Capture 自己获准保存的本地副本；特定平台按第 10 节配置。 |
| Calendar 没有结果 | 看 helper 是否放对目录或 override 是否指向文件，检查系统权限，再 Refresh calendars 并选择日历。 |

反馈提供插件和 OMD 版本、Mac 芯片、失败步骤、错误文字；需要时附诊断输出，先移除个人路径。不要附整个 Vault、API key 或 cookie 内容。

## 开发者：固定版本源码构建

普通用户无需构建插件。开发者准备 Git、Node.js/npm 后，可复现 **0.2.2**：

```bash
git clone --branch 0.2.2 --depth 1 https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

结果仍是三个插件文件，不安装后端或模型。公开 main 包含这次发布的源码，未来仍会变化；固定 tag 方便复现。桌面验收见 [0.2.2 manual test plan](https://github.com/omd-local/obsidian-omd-home/blob/0.2.2/docs/manual-test-plan.md)。
