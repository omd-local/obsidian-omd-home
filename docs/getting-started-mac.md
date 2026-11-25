# 在 Mac 上安装并完成第一次 Capture / Mac getting started

[返回 OMD Home 首页 / Back to README](../README.md)

这份指南先帮你完成一个可检查的基础流程：**安装 Obsidian 插件 → 安装 OMD 转换后端 → 把一个网页或文件保存成 Markdown → 在 Inbox 找到结果**。首次测试不需要 Ollama、AI 模型、API key、日历权限或网站 cookies。

本文按 **2026-11-25** 核实的公开版本编写：OMD Home **0.2.1**、OMD 后端 **0.3.0b4**。两者分别安装；插件不是后端安装器。公开后端暂未包含当前开发版的全部接口，下面的兼容设置是首次 Capture 的必要步骤。

## 1. 准备一个演示 Vault / Prepare a demo vault

1. 从 [Obsidian 官网](https://obsidian.md/download)安装 Mac 桌面版，版本需为 **1.11.4 或以上**。可在 **Settings → General** 查看版本。
2. 在 Vault 选择窗口使用 **Create new vault**，命名为 `OMD Demo`，保存在自己的 **Documents** 文件夹。本文以 `~/Documents/OMD Demo` 为例；如果你选了其他位置，后面的路径都换成自己的 Vault 位置。
3. 先打开这个 Vault 一次，让 Obsidian 建立 `.obsidian` 配置文件夹。

`~` 代表你自己的用户目录，不用输入其他人的用户名。Vault 就是保存笔记的普通文件夹。

**如果是在已有 Vault 中升级：**先备份整个 Vault；停止进行中的 Capture，再停用 OMD Home。另存一份现有的 `.obsidian/plugins/omd-home/` 文件夹，方便回退。更新只替换下面三个插件文件，**保留原来的 `data.json`**，它保存现有插件设置。不要把演示 Vault 的配置覆盖到自己的资料库。

## 2. 下载三个插件文件 / Download the plugin assets

打开 [OMD Home 0.2.1 发布页](https://github.com/omd-local/obsidian-omd-home/releases/tag/0.2.1)，下载 **Assets** 中的这三个文件，也可以使用固定版本直链：

| 必需文件 | 下载 |
|---|---|
| `main.js` | [Download main.js](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.1/main.js) |
| `manifest.json` | [Download manifest.json](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.1/manifest.json) |
| `styles.css` | [Download styles.css](https://github.com/omd-local/obsidian-omd-home/releases/download/0.2.1/styles.css) |

使用发布页的文件名，避免浏览器保存成 `main.js.txt`、`manifest.json.txt` 或带有 `(1)` 的名字。**Source code (zip)** 是源码，不是可直接安装的插件包。这里三个文件都来自同一个 `0.2.1` 版本。

## 3. 放进隐藏的插件文件夹 / Put the files in the right folder

1. 打开 **Finder**，按 **Command–Shift–G**，打开 **Go to Folder**。
2. 输入自己的 Vault 配置目录；如果按上面的示例创建，输入：

   ```text
   ~/Documents/OMD Demo/.obsidian/
   ```

3. 在 `.obsidian` 内找到或新建 `plugins` 文件夹，再在 `plugins` 内新建 `omd-home`。
4. 把下载的三个文件直接放进 `omd-home`。正确结构是：

   ```text
   OMD Demo/
   └── .obsidian/
       └── plugins/
           └── omd-home/
               ├── main.js
               ├── manifest.json
               └── styles.css
   ```

   升级时，这里还可以有原来的 `data.json`，保留它即可。不要多套一层 `omd-home/omd-home/` 或把源码目录整个放进去。

5. 回到 Obsidian，打开 **Settings → Community plugins**。如果看到 **Turn on community plugins**，在确认信任这个插件后启用社区插件；刷新已安装插件列表，必要时退出并重新打开 Obsidian。
6. 在 **Installed plugins** 中启用 **OMD Home**。按 **Command–P** 打开命令面板，运行 **OMD Home: Open home**。

此时看到 Home 页面只证明插件已启用；Capture 还需要下一步的 OMD 后端。

## 4. 安装 OMD 后端 / Install the converter

先打开 Mac 的 **Terminal**，运行：

```bash
brew --version
```

如果出现 `command not found: brew`，先按 [Homebrew 官方安装说明](https://brew.sh/)安装，并完成安装器显示的 **Next steps**，然后新开一个 Terminal 窗口再检查。Homebrew 当前的受支持安装要求见[官方 Installation 页面](https://docs.brew.sh/Installation)：macOS 15 或以上、Apple Silicon；Intel 属于 Tier 3 配置，旧系统或 Intel Mac 不应预期与这个入门流程有同样的安装体验。

安装后端，每次复制一行并按 Return：

```bash
brew install omd-local/omd/omd
omd doctor
omd capabilities --json
```

这个项目自己的 Homebrew tap 会安装 OMD 和常用文档转换工具，包括 Python、ffmpeg、Tesseract、语言包和 yt-dlp。音视频的 Whisper 模型、Ollama、网站 cookies 和日历 helper 另行准备。具体依赖以[公开配方](https://github.com/omd-local/homebrew-omd/blob/main/Formula/omd.rb)为准。

已经安装过 OMD 的用户可以使用：

```bash
brew update
brew upgrade omd-local/omd/omd
```

升级只会取得 tap 当前发布的版本，不会把本机变成最新开发版。

回到 **Settings → OMD Home → OMD**，使用 **Detect OMD** 或 **Check again**。如果自动发现失败，在 Terminal 运行：

```bash
printf '%s\n' "$(brew --prefix omd-local/omd/omd)/bin/omd"
```

将输出的一整行绝对路径填到 **Advanced OMD paths → OMD executable override**，再检查。使用你这台 Mac 的实际输出；Apple Silicon 和 Intel 的 Homebrew 位置可能不同，不要复制别人的 `/Users/...` 路径。`omd doctor` 中未安装的可选 AI 或转录工具，不代表普通网页转换也不可用。

OMD Home 中的 **Copy install commands** 只复制命令，**Install guide** 只打开说明；两者都不会替你下载后端或执行安装。

## 5. 首次 Capture 前的公开版本兼容设置 / Public beta compatibility

> [!IMPORTANT]
> 截至本文日期，Homebrew 安装的后端仍是 **0.3.0b4**。它能做基础转换，但缺少 Home 0.2.1 用于识别语言、社交抓取和部分本地 AI 工作流的新接口。插件显示 OMD ready，并不表示这些功能全部可用。

**先做下面的设置，再提交第一次 Capture：**

1. 打开 **Settings → OMD Home → OMD → Recognition defaults**。
2. 在 **Image text language** 一行按 **Clear preference**，使它变成 **No language preference**。
3. 在 **Speech language** 一行也按 **Clear preference**，使它变成 **No language preference**。如果已经是这个值，保留即可。旧后端下下拉框可能不可用，使用旁边的 **Clear preference** 按钮。
4. 打开 **Capture URL or file**，关闭 **Polish Markdown** 和 **Review links and tags**，再提交。提交后的选择会被记住；仅关闭弹窗不会保存选择。

首次安装默认是 English OCR、Auto-detect speech，而且链接标签建议可能已开启，所以这几项不能跳过。**No language preference** 的含义是让转换器使用自己的默认值，并不保证所有旧适配器都自动检测语言。

这个基础路线先使用普通公开网页或本地文件。**抖音、小红书分享文字、Improve formatting、链接标签建议以及 Capture polish，需要与插件匹配的较新后端**；仅重装同一个 b4 或安装 Ollama 不能补齐接口。不要通过关闭插件的兼容检查绕过它。接口依据可查看 [b4 capabilities](https://github.com/omd-local/markdown-everything/blob/v0.3.0b4/omd/capabilities.py) 和 [Home 0.2.1 capability checks](https://github.com/omd-local/obsidian-omd-home/blob/0.2.1/src/enrichment/capability.ts)。

## 6. 完成第一次抓取 / Make your first capture

1. 在 Home 点 **Capture URL or file**，或用 **Command–P → OMD Home: Capture URL or file**。
2. 先填一个无需登录的简单公开网页，例如 `https://example.com/`。也可以拖入一个小型本地文本文件，或粘贴它在自己 Mac 上的完整路径。一次只提交一个来源。
3. 确认两项语言偏好已清除，**Polish Markdown** 与 **Review links and tags** 都关闭，再点 **Capture**。
4. Home 的 **Current task** 会在执行时显示状态；很快的任务可能一闪而过。完成后去 **Inbox** 找到此次结果，并打开生成的 Markdown，确认正文和原始来源。

**看到生成的笔记且可以打开，才算完成第一次 Capture。** 文件一般位于 Vault 的 `Sources/<source type>/`，另有相邻的 `.omd.json` 元数据。捕获会立即写入新笔记；可选 AI 修改才需要另外预览与确认。

普通网页抓取需要网络，但本地文件测试不需要访问来源网站。如果任务失败，查看 **Needs attention** 的原因；修复后使用 **Retry capture**。不要用一个需要登录、频繁限流或很长的视频作为首次安装检查。

## 7. 选装：Apple Silicon 本地转录 / Optional transcription

先在 **Apple menu → About This Mac** 看 **Chip** 是否为 Apple M 系列。下面的 `mlx-whisper` 路线仅用于 **Apple Silicon**；它不是 Intel Mac 的转录安装方法。

在已经完成基础 Capture 的 Mac 上运行：

```bash
brew install pipx
pipx install mlx-whisper
pipx ensurepath
```

按 `pipx ensurepath` 的提示新开 Terminal，检查：

```bash
command -v mlx_whisper
omd doctor
```

先用自己有权使用的一段 **10–30 秒短音频**测试：在 Capture 中提交本地音频文件，继续保持两项语言偏好为 **No language preference**，关闭两项 AI 开关。第一次转录可能需要联网下载 Whisper 模型，耗时和磁盘占用与网络、模型有关；在演示前完成下载并成功跑完一次。语音转录本身不需要 Ollama，原始转录与 AI 整理是不同步骤。

对于 **Intel Mac**，不要安装 MLX 后期待同样的效果。项目有其他转录后端的开发接口，但本指南没有验证 Intel 上 Home 0.2.1 的完整安装流程；先用文档或网页演示，并按 [OMD 官方手动安装与转录说明](https://github.com/omd-local/markdown-everything#quick-start)核对适合系统的路径。

## 8. 以后再加 AI、日历和 iPhone / Optional features

| 想增加的功能 | 还需要什么 |
|---|---|
| 本地摘要、格式改善、链接标签建议、Vault Q&A | 与 Home 兼容的 OMD 后端，以及相应 Ollama 模型和通过的 **Check setup**；安装模型不会修复旧后端接口缺失 |
| 语义检索 | 另外安装 embedding model，并完成检索检查；先让基础 Capture 工作 |
| Apple Calendar 同步 | macOS 14+、单独构建的 EventKit helper、Calendar 权限，并明确选择允许的日历；三个插件下载文件不包含 helper |
| iPhone 分享后让 Mac 开始 Capture | 目前是未发布开发功能，见下文；公开 0.2.1 没有这个入口 |

本地的 `omd-home-iphone-direct-capture-dev.zip` 可以作为未来 GitHub Release 的开发预览附件，但**截至本文日期还不是公开发布资产**。它包含插件、说明和校验信息，**没有 OMD 后端、模型或可直接安装的快捷指令**，不属于一体安装器。下载公开 0.2.1 的三个文件也不会得到 iPhone 开发入口。

GitHub 读者无法打开开发者电脑上的 `/Volumes/...` 链接。共享下载必须先有真实可访问的 HTTPS Release asset；不能把本地文件路径写成一个对外可用的下载按钮。

开发版 iPhone 路线使用 **Run Script over SSH** 把请求交给 Mac，要求 Mac 唤醒、登录、可达且已打开对应 Vault。**Remote Login** 会允许获准用户远程登录这台 Mac，权限不限于发送一条 OMD 链接；只给需要的账户开通，不要公开登录凭据或配对地址，不使用时撤销配对并按需关闭 Remote Login。实际 iPhone→Mac 联调仍待验证，不能把自动化测试通过当成手机端已验证。详见 [iPhone direct capture setup / 开发版配置与限制](iphone-direct-capture.md)及 [Apple 的 Remote Login 说明](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)。

## 常见问题 / Troubleshooting

| 看到的情况 | 下一步 |
|---|---|
| Installed plugins 没有 OMD Home | 检查三个文件名、所在 Vault，以及是否多套了一层文件夹；重开 Obsidian |
| `brew: command not found` | 完成 Homebrew 官方安装和 Next steps，新开 Terminal 后重试 |
| OMD executable 未发现 | 使用本机 `brew --prefix` 生成的绝对路径，填入 Advanced OMD paths 并重新检查 |
| 提示 recognition preference 需要较新 OMD | 清除 Image text language 和 Speech language 两项偏好；不是只清除其中一项 |
| `cannot prove hardened local Ollama transport` | 当前后端缺少 AI 接口；基础 Capture 关闭 Polish Markdown、Review links and tags，完整 AI 流程需升级到兼容后端 |
| 社交分享链接失败或要求升级 | b4 缺少相应 capability；先改用普通网页或文件测试，cookies 不能解决接口缺失 |
| 抓取完成但没有 Current task 卡片 | 任务结束后卡片会消失；到 Inbox 检查生成笔记 |
| 转录提示 `mlx_whisper` missing | 确认是 Apple Silicon，完成 pipx 安装、PATH 提示和 doctor 检查；普通网页 Capture 可先继续用 |
| 某网页被拒绝、需登录或返回 403 | 换无需登录的公开页，或保存自己获准使用的本地副本再 Capture |

反馈问题时，提供插件版本、OMD capabilities 中的版本、Mac 芯片、操作步骤和错误文字即可；不需要提交整个 Vault、账号 cookies 或 SSH 凭据。

## 开发者：固定版本源码构建 / Build the pinned plugin tag

普通用户使用上面的三个发布文件即可。需要从源码复现公开插件时，使用同一个 `0.2.1` tag，而不是不断变化的 `main`：

```bash
git clone --branch 0.2.1 --depth 1 https://github.com/omd-local/obsidian-omd-home.git
cd obsidian-omd-home
npm ci
npm run build
```

这需要另外准备 Node.js/npm；构建结果仍是三个插件文件，**不会安装 OMD 后端，也不会加入 tag 之后的 iPhone 功能**。公共后端 `main` 当前同样不等于本机最新开发后端，不能用一个源码 clone 命令承诺完整功能。

**English quick path:** install Obsidian desktop ≥1.11.4; create a demo vault; install all three pinned 0.2.1 release assets directly in `.obsidian/plugins/omd-home/`; install OMD with Homebrew. With public backend 0.3.0b4, clear both Recognition defaults and turn off Polish Markdown and Review links and tags before testing a simple webpage. Optional MLX transcription is Apple-Silicon-only and needs a successful short test before a demo. iPhone direct capture is an unreleased development addition.
