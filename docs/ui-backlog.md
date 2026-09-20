# UI backlog

本文件追踪已观察到的 UI 收尾事项。代码修改不等于人工视觉测试通过；待验证项须按
`manual-test-plan.md` 的 AI-00／AI-02 检查宽、窄设置面板后才能关闭。

## UI-01：Settings section 标题与 helper/note 的字体层级不一致

**状态：已实现，待 AI-00 人工视觉验证。** 同级标题及其紧随说明共用字体层级；空状态说明也使用
相同的可读注释样式。

**证据与背景：** 在 Settings 的多个 section 中，紧贴 section 标题下方的 helper/note 文本在字号、
字重或颜色层级上不一致。有的看起来像正文说明，有的又像较弱的注释；用户连续浏览设置时会难以
判断哪些文字是同一层级的补充说明。此项涵盖同级 section 标题及其紧随的 helper/note，不扩展到表单 label、
错误状态或整个 Settings 的排版重做。

**验收标准：**

- 同级 section 标题彼此一致；其下 helper/note 也各自使用一致的字体、字重、字号、行高与对比层级，保留标题和说明之间的层级区别。
- 说明文字与错误/成功状态、可交互控件 label 仍能清楚区分。
- 窄宽 Settings 面板下不会因统一样式而截断、重叠或削弱可读性。

## UI-02：DeepSeek Developer key 与授权开关的说明/控件对齐不一致

**状态：已实现，待 AI-00 人工视觉验证。** 授权开关和 Developer key 共用设置行的列宽与响应式
规则；授权语义未改变。

**证据与背景：** 在 DeepSeek provider 设置中，**Developer key** 的说明与输入控件、以及
**Allow DeepSeek API answers** 的说明与开关，采用了不同的水平对齐/间距关系。两项都属于同一
provider-scoped 主流程，视觉节奏不一致会让 credential 与显式授权的关系显得断裂。此项只记录
对齐与间距问题，不改变授权语义、文案或 API 行为。

**验收标准：**

- Developer key 与 Allow DeepSeek API answers 在相同容器/列宽下具有一致的 label、说明和控件
  左右对齐规则及垂直间距。
- secret input、toggle、help text 和键盘 focus 状态在宽、窄 Settings 面板都保持可读且不重叠。
- 对齐调整不掩盖或弱化 DeepSeek API answers 的显式 opt-in 含义。

## UI-03：Ollama endpoint 校验信息挤压输入框与卡片留白

**状态：已实现，待 AI-02 人工视觉验证。** 错误位于输入框下方的独立整行，保留即时校验、
允许的两个地址和最后有效值；输入框通过 `aria-invalid`／`aria-describedby` 关联错误。

**证据与背景：** 在 **Advanced AI controls → Ollama troubleshooting** 中输入不受支持的
endpoint 时，校验信息当前与输入框并排显示。较窄的 Settings 面板里，长提示会紧贴输入框并在
右侧狭窄空间中多行换行，挤压卡片原有留白，削弱错误与字段之间的视觉层级。此项只调整错误信息
的布局、间距与响应式呈现；不改变仅允许 `http://localhost:11434` 和
`http://127.0.0.1:11434`、且无效值不覆盖最后有效设置的校验行为。

**验收标准：**

- endpoint 校验信息在字段附近清楚可见，但不与输入框争抢同一狭窄行；优先在控件下方使用独立
  的整行区域，并与输入框、卡片边缘保留一致间距。
- 宽、窄 Settings 面板中均无文字贴边、异常断行、重叠或横向溢出；长提示保持可读。
- 错误状态仍与 endpoint 字段明确关联，恢复有效 endpoint 后提示立即消失。
- 不改变允许的 loopback endpoint、即时校验或保留最后有效值的安全语义。

## UI-04：Generating proposal 的等待状态不够明显

**状态：Open，已记录，尚未实现。**

**证据与背景：** 2026-09-17，用户在 CAP-02 人工测试中反馈：**Generating proposal**
不够醒目，难以判断模型仍在生成、此时需要等待，容易误以为按钮没有响应或流程停住。

**改进方向：** 保留原有 minimal 风格，在生成状态旁加入清楚可见的加载标识，配合简短的
等待文案，例如 **Generating suggestions… Please wait.**。提示应出现在当前任务区域，
生成完成或失败后及时替换，不增加弹窗或重复说明。

**验收标准：**

- 触发生成后立即显示“进行中”的图标 / 加载指示与文字，用户能明确知道请求已开始、需要等待；
  不只依赖颜色区分状态。
- 生成较慢时持续显示有效状态；若显示耗时，使用真实已等待时间，不编造百分比或剩余时间。
- 生成期间避免重复提交，保留已有可用的取消操作；完成、失败或取消后清除加载状态，展示相应结果。
- 深浅主题、窄窗口和放大字体下，提示与长文件名、模型信息、按钮不重叠；减少动态效果偏好下
  仍能通过静态标识和文字识别状态，并提供可访问的状态通知。
- 按 CAP-02 复测正常、慢响应、失败和取消路径；仅改进等待反馈，Review / Apply 的确认边界保持不变。

## UI-05：Summary preview 暗示 Apply 会保存摘要，实际不会写入

**状态：Fixed；原生重载复测 PASS。**

**证据与背景：** 2026-09-17 CAP-02 用户反馈：Review 中有 Summary preview，但 Apply 后笔记没有摘要。
源码确认当前 Apply 只写所选 links / tags 和 reviewed 状态，不写 summary；
“Preview only. Nothing is written until you choose Apply.” 容易被理解为 Apply 后会保存当前摘要。
终态仍保留这句未来时态说明，也与实际状态不符。

**改进方向与验收：** 明确摘要仅帮助检查建议、不会写入笔记；Review 与成功 / 失败终态的文字
各自准确，不暗示 Apply 会保存整个预览。若以后支持保存摘要，需独立可选操作与写入保护，
不得通过修文案顺便把模型摘要自动写入。保留 minimal 风格；人工核对保存范围和提示一致。

**实现：** 标题改为 **Proposal summary**，固定说明 Apply 只写入选中的 links / tags，
摘要仅供审阅且不会加入 note；终态不再显示“点 Apply 前什么都不会写入”的误导文案。
2026-09-17 在真正停用 / 启用插件后的新实例中生成并 Apply；弹窗显示新文案，保存后的测试
笔记只有已选 links、tags 和 reviewed 状态，不含 proposal summary。

## UI-06：Apply 部分写入后显示 Review required，缺少明确恢复操作

**状态：Fixed；正常 Apply 原生重载复测 PASS。**

**证据与背景：** 2026-09-17 CAP-02，用户点击 Apply 后显示 **Review required**，
正文提示 links 可能已写入、frontmatter 未完成；用户无法理解还需审核什么，窗口没有相应恢复入口。
只读检查截图目标 `Sources/Documents/Small local capture fixture.md`：已存在 managed Related notes，
状态仍为 `omd_home_status: inbox`；另两个同源笔记也有相同组合。本项记录为 Apply **FAIL / partial failure**，
不能当成成功后尚待用户点一次 Review。根因是适配器在 `vault.process` 完成 OMD Home 自己的
正文写入后，仍校验写入前的 inode 和 `TFile` 对象；Obsidian 原子刷新后被误判为外部冲突。
旧 **Review required** 还对所有 partial-failure 误称已尝试 rollback，但某些分支根本未进入 rollback。

[用户截图与现场副本](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/cap-02-apply-feedback/evidence.json>) ·
[截图](</Volumes/Transcend_q/ai Memory/.omx/work/release-ux/cap-02-apply-feedback/review-required-user.png>)

**验收标准：**

- 查明本次部分写入的根因，正常 Apply 完成所选 links / tags 与 reviewed 状态；不靠隐藏错误或
  强行改 reviewed 掩盖未完成写入。原用户笔记现场保留。
- 完整成功、写入前 conflict、已回滚失败、部分写入失败明确区分；失败说明用普通语言指出
  已完成与未完成的部分，避免笼统的 Review required 和无证据的 rollback 描述。
- 部分失败提供 **Open note** 等明确入口，指出需检查 Related notes 和 Properties 中的 tags / status；
  后续恢复操作基于当前内容重新校验，不盲目重放旧 proposal、不覆盖其他修改或重复添加 links。
- 完成 / 失败后停止展示暗示“尚未写入，等待 Apply”的预览说明；保留关闭操作。
- 原生复测正常 Apply，确认正文、元数据与 UI 状态一致；修改后的 conflict、frontmatter 失败与
  保护性回滚路径使用可重复的故障注入测试验证，不要求普通用户在 Finder 中竞态修改目标文件。

**实现：** 自有正文写入成功后，适配器重新检查同一安全路径并更新 inode / `TFile`
绑定；写入前校验仍严格，外部身份替换仍拒绝。若正文已写入但重绑定失败，结果正确为
partial failure，不再误报“未写入”的 conflict。终态改为 **Apply incomplete**，说明 links 可能已存在、
Properties 未完成，并提供 **Open note**；点击后关闭弹窗并打开精确 target。旧 Finder 冲突
手工步骤已从普通用户计划移除，改由保留用户修改、不写入旧 proposal 的确定性测试覆盖。

**复测：** 2026-09-17 停用 / 启用插件并通过 Check setup 后，使用独立测试笔记和
`qwen3:0.6b` 完成正常 Apply：终态为 **Applied**，写入 5 个 links、4 个 tags，并把状态改为
`reviewed`；没有再出现 Review required。外部修改、写入前身份替换、自有原子写入后重绑定、
frontmatter 错误和无法安全回滚的部分写入均有确定性自动回归。原始失败现场继续保留为历史证据。

## Obsidian 原生关系与可视化

以下事项复用 Obsidian 的 Graph、Search、Backlinks 和 Bases；不新增 OMD 自有图数据库。P0 / P1
表示本方向内的实施顺序，不改变当前发布阻塞级别。第一阶段不得直接修改 Graph Groups、颜色、
过滤器、Bookmarks 或 workspace 内部配置。

### UI-07：提供可复制的 Graph Groups 查询配方

**状态：Open。优先级：P0。**

**目标：** 在 Vault tags、System 或 Settings 的现有紧凑界面中提供 **Graph group recipes**，让用户
复制基于现有路径、Properties 和 tags 的原生查询，例如 `path:"Sources/Web"`、
`path:"Sources/Documents"`、`[omd_home_status:inbox]`、`[omd_home_status:reviewed]` 和
`tag:#research`。OMD Home 不自动创建或重排 Graph Groups。

**验收标准：**

- 每个配方有清楚名称、准确查询和可键盘操作的 Copy；复制后显示简短反馈。
- 查询须在目标 Obsidian 版本的 Search 与 Graph Groups 中实测；Unicode、空格及特殊字符正确转义。
- 只读取现有 metadata，不新增 Properties，不写 `.obsidian` 内部 Graph / workspace 状态。
- 保留 minimal 风格；深浅主题、窄窗口、长标签及放大字体下无溢出或大型说明卡片。

### UI-08：Apply 成功后提供原生关系视图入口

**状态：Open。优先级：P0。**

**目标：** Enrichment 真正成功后提供 **View connections** 或等义操作，让用户通过当前 TARGET 的
Local Graph 或 Backlinks 查看刚写入的 Markdown links；不新增独立 OMD 图页面。

**验收标准：**

- 仅成功终态显示；目标始终是右上角 TARGET 的精确 note，未选择的候选不得显示为已有关系。
- 优先使用目标 Obsidian 版本验证过的稳定入口；不可用时打开 note 并给出简短的 Local Graph /
  Backlinks 提示，不显示无响应按钮。
- Conflict、Apply incomplete 与 error 保留各自恢复操作，不显示成功含义的关系入口。
- 原生复测 0、1、多个 links，以及长文件名和 Unicode 路径；不自动改 Graph 深度、颜色或过滤器。

### UI-09：笔记行显示入链／出链数量

**状态：Open。优先级：P1。**

**目标：** 在 Recent、Inbox、Continue 和 Pinned 的可见 note 行中，以低干扰样式显示唯一连接数，
例如 `2 in · 3 out`，并提供 Local Graph / Backlinks 次级操作。

**验收标准：**

- 数量来自 Obsidian metadata cache；同一 note 的重复链接不重复计数，Apply 写入的 Related notes
  能在索引刷新后反映出来。
- 复用共享关系索引，不逐行读取正文或重复扫描整个 Vault；create、delete、rename 和 metadata
  changed 后随现有 Home 刷新更新。
- note 主行仍打开 note；关系操作目标准确。零连接状态保持低干扰或省略。
- 窄窗口、长文件名、Pin / Unpin 和 AI tags 控件继续对齐且可点击。

### UI-10：Needs attention 提供原生 Search 查询

**状态：Open。优先级：P1。**

**目标：** 对实际存在的待处理状态提供 **Open search** 和可选的 **Copy query**，例如
`[omd_home_status:inbox]`、`[sync-state:conflict]` 与 `[sync-state:pending]`。用户可自行把查询保存到
Bookmarks 或粘贴进 Graph Groups。

**验收标准：**

- Open search 使用精确查询打开原生 Search，不覆盖其他已经打开的 Search tab 输入。
- Copy query 与打开的查询完全一致；Search 不可用时复制仍可用并有清楚反馈。
- 没有对应问题时不显示空操作；不声称已经替用户创建永久 saved search 或 Bookmark。
- 查询值正确转义，键盘、深浅主题和窄窗口下没有死按钮、截断或焦点丢失。

### UI-11：可选创建 OMD Library.base

**状态：Deferred。优先级：P2。**

**目标：** 在用户明确选择 **Create OMD Library** 后创建普通 `.base` 文件，以 Table / Cards 查看
来源、语言、状态、捕获时间和 tags；不在后台维护第二套资料库。

**验收标准：**

- 仅用户主动操作时创建；不在启动、升级或 Capture 时自动写入，不为此迁移现有 note Properties。
- 目标文件已存在时打开现有文件或要求新名称，绝不静默覆盖；用户修改后 OMD Home 不后台重写。
- Bases 未启用或版本不支持时不创建无效文件，并用简短文案说明要求。
- 使用合成 Vault 验证空库、Unicode 路径、长文件名、同名文件和 Bases 禁用路径；不新增第三方依赖。

### UI-12：在 Home 直接显示 Inbox／Reviewed 工作流状态

**状态：Open。优先级：P0。**

**证据与背景：** `omd_home_status` 当前只作为 Properties 中的内部工作流字段使用：`inbox` 笔记
显示在 OMD Inbox，成功 Apply 后写为 `reviewed` 并从 Inbox 移除。Review 终态虽显示 **Applied**，
但 Home 没有持久显示状态；用户看到笔记消失后，无法直接判断它是已处理、被过滤、尚未刷新或
发生错误，只能打开目标笔记检查 Properties / YAML。`reviewed` 仅表示本次选中的 links、tags 与
状态已完整写入，不表示笔记内容经过人工事实审核。

**改进方向：** 保留原有 minimal 风格，不新增状态面板。Apply 成功页明确显示
**Status · Reviewed**；Recent notes 中仅对带 `omd_home_status` 的笔记显示轻量的 **Inbox**／
**Reviewed** 状态文字；OMD Inbox 空状态说明 **Reviewed notes remain available in Recent notes.**
Properties 继续作为唯一数据源，Home 只呈现其当前值。

**验收标准：**

- Apply 只有在所选 links / tags 与 frontmatter 全部成功写入后才显示 **Status · Reviewed**；
  conflict、Apply incomplete、error 和取消路径不得显示成功状态。
- Recent notes 对带 `omd_home_status: inbox` 或 `reviewed` 的笔记显示对应状态；无该 Property 的普通
  笔记不增加占位文本。Capture 后、Apply 后及 metadata cache 刷新后状态及时更新。
- OMD Inbox 为空时简短说明 reviewed 笔记仍可在 Recent notes 找到；文案不把 `reviewed` 描述为
  内容已经人工核准，也不重复解释内部实现。
- 状态文字复用现有字体、间距与颜色变量，不新增大型卡片；深浅主题、窄窗口、长文件名、Unicode
  路径和放大字体下不挤压 Pin / Unpin、AI tags 或笔记主操作，并且不只依赖颜色表达状态。
- 原生复测 Capture 的 `inbox`、成功 Apply 的 `reviewed`、部分失败仍为 `inbox`、普通笔记无状态，
  同时确认 Properties 与 Home 显示一致。

### UI-13：统一 Capture 弹窗字段、控件与 section 的垂直留白

**状态：Open。优先级：P1（正式发布 UI 收尾）。**

**证据与背景：** 2026-09-20 原生 Capture 弹窗复核发现，这不是单个控件的问题。Recognition 中
**Speech language → No language preference** 的 dropdown 底边几乎贴着字段卡片底边；
**Review links and tags** 的说明文字也靠近卡片底边。Image text language、Polish Markdown 以及
前后的 **Recognition (optional)**／**Optional local AI** section 边界使用了不同的内部与外部间距，
使同一级字段看起来像来自不同布局系统。

[Review links and tags 截图](assets/ui-backlog/ui-13-review-links-spacing.png) ·
[Speech language 截图](assets/ui-backlog/ui-13-speech-language-spacing.png)

**设计复核：** Capture 属于任务型 app UI，应保持当前 minimal 风格、原生 Obsidian 控件和紧凑密度。
问题在于垂直节奏缺少共同规则，不需要更换字体、扩大卡片、添加阴影或装饰。URL / file path、Tags、
Recognition 的 image / speech dropdown、Optional local AI 的两个 toggle，以及底部操作区应共用一套
字段结构：label、helper、control、卡片底边和下一 section 之间的关系一致。

**统一方向：**

- 使用共享的 Capture modal spacing 规则，不分别给 `select`、toggle 或某一语言行添加一次性 margin。
- 字段卡片上下 padding 视觉等量；label 到 helper 保持紧凑，helper 到 dropdown 留出清楚的操作间隔，
  dropdown / 最后一行 helper 到卡片底边保留完整一档留白。
- 同级 section 标题与前一张卡片的距离一致，并明显大于 section 标题与自身说明／首个字段的距离；
  标题应归属于后面的内容，不能贴在上一控件底边。
- toggle 行的 label / helper 作为一个文字块与开关垂直对齐；说明换成两行时卡片自然增高，底部留白
  不得消失。Dropdown 使用相同高度与左右 inset，但不为了对齐强行固定整张卡片高度。
- 优先复用 Obsidian spacing / font 变量；若现有变量不能表达，只在 Capture modal 作用域定义一组
  小型间距 token。字体、颜色、边框和圆角继续沿用当前 minimal 主题。

**验收标准：**

- URL / file path、Tags、Image text language、Speech language、Polish Markdown、Review links and tags
  六类字段逐项对照：文字不贴边，内部上下留白一致，同级 label / helper 的字号、字重、颜色与行高一致。
- Recognition 展开／折叠时，最后一个 dropdown 与 **Optional local AI** 之间没有挤压或突然过大的空洞；
  两个 local AI toggle 与底部 Cancel / Capture 操作区也保持同一节奏。
- Dropdown 使用 **No language preference**、**简体中文 + English**、**繁體中文 + English** 与较长的
  unavailable 选项复测；文字不截断到不可辨认，不改变控件高度或把下方 section 推到边框上。
- Toggle 的 on / off、helper 单行 / 多行以及 validation / unavailable 说明都要复测；不能靠隐藏说明
  维持对齐，也不能改变开关的点击区域或键盘焦点行为。
- 在深浅主题、约 390px 窄弹窗、默认宽度、100% / 150% 字体下原生复测；无裁切、重叠、横向滚动，
  且所有字段仍能通过 Tab 顺序访问。只调整排版，不改变已记住的 Capture 选项或提交语义。

### UI-14：Needs attention 可关闭单条已过期错误

**状态：Open。优先级：P1（正式发布 UI 收尾）；仅记录，尚未实现。**

**证据与背景：** 2026-09-20 CAP-06 人工测试时，Needs attention 仍显示此前 enrichment 的
**Vault AI failed** 和缺失测试模型产生的 **Capture can be retried**。后续流程已经恢复或用户已经
决定不再重试时，这些历史错误仍占据面板，且目前只能等待另一次同类操作覆盖，无法逐条清理。
用户需要关闭单个过期消息，同时保留其他仍有用的错误和恢复操作。

[现场截图](assets/ui-backlog/ui-14-needs-attention-dismiss.png)

**交互方向：** 在可关闭的历史错误卡片右上角加入与现有 minimal 风格一致的 `×` 图标按钮。点击后
立即只移除该条，不弹确认对话框；关闭表示用户不再需要这条提示，不表示底层错误已经修复。由当前
系统状态实时产生、且问题仍存在的 setup／连接状态应在恢复后自动消失，不能靠关闭按钮伪装为 ready。

**验收标准：**

- 每张历史任务错误卡片有独立的关闭按钮；关闭一条不会清空其他 Needs attention 项目、当前任务、
  Recent／Inbox 内容或成功记录，也不会删除已经生成的 note。
- 对带 **Retry capture** 的错误，关闭同时移除该条对应的过期 retry 快照和按钮；不启动 retry、
  不取消其他任务，也不修改 Capture 默认设置。用户仍可从 Capture 重新提交来源。
- 关闭按精确 issue 实例生效，而不是永久屏蔽同类错误；之后新发生的相同错误必须作为新项目再次出现。
- 在同一插件会话中关闭 Home tab、切换布局或重新打开 Home 后，该条不能重新出现；插件重载后不得从
  已失效的运行时对象恢复旧消息。当前仍不健康的 setup／连接检查可基于最新状态重新产生提示。
- `×` 使用 button 语义、明确的 `aria-label`／tooltip 和可见键盘焦点，可通过 Tab 与 Enter／Space
  操作；点击区域足够稳定，不与时间、滚动条、卡片正文或 widget 的 `…`／拖动控件重叠。
- 长来源路径、多行错误、多个错误、只剩一条及清空后的 **Nothing needs attention** 都保持正确排版；
  在深浅主题、窄窗口和 150% 字体下复测。实现时增加单条关闭、retry 记录清理、live setup 状态不可
  被伪装为已解决，以及重新出现的新 issue 等回归测试。

## Capture source 集成缺口

下表区分 OMD 引擎能力与 OMD Home 当前连接状态。**已连接**表示 Home 的单项 Capture 会把干净的
URL 或绝对文件路径交给 OMD；不等于列表中的每个扩展名和站点都已有本轮原生人工 PASS 证据。

| 来源范围 | OMD Home 当前状态 | 证据与剩余边界 |
| --- | --- | --- |
| PDF、DOCX、PPTX、XLSX、HTML、CSV、JSON、XML、EPUB、ZIP | 已连接单文件 Capture | Home 不按扩展名拦截绝对路径，OMD 路由到 MarkItDown；仍需按格式补齐 release fixture / 人工证据 |
| PNG、JPG、WEBP、TIFF、BMP | 已连接单文件 Capture | OCR language 会传给 OMD；扫描 PDF 仍不属于图片 OCR 路径 |
| MP3、WAV、M4A、FLAC、OGG | 已连接单文件 Capture | Speech language 会传给 OMD；依赖本地 Whisper，尚未逐格式完成发布矩阵 |
| 普通文章、WeChat、公开网页 | 已连接干净 URL | OMD inspect 分别路由 MarkItDown / WeChat；不绕过登录、验证码或访问限制 |
| Reddit、X、Bluesky、Mastodon、Threads、Hacker News、Telegram | 已连接干净的公开 URL | OMD inspect 能识别对应 bounded adapter；尚未逐站形成完整原生人工 PASS 证据 |
| Apple Podcasts、YouTube、TikTok、Bilibili | 已连接干净的公开 URL | OMD inspect 路由 podcast / reel，所需下载与转录工具在当前测试机 ready；登录受限媒体不在承诺范围 |
| Douyin | **部分连接** | OMD 引擎支持 share blob 和 reel pipeline，但 Home 拒绝整段分享文字，且没有 Douyin cookies bridge；见 CAPTURE-01 |
| Xiaohongshu / Rednote | **部分连接** | 干净 URL 可到 OMD，但 Home 没有独立 XHS cookies bridge，也不接受整段分享文字；见 CAPTURE-02 |
| 本地文件夹、one-item-per-line 列表 | **未连接** | Home 始终调用单项 `omd capture`，没有 `--batch` 或 batch 入口；见 CAPTURE-03 |

### CAPTURE-01：Douyin 分享文案与本地 cookies bridge

**状态：Open。优先级：P0（若 OMD Home 对用户声明支持 Douyin）。**

**证据与背景：** 2026-09-20 使用用户提供的完整分享文案复核。当前 Capture 只接受以 `http://`、
`https://` 开头的值或绝对本地路径，因此会在调用 OMD 前拒绝
`9.74 … https://v.douyin.com/t6DOaFdc39Q/ …` 这类文本。当前 OMD 已能从同一段文字安全提取短链，
`inspect` 将其识别为 `douyin_url` / `reel`，并报告需要 `f2`、`ffmpeg`、`mlx_whisper` 与 Douyin
cookies。本机三个工具均已安装；缺口位于 OMD Home：它既不提取分享文字中的 URL，也没有配置／
传递 `--douyin-cookies`，所以即使只粘贴干净短链也无法完成需要 cookies 的下载。

**验收标准：**

- Capture 可接受干净 Douyin URL 或包含唯一 HTTP(S) URL 的常见中文分享文案；复用 OMD 的解析规则
  或等价的严格实现。没有 URL、包含多个候选 URL 或非 HTTP(S) scheme 时保留弹窗并给出明确错误，
  不猜测目标。
- Settings 或 Capture 的 Advanced 区提供本地 Douyin Netscape `cookies.txt` 文件选择／路径；只持久化
  必要路径，不读取 cookie 值到插件设置、通知、日志或错误详情，不把 cookie 内容放进命令行。
- 提交前使用 OMD 的 inspect / readiness 结果检查 `f2`、`ffmpeg`、Whisper 和 cookies；缺失、格式
  无效、域不匹配、过期／下载拒绝分别给出简短原因与下一步，Needs attention 的 Retry 保留原 share
  source、Speech language 与 AI 选项。
- 向 OMD 传递经过验证的 `--douyin-cookies` 路径；取消、失败和插件 unload 清理临时状态，不复制
  cookies 到 Vault，也不把 cookies 纳入索引或生成笔记。
- 自动与原生测试覆盖本次完整中文分享文案、干净 `v.douyin.com` URL、Unicode cookies 路径、无
  cookies、错误域、过期 cookies、下载失败、中文转录和 Retry；长分享文字与窄弹窗不破坏布局。

### CAPTURE-02：Xiaohongshu / Rednote 分享文案与独立 cookies bridge

**状态：Open。优先级：P0（若 OMD Home 对用户声明支持 Xiaohongshu / Rednote）。**

**证据与背景：** OMD inspect 会把 `xiaohongshu.com` / Rednote 来源路由到 `xhs`，并明确要求
cookies；OMD Home 当前只有通用 URL / file path 和通用 Capture args，没有 XHS cookies 设置。
整段分享文案同样会被 Home 的前置校验拒绝。Douyin 与 XHS 需要各自的 cookies 文件，不能用一个
含糊的 Default cookies 字段互相代替。

**验收标准：**

- 支持干净的 Xiaohongshu / Rednote URL、`xhslink.com` 短链及含唯一 URL 的常见分享文字；多 URL、
  无 URL 和非 HTTP(S) 输入使用与 CAPTURE-01 相同的确定性校验。
- 提供独立的 XHS / Rednote Netscape `cookies.txt` 路径，并向 OMD 传递 `--xhs-cookies`；不得回退
  使用 Douyin cookies，也不得在日志、Vault、frontmatter 或错误详情中暴露 cookie 内容。
- 提交前显示 source-specific readiness；cookies 缺失、无匹配域、失效、帖子私有／删除／地区受限
  与下载器缺失有不同且可执行的错误说明，Retry 恢复原 Capture 选择。
- 自动与原生测试覆盖公开／受限链接、短链、完整中文分享文案、两种 cookies 同时配置、只配置其中
  一种、Unicode 路径和失效 cookies；不宣称绕过登录、验证码或平台限制。

### CAPTURE-03：本地文件夹与 one-item-per-line batch 入口

**状态：Open。优先级：P1；若 OMD Home 发布文案保留 Local batches，则升级为 P0。**

**证据与背景：** OMD 支持 `omd capture … --batch`，可让文件夹或保存的一行一项列表分别路由。
OMD Home 的 `omdCaptureArgs` 只生成单项 `capture <source> --vault …`，Capture UI 也只描述 URL 或
单个文件。目录当前会到 OMD 后以 `capture_directory_unsupported` 失败；列表文件会被当成普通文件，
不会逐行 Capture。因此发布 UI 目前不能声称支持 Local batches。

**验收标准：**

- 增加明确的 **Capture batch** 入口或可靠的 source 类型选择，不让普通单文件 Capture 静默改变语义；
  文件夹和一行一项列表均明确显示预计 item 数、目标 Vault 和非覆盖规则。
- 只对显式 batch 请求传 `--batch`；每个条目独立规范化和路由，空行／注释规则明确，某一项失败不
  隐藏其他项结果，也不把列表文本本身保存成资料笔记。
- 运行中显示真实完成数与当前条目，支持取消；完成后汇总 succeeded / failed / skipped，并为失败
  条目提供安全 Retry，不生成重复笔记或重复 Needs attention。
- 测试混合 URL、PDF、图片、音频、Unicode／空格路径、重复项、缺失文件、部分失败、取消、插件
  unload 与大列表；窄窗口和长路径下仍保持 minimal 风格和可访问操作。

在以上三项完成前，对外能力说明应写成“OMD 引擎支持，OMD Home 尚未完整接入”，或从 OMD Home
发布页暂时移除 Douyin、Xiaohongshu / Rednote 与 Local batches 的直接支持声明。

## Answer UX / 模型措辞方向

此方向独立于 UI-01–03 的 Settings 视觉整理；关注 Ask vault 答案如何把证据与建议清楚、自然地
呈现给普通用户，不改变 provider 选择或发送权限。

### ANSWER-01：用用户语言呈现原文事实与审慎建议

**状态：Deferred**

**证据与背景：** AI-03 单来源问题的回答虽然正确区分了 `Source states` 与 `Model inference`，
但这两个标题暴露了内部校验术语，容易让用户误以为“1 source”和“model inference”代表两种
来源。回答还使用了 “A cautious planning inference is that …” 这类自我描述，而不是直接给出
有用、审慎的建议。测试笔记只写了 owner 是 Morgan；回答中的 “his” 也加入了未获证据支持的
性别假定。

**改进方向：** 保留内部结构化事实／推论字段、逐项来源引用和最终校验；只调整用户可见的标题、
空状态和模型措辞。例如把 `Source states` 呈现为 **From the note**（笔记明确写到），把非空的
`Model inference` 呈现为 **Possible next step**（可能的下一步）。若没有合理推论，不展示空的
推论分区或 `None.`。模型应直接写出带不确定性边界的建议，例如 “Consider coordinating the review
preparations with Morgan”，避免 “A cautious planning inference is …” 等元话语，以及原文没有
支持的人称、身份或背景假定。

**验收标准：**

- 单来源问题先给准确的原文事实，再给题目要求且有实际帮助的审慎建议；两者仍可被用户区分，
  但不出现 `Source states`、`Model inference`、`source_states` 等内部术语或原始 JSON。
- 没有合理推论时只显示有来源的答案，不出现空标题或 `None.`；题目明确要求推论时不得用隐藏分区
  来掩盖未回答问题。
- 每个实质性事实和建议仍紧邻本次检索来源的引用；复制结果与屏幕显示保持一致；本地与各获准的
  cloud provider 均遵守相同规则。
- 内部结构化输出、引用 allowlist、事实／推论分区校验及不合格答案拒绝展示的安全边界不回退；
  文案改动不改变逐题 preview、用户批准或 provider 路由。

### ANSWER-02：OpenAI 模型可见不等于支持结构化回答

**状态：Open，发布前须修复并复测。**

**证据与背景：** 2026-09-14 人工测试中，OpenAI API 的 `gpt-4` 可被选择，但实际获批回答
返回 HTTP 400；同一 provider 改用 `gpt-4o-mini` 后成功返回有来源引用的答案。OMD Home 的
**Check setup** 当前只通过 provider catalog 核对模型 ID 是否存在，而 Ask vault 需要 OpenAI
Responses API 的严格 JSON schema 输出。OpenAI 的 [GPT-4 模型文档](https://developers.openai.com/api/docs/models/gpt-4)
将 Structured Outputs 标为不支持；`gpt-4o-mini` 的[模型文档](https://developers.openai.com/api/docs/models/gpt-4o-mini)
标为支持。实际 HTTP 400 的响应正文未读取或记录，因此具体被拒参数尚未独立确认；这里的
兼容性缺口由现有请求格式与官方模型能力共同证实，不能归因于本地 `bge-m3` 检索。

**验收标准：**

- OpenAI **Answer model** 和 **Check setup** 将“账户目录中可见”与“支持本插件的严格结构化回答”
  分开；已知不兼容的 `gpt-4` 不得被显示为可直接使用的 ready answer model。保留可见性时，
  在模型附近给出明确原因与可选的兼容模型引导，而不是等用户批准发送后才显示泛化的 HTTP 400。
- 不自动换成 `gpt-4o-mini` 或其他模型；更换模型后仍须重新 Check setup、展示逐题 preview 并由用户
  明确批准。未知新模型按可验证能力处理，不把 catalog presence 当作兼容性证明。
- 受控测试覆盖不兼容模型的预发送阻断、兼容模型的请求格式，以及其他 HTTP 400 的安全分类；
  不向 UI、日志或测试记录泄漏 key、Authorization header、provider response body 或证据片段。
- 用真实目录中有权限的兼容模型及合成笔记完成一次人工回答回归；完整结果应显示来源引用、
  正确 provider/model 和检索模式。此项通过前，不将 AI-04 的模型兼容性判为发布通过。
