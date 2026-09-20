# OMD Home 发布 UI / UX 验收记录

检查跨度：2026-09-17–2026-09-21。使用 design-review、qa、visual-verdict 的审查方法。报告保留各轮当时的原生证据与边界；最终 P0 / P1 收口状态见下节，较早段落中的计数和待办只描述对应时间点。

## P0 / P1 发布收口（2026-09-21）

本轮保持现有 minimal 风格并完成发布范围内的剩余修复：生成 proposal 时持续显示明确等待状态；
Recent 只对带 OMD 工作流 Property 的 note 显示 **Inbox**／**Reviewed**，Apply 完整成功后显示
**Status · Reviewed**；Capture 六类字段、Recognition／Optional local AI 分区与操作区使用统一的局部
垂直间距；Needs attention 的历史 issue 与独立 Capture Retry 可按精确实例关闭，实时 setup／连接
问题继续由健康状态驱动，不能被关闭按钮掩盖。

托管 answer model 现在由 OMD 后端按精确 provider／model 返回回答契约，Home 不再自行猜测：OpenAI／
Anthropic 的严格 schema 与 DeepSeek 的 JSON mode + 本地 schema 校验分别如实呈现；catalog 可见但
已知不兼容或未验证的型号不会进入 ready 或发送路径，`gpt-4.1` 等后端已验证型号可以正常通过。
模型变更和凭证变更都会使先前检查失效，插件也不会自动替用户换模型。后端同步修复 enrichment 将语义新标签错放到 existing tags 时的
可恢复路径，同时继续拒绝不透明／保留形式的新标签；Recognition 的 OCR／ASR 配置、错误说明、
manifest 和 MCP／CLI contract 保持一致。

自动验证结果：OMD Home 的 TypeScript、ESLint、**600 / 600** tests 与 production build 全部通过；
OMD 后端 **1670 / 1670** tests、Ruff、compileall 以及隔离 wheel 安装／英文 OCR smoke 通过；两个仓库
`git diff --check` 通过。真实 OpenAI key，以及 UI-01–04、UI-12–14 对应的原生深浅主题、窄窗口、
键盘和 150% 字体复测仍按人工计划记录，不以自动结果冒充人工 PASS。

Graph／Search／Backlinks／Bases 增强、ANSWER-01、Douyin／XHS cookies bridge 与 folder／list batch
入口全部保留为 **Deferred / P2**。README 与 release checklist 已限制为 Home 实际连接的一条公共 URL
或一个本地文件，不把 OMD 引擎自身的 P2 能力写成 Home 已支持。

**20:45 候选结果（后续新发现见下方）：当时已发现的界面与交互缺陷已修复，完整前端 563 项、后端 1627 项测试通过，前端类型检查 / ESLint / 构建通过。恢复 minimal 风格后，36 组常规布局 + 8 组 Pin 对齐 + 4 组原生设置宽度模拟，共 48 组浏览器检查通过。**

2026-09-17 20:43–20:45 NZST 已在解锁后的 Obsidian 1.13.7 中停用 / 启用插件，完成最终构建的原生复测。Settings 长状态卡片、Check setup、Pin / Unpin、Capture 空白反馈 / 长路径 / 取消、全天事件说明 / 空标题反馈均通过。窗口已交还，当前无转换任务。本报告不把所有材料、语言与云模型都标记为实测通过。

## Automatic OMD 与 Recognition 修复（2026-09-19）

用户重开 Obsidian、选择 Automatic 并点击 **Check again** 后，Recognition 只显示
**No language preference**。原生重现确认插件先接受 `/opt/homebrew/bin/omd`；该 Homebrew 安装的
capability 只有 `enrich_note`。同机较后的
`/opt/homebrew/Caskroom/miniconda/base/bin/omd` 广告完整 capture language contract 和已安装的
`eng`、`chi_sim`、`chi_tra` packs，但旧探测会在到达它之前停止。

修复使 Automatic 优先选择同时支持 enrichment 与 Recognition contract 的候选，因此会跳过上述
旧 Homebrew launcher。兼容边界保持不变：机器若只有 enrich-only OMD，仍可使用 Q&A / enrichment，
Recognition 明确关闭；显式 custom executable 也不会因缺少可选语言能力而整体失效。

最终 production bundle 通过 TypeScript、ESLint、**575 / 575** 自动测试和 build；安装后真正停用／
启用插件，再点击 **Check again**，原生界面解析到 Miniconda OMD（package `0.3.0b2`、protocol v1）。
图像菜单显示 No language preference、English、简中 + English、繁中 + English；语音菜单显示
No language preference、Auto-detect speech、English、Chinese。Automatic setup 回归与
OMD-01 的旧候选跳过子项记为 **PASS**。CAP-02 第 11 步仍需在真实 Capture 后运行一次
**Suggest links and tags**，所以没有据此把整个 CAP-02 标为完成。

安装资产 SHA-256：`main.js` `0b027dd0665daa3701c242bf748566ff99c5f1706fe90f33789e867d9e9120ed`；
`styles.css` `8e175571fe0e67b8fdcfe3280cda7e982b500f50398c3574a59221123add0c77`；
`manifest.json` `7ca5b07471306bc45acfefc09a2ed47c5d9508f55ef6b638c80b552c87d0f5cb`。
[原生复测记录](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/automatic-discovery/native-verification.md>)。

## CAP-06 后台继续 A（2026-09-20）

**PASS。** 测试者使用 113.855 秒的合成 WAV 启动 Capture，在 Current task active 后关闭 OMD Home
view，约 30 秒后重新打开。任务继续并生成 `Sources/Audio/slow-bilingual-speech.md`；只读复核确认
note 带 `cap-06-background`、`audio` 与 `omd_home_status: inbox`，证明关闭 view 没有取消
plugin-owned capture。

完成后出现的 enrichment **Could not finish** 不属于后台 capture 失败。该次实际保存的
`capturePolish` 与 `captureSuggestLinksAndTags` 均为 `true`，所以 Capture 完成后继续生成 proposal；
本地模型把一个新 tag 错报为现有 vault catalog tag，validator 按设计拒绝并明确显示没有 proposal
写入。CAP-06 A 保持 PASS，B–D 继续测试。计划已把“保持关闭”改为每次 Capture 明确确认两个
Optional local AI 开关处于 off，避免记住的 on 状态污染生命周期测试。

## CAP-06 完全退出取消 D（2026-09-20）

用户确认场景 D 原生通过：Capture active 时直接使用 **Cmd+Q** 完全退出 Obsidian，重开后没有
残留 task、错误 Retry 或 `cap-06-quit` 对应的完成 note，场景 A 已完成的
`cap-06-background` note 仍存在。D 记为 **PASS**；B、C 在没有各自最终记录前继续保持未关闭，
不由 D 的结果代替。

## CAP-03 缺失模型失败终态（2026-09-20）

用户按 CAP-03 使用不存在的 `omd-home-cap03-missing-model:latest` 并开启 Polish Markdown 后，
missing / unavailable 说明和 **Retry capture** 正确出现，但 Current task 当时没有立即回到 idle，
该轮按部分失败记录。原因是失败分支在 `captureActive` 清理前先发布了一次 Home 重绘，再在 finally
中重绘终态；界面可能停留在先发布的 active 状态，直到 Check setup 等后续动作再次刷新。

修复后失败事件仍完整进入 Needs attention，但只在 capture lifecycle 已清理为 idle 后发布终态。
新增回归锁定“terminal event 的最后一次发布发生在 `captureActive=false` 之后”。Production bundle
通过 TypeScript、ESLint、**576 / 576** 测试和 build，安装到 test-vault 后真正停用／启用插件。
相同 fixture 与缺失模型原生复测时，错误出现后 Current task 立即显示 **No task running**，System
显示 **OMD idle / Last run error**，Needs attention 提供准确的 missing-model 说明、时间和
**Retry capture**，且没有产生新 note。Retry 目视确认恢复 source、Polish Markdown、Review links
and tags 及 No language preference 的 OCR / ASR。验证过程误生成的一份 fixture 及索引行已清理。

测试者随后把 Local writing model 恢复为 `qwen3:4b-instruct` 并运行 **Check setup**，界面直接显示
**OMD ready**。这是预期结果：Automatic 是 Advanced OMD paths 中 executable override 为空时的
配置状态，当前 UI 不另显示 Automatic 标签。配置复核确认 `omdExecutable` 为自动发现值，override
渲染为空，原 Local writing model 也已恢复。CAP-03 第 1–7 步均有 PASS 证据，case 状态更新为 PASS。

## CAP-02 UI-05 / UI-06 复测（2026-09-17 23:51）

**正常 Apply 原生重载复测：PASS。** 早先用户点击 Apply 后收到 Review required，目标笔记已有
Related notes、状态仍是 inbox；该次记录继续作为历史 partial failure 证据。诊断确认 Obsidian
完成 OMD Home 自有正文写入后会刷新 inode 和 / 或 `TFile`，适配器未重新绑定，后续 Properties
写入因此把自有写入误判为外部冲突。修复在自有写入后只对同一安全路径和 device 重新绑定，
写入前的路径、device、inode、`TFile` 校验仍保持严格。

安装生产 bundle 后真正停用 / 启用插件，Check setup 的 OMD、Local AI、Vault Q&A、Note
enrichment 均 ready。使用独立测试笔记与 `qwen3:0.6b` 重新生成并 Apply，原生终态为
**Applied**，写入 5 个 links、4 个 tags，`omd_home_status` 为 `reviewed`，没有再出现
Review required。**Proposal summary** 只用于检查；保存后的笔记不含摘要，与界面说明一致。

部分失败终态已改为 **Apply incomplete**，只陈述可验证的部分写入，并提供 **Open note**
打开精确 target；导航失败时保留弹窗并显示提示。长多语言 target 在 390px、150% 字体和深浅
主题下没有横向溢出或遮挡。8 个 Review / partial-failure 视觉场景全部通过。

最终 `npm run check` 通过：TypeScript、ESLint、572 / 572 自动测试与 production build 全部成功；
enrichment 定向测试 29 / 29。两次独立代码 / 架构复审均为 APPROVE / CLEAR，无剩余实质阻塞。

旧的 Finder / 文本编辑冲突步骤对普通用户不可执行，本轮没有执行、**不计 PASS**；已从普通
用户计划移除，改由确定性自动回归验证 Generate 与 Apply 之间的外部修改不会被覆盖。磁盘 /
frontmatter 故障和保护性回滚也使用故障注入测试验证，没有在人工作业中制造文件系统竞态。
生成等待标识不明显仍见 UI-04；自动发现旧 Homebrew launcher 的独立子项仍未完成。

[原始失败证据](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/cap-02-apply-feedback/evidence.json>) ·
[修复后的原生复测](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/ui05-ui06/native-verification.md>) ·
[8 组视觉结果](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/ui05-ui06/visual-results.json>)

## CAP-01A 人工反馈与源码修复（22:50 已安装）

用户从首页搜索框直接提交简中 PNG 后得到乱码。原 `.raw.md` 已错误，侧车记录
`ocr.requested=null / effective=eng / source=default`；Tesseract 英文默认输出可准确复现。
本机中文语言包齐全，显式 `chi_sim+eng` 的完整 OMD 隔离捕获恢复中文主体和 `SIM-204`，
但标点 / 空格仍有差异。问题来自入口直接使用默认语言，不能归因于 AI 润色或缺中文语言包。

已合入：本地图片在首页提交后先打开预填 Capture 并展开 Recognition；图片和语音下拉框各占完整一行。
URL / PDF 快速转换保持原行为；单次语言选择不修改 Settings 默认值。复用路径规范化与 Capture，
没有新依赖。修改源码 `src/{omnibox-utils,omnibox,modals}.ts`、`src/styles.css`，并更新四份对应回归测试。

验证：修复前的入口回归失败、修复后通过；完整项目 `npm run check` **565 / 565**，
TypeScript / ESLint / production build、`git diff --check` 通过。6 个浏览器布局场景的中文语言与
No language preference 标签完整显示，无横向溢出、控件重叠；提交回调保留 `chi_sim+eng`。
隔离真实 CLI 另验证三种 OCR 语言下网页 Full Content 完全一致；扫描 PDF 返回失败且无笔记。
用户随后提供 **17 Sept 22:26** 的原生截图：Capture failed 正文明确说明无法提取内容，
建议页面图片 OCR 或文字层 PDF；读取 test-vault 未发现该来源 Markdown。
**扫描 PDF 限制处理：PASS（用户原生截图 + 只读文件核对）**；扫描 PDF OCR 功能仍不支持。
[用户截图](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/ocr-simplified-investigation/scanned-pdf-native-user.png>)。

**22:50–22:54 更新完成**：按用户要求安装新 bundle，经原生插件管理停用 / 启用加载。
Check setup ready；图片路径先打开 Recognition 的行为、语言选择完整显示、取消后默认恢复均通过。
Suggested note topics / Idea only 文案包含在当前已核对的 bundle；原生生成审核留给 CAP-02 用户验收。
前后 23 份 Markdown 与插件设置内容一致。语音测试按用户确认记录 **PASS**，未补填逐模式细项。
CAP-02 草稿已填好小型 HTML，链接 / 标签审核开启、润色关闭，未提交。
自动发现解析到另一套 Homebrew 安装；本轮保留已验证的工作区 OMD，自发现子项仍待独立验收。
[安装哈希、原生检查与交接](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/cap-02-update/native-handoff.md>)。
“new-concept-1/2”等模型生成的占位主题仍是未解决的内容质量问题。当前不应宣称全部发布问题已关闭。

[本轮证据与边界](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/ocr-simplified-investigation/verification.md>) ·
[明确操作步骤](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/manual-test-start.md>)

## Minimal 风格修正与 Pin 对齐（最终候选）

按用户要求恢复原有 minimal 方向：等宽标题与操作文字、紧凑控件、开放的页面区块与细分隔线；去除意外激活的大边框、点阵背景、标题色条和列表按钮底色。保留界面字体缩放、主题变量、长文件名约束、自动行高和窄窗口布局，以及之前全部交互 / Settings / 多语言 / 文案修复。

Pin / Unpin 不再按每行文字计算列宽，Recent、Pinned、Inbox 和搜索结果共享可随字体缩放的列宽。正常字号混合状态原为 64 / 65.83px，现为 70 / 70px；150% 字体原为 64 / 84.23px，现为 97.5 / 97.5px。所有目标组合的列分隔线偏差均为 0px；原生点击 Unpin 再 Pin 后状态恢复，列保持对齐。

本次生产代码仅修改 `src/styles.css`，并同步 `tests/home-view.test.ts` 的布局断言；没有撤回之前的功能修复，也没有新依赖。另更新本报告与 `docs/manual-test-plan.md` 的候选身份，保留旧测试记录。

[本轮 48 组验证、截图与模拟边界](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/minimal-followup/verification.md>) · [原生复测记录](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/minimal-followup/native-verification.md>)

## 逐项验收

| 页面 / 项目 | 实际检查与结果 | 证据方式 |
| --- | --- | --- |
| Home 首页、Inbox、Recent、Pinned | 长中英阿标题、路径和按钮不重叠；完整路径可查看；字体放大后标题与路径仍分行 | 浏览器真实源码渲染 + 原生检查 |
| Home 控件 | Capture、新事件、菜单、Pin、AI tags、结果关闭等回调有响应；命令不可用会明确提示 | 生产回调测试 + 浏览器；主要入口原生点击 |
| Widget 布局 | 键盘连续移动保留焦点；拖动取消不保存预览；尺寸控制工作 | 行为测试 + 独立 Chromium DOM 复测 |
| 日期与状态 | 跨午夜更新日期、问候及 Today / Upcoming；AI 审核区分等待审核与正在应用 | 时钟回归测试 + 独立 DOM；阶段回归 |
| Omnibox 搜索 / 问答 | 加载与失败状态可见，结果可关闭；带引号、空格和中文的 PDF 路径正确识别 | 回归 + 浏览器 |
| 本地问答 | 真实 qwen3:4b-instruct 回答中文问题，附来源；缺少 bge-m3 时显示关键词检索及原因 | 原生 Obsidian 实测（约 13 秒） |
| Capture 输入 | 空白 / 无效输入显示提示并回到输入框；Enter 提交；IME 组合输入不误提交；防止重复提交 | 新行为测试 + 原生空白提交 |
| Capture 长路径 | 长多语言 URL / PDF 路径不挤压标签，识别选项、AI 开关、底部按钮可访问 | 原生路径输入 + 390px / 150% 浏览器测试 |
| Capture 生命周期 | 取消关闭；开始后显示首页进度；意外失败恢复草稿；关闭后清理焦点计时器 | 生产回调测试 |
| Calendar 视图 | 月 / 周 / 日 / 列表、上一月 / 下一月 / Today 与来源筛选工作；主题颜色与字体一致 | 原生视图与翻页 + 浏览器 |
| Event 表单 | 空标题有反馈；全天结束日期规则清楚；Save / 同步冲突操作有进行中状态且防重复 | 原生空标题 / 全天切换 + 生产回调测试 |
| Event 实际外部写入 | 没有创建或修改真实日历事件 | Save / 冲突行为使用边界模拟 |
| Settings 全量 | 39 个控件 / 控件组逐项列明动作、持久化、不可用状态及证据 | 见完整 Settings 控件表；并非每个项目均做实网操作 |
| Settings 模型输入 | 自定义模型草稿不因刷新丢失；不同 provider 草稿独立；无效模型保持可见并可修正 | 新生产回调测试 |
| Settings 识别语言 | 不可用 OCR / ASR 偏好明确显示；支持清除；自定义 OCR 可清空 | 新生产回调测试 |
| Settings 保存 | 所有该页保存统一排队，失败明确提示，后续可以重试 | 并发 / 失败注入测试 |
| Settings 状态卡片 | 长执行路径下按钮留在卡片内；596px 内容宽度与 150% 字体下无突出或交叠 | 原生发现；4 组针对性浏览器回归；最终原生重载确认 |
| Settings 本地检查 | Check setup 正常返回；仅声明文本模型就绪，避免把缺失的 embedding 模型说成已就绪 | 原生 + 文案 / 状态测试 |
| Cloud 同意弹窗 | 数据目的地、待发送摘录、取消 / 确认回调、长文本和滚动可用 | 浏览器模拟；没有实际发出云请求 |
| 多 provider 界面 | Ollama、本机 Ollama Cloud、OpenAI、Anthropic、DeepSeek 选择与模型 / 密钥状态正确 | 30 次界面 provider 切换 + 既有运行时回归 |
| 录音入口 | 根据实际可用命令显示开始 / 停止，缺失命令有提示 | 命令边界测试；未启动麦克风 |
| 多语言标签 | 阿拉伯文、韩文、印地文、带重音字符和 CJK 不再被过滤或截断；NFC / 小写身份前后端一致 | 前后端回归 + 实际 capture 标签检查 |
| Markdown 润色 | 模型删句、改日期或损坏链接 / 代码 / 公式时拒绝改写、保留原文并警告 | 两个真实本地模型 + 坏输出回放 |
| 文案 | 缩短重复模型目录说明；去除实现细节；提示说明下一步；统一术语与同类文字排版 | 源码审查 + 截图 / 原生检查 |

Settings 的 39 项完整清单：[settings-findings.md](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/settings-findings.md>)。其他逐项清单：[Home / Calendar](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/home-findings.md>)、[Capture / Consent](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/modals-findings.md>)、[Omnibox / Runtime](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/runtime-findings.md>)。

## 视觉与交互覆盖

六个页面：Settings、Capture、Cloud consent、Home / Omnibox、Calendar、Event editor。

- 1280×900、900×700、390×700、900×400、900×700 + 150% 字体，以及桌面浅色主题。
- 额外模拟真实 Obsidian 设置侧栏后的 596px 内容宽度，使用完整长状态文字。
- 检查横向溢出、超出视口的控件、标题 / 路径文字相撞、控件突出父卡片、标签 / 控件相撞、运行错误，最终均为零。
- 108 个浏览器动作场景、30 次 provider 切换通过；紧凑布局隐藏的桌面布局控件有明确跳过记录。
- 浏览器使用真实页面源码、真实 Obsidian CSS、完整 FullCalendar 样式；转换、模型、凭证、外部日历操作在组件环境中模拟。

[视觉报告与截图索引](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/visual/verification.md>) · [可复现浏览器工具与模拟边界](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/visual-harness/README.md>)

![Minimal 风格与一致的 Pin 列](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/minimal-followup/visual/after-home-1280x900-1.5-dark-pin-recent.png>)

![最终日历](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/minimal-followup/visual/after-calendar-900x700-1.5-dark.png>)

![真实设置宽度与长状态文字](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/minimal-followup/visual/after-native-settings-900x700-1-dark.png>)

## 材料、模型与语言的实测范围

- 用户提供的 Medium URL：真实转换通过，保留文章标题与 dense / sparse embedding 内容。
- 文本型 PDF：真实转换通过，中文 / 阿拉伯文文件名保留；PDF 正文样本为英文。
- 英文、中文、阿拉伯文 UTF-8 HTML：转换通过，标题、正文、日期与标识符保留。
- qwen3:0.6b 与 qwen3:4b-instruct：实际执行生成、enrichment、polish。断开端点 / 缺少模型的失败路径有验证。
- 0.6b 的部分 enrichment 结果结构合格但语义相关性较弱；4b 生成未知标签的结果被安全拒绝。因此不宣称更大的模型必然成功，或所有模型与所有语言均已合格。
- Optional polish 和链接 / 标签建议仍使用本地 writing model；切换回答 provider 不会使这些功能自动支持云模型。

[完整兼容性报告与原始结果](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/compatibility/compatibility-findings.md>)

20:45 候选时尚未实测（OCR / 扫描 PDF 的后续证据见上方）：真实云请求 / 凭证、日历写入、麦克风、音视频识别、图像 OCR、扫描 PDF、CJK / Arabic PDF 正文字体、Office / EPUB 等其他转换格式。当前识别界面明确区分图像 OCR 与扫描 PDF；本次没有新增扫描 PDF OCR 功能。界面语言仍为统一英文，本次支持的是多语言文件名、输入、内容与标签，不是完整界面本地化。

## 变更与简化

OMD Home 实际源码：`src/styles.css`、`settings.ts`、`modals.ts`、`home-view.ts`、`calendar-view.ts`、`main.ts`、`omnibox.ts`、`omnibox-utils.ts`、`ai-provider.ts`、`local-ai-readiness.ts`、`enrichment/{request-builder,contract,controller}.ts`。

OMD 后端实际源码：`omd/{_polish_md,tag_normalization,capture,enrich_note,retrieval}.py`。

完整文件清单：[Home 22 个源码 / 测试文件](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/home-integrated-files.json>)、[后端 9 个源码 / 测试文件](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/backend-integrated-files.json>)。原有未提交工作保留。没有新增依赖。

简化：主题变量集中到 OMD 页面作用域；统一字体和控件规则；复用既有设置保存队列和日历动作保护；复用 Unicode 标签规范化；删除重复的冗长模型目录拼接。

润色保护是保守的内容保留检查，不是语义验证器；可能拒绝本来合理的正文改写。受保护语法以外的标点变化不能据此宣称语义绝对不变，生成内容仍需审核。

## 复审、验证与数据完整性

- 最终 minimal 候选重新运行 `npm run check`：563 / 563 通过；TypeScript、ESLint、生产构建与 `git diff --check` 通过。
- 上一轮 `.venv/bin/python -m pytest -q`：1627 / 1627 通过，39.55 秒。本次只改前端样式，未重复运行后端测试。
- 独立 UI 复审发现并解决键盘移动失焦和跨午夜过期；[复审证据](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/review-findings.md>)。
- 独立后端复审发现并解决嵌套链接 / 代码 / 公式保护缺口及 Unicode 身份差异；[最终复审](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/backend-review.md>)。
- 上一轮核对的原有 13 份 Markdown 未修改；本次重载前后现有 22 份 Markdown SHA-256 全部一致，插件设置 JSON 内容完全一致。额外文件来自测试库现有内容，不归因为本轮创建。材料转换仍使用上一轮隔离输出库。
- 20:45 原生复测时的插件 main.js / styles.css / manifest.json 与当时构建哈希一致；后续修复已于 22:50 安装，见上方更新记录。
- 原源码备份：`source-backup/`；原插件与设置备份：`installed-plugin-backup/`。本次没有修改账号凭证、安装依赖或下载模型。

最终原生复测使用插件管理中的停用 / 启用完成，未使用会丢弃未保存状态的应用重载。所有测试表单已取消，Pin 状态已恢复，窗口已交还给用户继续 CAP-01A；OCR / ASR 的实际转换仍由人工计划后续验收。
