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

**状态：等待语义已实现；原生复测发现 loading 标识压住文字，视觉修复转 UI-18 / P2。** 生成阶段
持续显示明确的等待文字、非纯颜色的 loading 标识和 live status；减少动态效果时保留静态标识，
阶段结束后自动清除。

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

**状态：已完成；UI-19 的默认关闭 summary 写入选项已通过 RC-P2-02 原生复测。**

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

**当前行为：** UI-19 提供明确、默认不选中的 **Add summary to note**；未勾选时仍保持本项已经验证的
行为。勾选后只写用户最终看到并确认的文本，Apply footer 会准确列出写入范围。

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

以下事项复用 Obsidian 的 Graph、Search、Backlinks 和 Bases；不新增 OMD 自有图数据库。本方向整体
为 Deferred / P2；条目顺序保留早先建议的内部实施先后，不进入本轮 P0 / P1 发布修复。第一阶段
不得直接修改 Graph Groups、颜色、过滤器、Bookmarks 或 workspace 内部配置。

### UI-07：提供可复制的 Graph Groups 查询配方

**状态：Deferred。优先级：P2（本方向内第一批）。**

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

**状态：Deferred。优先级：P2（本方向内第一批）。**

**目标：** Enrichment 真正成功后提供 **View connections** 或等义操作，让用户通过当前 TARGET 的
Local Graph 或 Backlinks 查看刚写入的 Markdown links；不新增独立 OMD 图页面。

**验收标准：**

- 仅成功终态显示；目标始终是右上角 TARGET 的精确 note，未选择的候选不得显示为已有关系。
- 优先使用目标 Obsidian 版本验证过的稳定入口；不可用时打开 note 并给出简短的 Local Graph /
  Backlinks 提示，不显示无响应按钮。
- Conflict、Apply incomplete 与 error 保留各自恢复操作，不显示成功含义的关系入口。
- 原生复测 0、1、多个 links，以及长文件名和 Unicode 路径；不自动改 Graph 深度、颜色或过滤器。

### UI-09：笔记行显示入链／出链数量

**状态：Deferred。优先级：P2（本方向内后续）。**

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

**状态：Deferred。优先级：P2（本方向内后续）。**

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

**状态：已实现。优先级：P0；待原生 Capture / Apply 视觉复测。** Recent 直接读取当前
Properties 并只显示精确的 Inbox／Reviewed；成功终态显示 **Status · Reviewed**，普通笔记及失败终态
不显示工作流状态。

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

**状态：已完成；RC-P2-01 原生视觉复测 PASS。优先级：P1。** Capture modal 使用共享
spacing token，并以足够高且仅限该 modal 的选择器恢复 Obsidian 对最后一项移除的 block-end padding。

**证据与背景：** 2026-09-20 原生 Capture 弹窗复核发现，这不是单个控件的问题。Recognition 中
**Speech language → No language preference** 的 dropdown 底边几乎贴着字段卡片底边；
**Review links and tags** 的说明文字也靠近卡片底边。Image text language、Polish Markdown 以及
前后的 **Recognition (optional)**／**Optional local AI** section 边界使用了不同的内部与外部间距，
使同一级字段看起来像来自不同布局系统。

**2026-09-22 复测更新：** **Speech language** 的 dropdown 下方与卡片底部分隔线之间仍几乎没有
垂直留白；**Review links and tags** 的最后一行 **Suggest links and tags after capture. Review them
before applying.** 同样贴着卡片底边。两处都是“字段最后一个可见元素到容器底边”的 block-end
padding 缺失或被覆盖，不是文字字号问题。修复时应让分隔线位于完整 content padding 之外，并复用
同一个 spacing token；不得分别给这两个控件添加只在当前文案长度下成立的单次 margin。

**2026-09-22 测试方法缺口：** RC-UI-01 C 当前容易被理解为要求拖动 **Capture URL or file**
窗口本身。Capture 使用 Obsidian modal，没有用户可操作的 resize handle，测试者不能把 modal 单独
拖到某个宽度。可操作条件只有 Obsidian 主窗口的可用 viewport 与 **View → Zoom in / Reset zoom**；
modal 应通过现有 viewport 限制自动收缩。若主窗口缩窄后 modal 仍保持固定宽度、超出 viewport 或
产生横向滚动，应直接判为响应式失败，不能要求测试者寻找不存在的 resize 控件。开始下一次人工
复测前，应把 `manual-test-plan.md` 的步骤改成明确调整 Obsidian 主窗口，并记录实际窗口／viewport
宽度；不要写成“缩窄 Capture 窗口”或要求精确拖到约 390px。

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
- **Speech language** 无论显示短选项还是换行的长选项，dropdown 底边到分隔线都必须保留与其他
  字段一致的 block-end padding；分隔线不能参与挤压 dropdown 的高度。
- **Review links and tags** 的 helper 是该卡片最后一个文字块时，其最后一行到卡片底边也必须保留
  完整一档 padding；toggle 的垂直居中不能通过压缩文字块下方空间实现。
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
- 在深浅主题、默认 Obsidian 窗口、缩窄后的主窗口可用 viewport、100% / 150% 字体下原生复测；
  Capture modal 不需要可拖动 resize handle，但必须自动限制在 viewport 内。内容可以纵向滚动，底部
  Cancel / Capture 始终可达；不得裁切、重叠或产生横向滚动，所有字段仍能通过 Tab 顺序访问。
  Reset zoom 后点击 Cancel，不产生 note，也不改变已记住的 Capture 选项。

### UI-14：Needs attention 可关闭单条已过期错误

**状态：已实现。优先级：P1；待原生键盘与窄窗口复测。** 历史 issue 与独立 Retry 可按精确实例
关闭；当前 setup／连接状态继续由实时健康检查驱动，不提供掩盖问题的关闭按钮。

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

## P2：Review 工作区与笔记列表

本组把 2026-09-22 的原生使用反馈作为一个完整流程处理，不先往 note row 上堆更多按钮。本轮按实际
交付顺序完成：**UI-13 → ENRICH-01 → UI-15 → UI-16 / UI-17 → UI-19 → UI-18 → TEST-01**。
自动回归已经通过；RC-P2-01–03 保留原生深浅主题、窄窗口、150% 与真实本地模型验收，不能用源码
完成状态代替人工视觉结果。

这一组继续使用现有 Obsidian 字体、颜色、边框和紧凑密度。目标是让动作更清楚，同时减少每行同时
出现的文字和按钮；不新增大型卡片、渐变、阴影或独立的 OMD 资料库页面。

### ENRICH-01：短笔记不能因模型把新 tag 归错类而整份失败

**状态：已完成；RC-P2-02 真实模型复测 PASS。优先级：P2。** 未知、不透明的内部
`tag-N` reference 现在只省略该 tag 并给出 warning，其余有效 proposal 保留；未知 note/evidence、
越权目标、无效 schema 与保留 tag 继续 fail closed。

**证据与背景：** 用户原本按 RC-UI-01 对 `Small local capture fixture-4` 测试，但该 note 已是
`reviewed`，因此不在 OMD Inbox，也没有可见的 **AI tags** 入口；改用 Inbox 中的
`Small local capture fixture` 后，生成返回：
**The local model suggested a tag outside the current vault catalog. Generate again or choose another local
writing model.** 同一个模型换成内容更长的 note 后可以进入 Review。当前代码只有 Inbox 行显示
**AI tags**；生成本身不会改状态，只有 Review 中成功 Apply 至少一个 link / tag 才会写入
`omd_home_status: reviewed`。因此本项同时暴露了短输入／模型输出兼容性和入口可发现性问题，不能
归为普通视觉问题。

CAP-02-R1 已要求把“模型把透明的新 tag 误报为 existing tag”降级成可审阅的 **New tag**，但当前
原生结果仍落入旧的整体失败映射。开始修复前先记录插件 build、实际 OMD executable、endpoint、
model ID、目标 note 长度、vault tag catalog 与后端原始 error code；区分“载入了旧 OMD binary”与
“新修复没有覆盖另一种小模型输出”，不能仅靠换长 note 或换模型掩盖。

**验收标准：**

- 对语法有效、非保留、但尚未存在于 vault catalog 的透明 tag，若模型误归为 existing，确定性地
  转成默认未选中的 **New tag**；不得伪装成 existing，也不得因此拒绝整份 proposal。
- 无效／保留 tag、未知 existing note、越权目标与不符合 schema 的输出仍按安全边界拒绝；修复不能
  变成接受任意模型文本。若过滤后没有可用建议，打开一个清楚的空 Review 或给出具体原因，不能只
  显示“换模型”这一条泛化建议。
- 失败与 **Generate again** 保留精确 TARGET 和本轮输入；不自动切换模型。错误文案区分 catalog
  刷新、模型格式错误和本地模型不可用，并给出对应下一步。
- 用短／中／长 note、零 tag／已有 tag／新 tag、英文／简中混合内容及至少两个已安装本地模型回归；
  记录短 note 失败、长 note 成功的控制对照，并确认 loaded OMD binary 是预期版本。

### UI-15：用显式 Review 完成 Inbox，而不是让 AI tags 代表“已审阅”

**状态：已完成；RC-P2-02 原生操作复测 PASS。优先级：P2。** Review 现在是右侧
Obsidian `ItemView`：打开 Review 不调用模型，Apply 只保存已选内容并保留 Inbox，只有明确点击
**Done reviewing** 才写入 `reviewed`。关闭、取消、失败和 conflict 均不会暗中完成 Review。

**修复前语义：** Home 把 Inbox 行入口命名为 **AI tags**，但实际打开的是 links / tags proposal
的完整 Review；成功 Apply 任一选择后会同时写入 `reviewed` 并把 note 从 Inbox 移除。生成建议本身
不会改状态，关闭或取消也会保留 Inbox。用户仍容易把“点了 AI tags”理解为仅生成 tags，并把随后
消失的 note 理解为系统自动替自己完成了内容审核。当前也没有“看过 note、不采用任何 AI 建议，但
完成 review”的路径。

**目标流程：** OMD Inbox 行提供清楚的 **Review** 主操作。进入后先查看／编辑 note，再按需运行
**AI tags** 或 **Summarize**；这些辅助动作本身不改变状态。只有用户显式完成 Review 后才写入
`reviewed`。`reviewing` 可以是当前会话的临时 UI 状态，不必新增持久 Property。

**验收标准：**

- `inbox → Review → Done / Mark reviewed → reviewed` 是唯一清楚的成功路径；即使没有采纳任何
  links / tags，也能在看过 note 后显式完成。若建议写入失败、发生 conflict 或用户取消，状态保持
  `inbox`。
- **Generate suggestions** 只生成；**Apply suggestions** 只写用户所选内容；**Done / Mark reviewed**
  才完成队列状态。若最终交互把 Apply 与 Done 合并，按钮和确认文案必须明确同时会写选择并完成
  Review，不能继续只写 **Apply**。
- 普通 `×`、Escape、切 tab 或关闭 Home 不得静默标记 reviewed。若未来坚持“关闭即完成”，该操作
  必须明确命名 **Close and mark reviewed**，并另有 **Keep in Inbox**；不能让无标签的关闭图标产生
  数据写入。
- Inbox 只对未完成项显示一次醒目的 **Review**。Reviewed note 在 Recent 中可通过低优先级
  **Review again** 重新打开，但不能伪装成新的 Inbox 项，也不能重复改写状态或重复插入 links。
- 状态迁移、无修改完成、选中建议完成、Apply 失败、取消、重开 Home 与并发修改都有自动测试；
  UI 文案不得把 `reviewed` 描述为事实正确性、内容质量或模型输出已获认可。

### UI-16：保留 Inbox 作为待办队列，Recent 作为按时间找回的活动记录

**状态：已完成；RC-P2-03 原生操作复测 PASS。优先级：P2。** Inbox 与 Recent 共享
metadata snapshot 和 row renderer；Inbox 保持待办职责，Recent 保持按时间找回职责，并显示明确的
Captured／Updated 时间和仅在 Recent 出现的工作流状态。

**设计决策：** 暂不把两个列表混成一个无差别列表。**OMD Inbox** 只回答“接下来要 review 什么”，
显示 `inbox` 项；**Recent notes** 回答“刚刚转换或处理过什么”，继续包含 Inbox、Reviewed 和普通
recent note，并以最新在前帮助用户在 conversion 与 review 同时运行时找回目标。两者复用同一行
组件和 metadata 读取，但查询目的不同。若后续要减少 dashboard 重复，优先验证同一 **Notes** widget
中的 **Inbox / Recent** tabs，不直接删除待办视图。

**验收标准：**

- Inbox 以待 review 的最新 note 在前，并在标题显示数量；完成 Review 后只从 Inbox 移除，仍能在
  Recent 找到。Recent 使用明确且稳定的时间语义排序，不能因异步 metadata 刷新随机跳序。
- Capture note 优先显示 **Captured** 时间；缺少可靠 capture timestamp 时使用文件 `mtime` 并标为
  **Updated**。行内显示简短相对时间，hover / focus 和辅助技术可取得含时区的完整绝对时间。
- Recent 的 **Inbox / Reviewed** 使用紧凑、非纯颜色的 status chip；层级要比标题弱、比路径清楚。
  普通 note 不添加空 badge。Inbox 内不重复显示显而易见的 Inbox badge。
- 两个列表对同一 note 的标题、路径、状态、时间和 tags 使用同一个 view model；create、rename、
  delete、Capture 完成、Review 完成和 metadata change 后一致刷新，不逐行重读正文。
- 在实现合并或 tabs 前，用并行 conversion + review、空 Inbox、100+ recent notes、长文件名、Unicode
  和窄窗口做一次可用性复核；必须保留“待办队列”和“找回刚才操作”的两个能力。

### UI-17：统一 note row 的时间、tags、筛选与 AI 操作层级

**状态：已完成；RC-P2-03 原生视觉复测 PASS。优先级：P2。** 行内最多显示两个 tag，
筛选支持 Unicode、nested parent tag 与多条件 AND；窄容器把 Review／AI tags／Summarize 收入 `…`
菜单，Pin／Unpin 保持直接可用。Reviewed 项显示低优先级 **Review again**。

**排版方向：** 行的第一层只放 title 和一个上下文主操作；第二层按 `path · time · status` 呈现弱化
metadata。Tags 最多显示两个紧凑 token 和 `+N`，不能把每个 tag、时间和三个文字按钮同时铺满一行。
完整 tags 通过 hover / focus、展开或 note 打开后查看。宽窗口允许一个紧凑的 **AI tags / Summarize**
操作组；窄窗口把这两个有文字 label 的动作折入同一个 `…` menu，顺序和名称保持一致，不能只留
含义不明的图标。

**验收标准：**

- Recent 与 Inbox 都能到达 **AI tags** 和 **Summarize**；Inbox 的上下文主操作仍是 **Review**，
  Recent 的 note 主体仍是打开 note。鼠标 hover、键盘 focus 和触屏下动作均可发现，不靠 hover
  才能访问。
- **Summarize** 默认在同一个 Review surface 生成只读 preview，不自动写 note、不自动标记 reviewed。
  若以后允许保存，必须有独立的 **Add summary to note**、写入范围说明和 conflict 防护，不能复用
  当前 proposal summary 的误导语义。
- Widget header 提供一个紧凑的 tag filter；来源使用 Obsidian metadata cache，选择和清除状态明确，
  结果数随筛选更新。定义 nested tags、多个 tags 的 AND / OR 规则；不把过滤状态写入 note 或在
  Capture 时改变 tags。
- Status、relative time 和 tag token 使用现有 typography / spacing / theme variables；150% 字体、
  深浅主题、约 390px 宽度和超长 tags 下，title 保留主要宽度，Pin / Unpin、Review 与菜单保持对齐。
- 行内操作不得因 status 或 tags 是否存在而左右跳动；所有 icon-only fallback 都有 tooltip、
  `aria-label` 和可见 focus，Tab 顺序与视觉顺序一致。

### UI-18：等待动效使用独立空间，不覆盖 Generating suggestions 文字

**状态：已完成；RC-P2-02 原生视觉复测 PASS。优先级：P2。**

**证据与背景：** 当前 **Generating suggestions… Please wait.** 左侧紫色圆点压在第一个字母上，
看起来像文字渲染错误。修复前把通用 `is-loading` class 和 `::before` spinner 放在同一个文字 badge；
Obsidian／theme 的同名样式可能改变 pseudo-element 定位，因此即使默认主题正常也存在覆盖风险。

[原生截图](assets/ui-backlog/ui-18-generating-suggestions-overlap.png)

**设计方向与验收标准：**

- 改用 OMD namespaced state class 和显式 spinner child；indicator 占有固定的 `1em` 左侧槽位，并通过
  inline flex / grid 与文字保持一个标准 gap，不把 pseudo-element 定位到 glyph 上。
- 使用一个 12–14px 的细环或等价单一指示器，accent 色只用于 indicator；不增加发光、跳动文字、
  多层圆点或大面积紫色背景。动画平稳，不能让 badge 宽度或文字基线抖动。
- 保留 `role=status`、`aria-live` 和现有防重复提交／取消语义。`prefers-reduced-motion` 下停止旋转，
  显示同样占位的静态进度符号和完整等待文字，不能仅靠动画传达状态。
- 在默认主题、常用 community theme、深浅模式、100% / 150% 字体、窄弹窗与长翻译文案下截图复测；
  spinner、边框、文字和左侧状态 rail 均不重叠，完成／失败／取消后不残留。

### UI-19：Proposal summary 可选择随 links 与 tags 一起写入 note

**状态：已完成；RC-P2-02 原生写入与冲突复测 PASS。优先级：P2。** Summary 默认不选，
可编辑并可单独 Apply；受管 block 与 links 在一次正文 transaction 中写入，已有用户 Summary、损坏
markers 和并发修改会安全停止。Apply 后仍为 Inbox。

**原需求与边界：** 修复前 **Proposal summary** 只帮助用户理解模型建议，Apply 永远不写入。用户希望
在 Review 中像选择 existing / new links 与 tags 一样，获得一次把这段 summary 加入目标 note 的
机会。该能力必须是显式 opt-in；继续保留只阅读 summary、只 Apply links / tags 或完全不采用建议的
路径。它与 UI-17 的独立 **Summarize** 工具不同：本项复用当前 proposal 已经返回的 summary，不应
为勾选或 Apply 再调用一次模型。

**交互方向：** 在 **Proposal summary** 卡片内提供清楚的 **Add summary to note** checkbox，默认
不选中。选中后允许在受限文本区域内做最后编辑，并在 Apply footer 中与选择数量一起显示，例如
`2 links · 3 tags · summary`；取消选择后恢复为纯 preview。Summary 可以成为本次唯一的写入选择，
不能继续因没有 link / tag 而返回 **Choose at least one link or tag**。

**验收标准：**

- Apply 前准确列出将写入的 summary、links 和 tags；未选 summary 时保持 UI-05 已验证的当前行为，
  不写入任何 summary 占位、空 heading 或 Property。
- 选中 summary 后，把用户在 Review 中看到并最终确认的文本写入正文中的受管 summary block。位置
  必须确定且稳定，建议位于受管 **Related notes**／`## Full Content` 之前；不得把长摘要塞入
  frontmatter。受管 markers、heading 与最大长度需形成明确格式契约。
- 已存在 OMD 管理的 summary 时应幂等更新，不能重复追加；如果 note 已有用户手写的 Summary section
  或 markers 损坏，不得覆盖或吞并用户内容。界面应说明冲突并保留 Copy / Open note 等安全出口。
- Summary 与受管 links 应在同一次 body transaction 中基于 proposal 的原始 hash 写入；随后 tags／
  status 仍使用相同 conflict 与 rollback 边界。任何并发修改都应阻止旧 summary 覆盖新内容；部分
  失败必须准确说明 summary、links、tags 中哪些可能已经写入。
- 对编辑后的 summary 重新执行长度、控制字符、marker 注入和不安全 HTML 等确定性校验；保留 Unicode、
  简中／繁中／英文及 RTL 文本，不因写入而重新翻译或重新润色。复制和屏幕 preview 与最终正文一致。
- 生成或选择 summary 本身不改变 Inbox / Reviewed；状态迁移遵循 UI-15。若最终按钮同时 Apply 并
  完成 Review，按钮与确认文案必须明确这两个结果。
- 自动与原生测试覆盖：summary only、summary + links、summary + tags、全部选择、未选 summary、空
  summary、编辑后写入、已有 managed block、已有用户 Summary、并发修改、frontmatter 失败回滚、
  重复 Apply、长文件名、窄窗口和 150% 字体。

### TEST-01：Review 回归 fixture 不依赖已经离开 Inbox 的固定文件名

**状态：已完成；可重置 fixture 与 RC-P2-01–03 原生执行均 PASS。优先级：P2。**

**问题：** 当前 RC-UI-01 写死从 `Small local capture fixture-4` 的 Inbox 行点击 **AI tags**；但该
note 一旦完成 Apply 就是 `reviewed`，按设计不会继续出现在 Inbox。测试者只能换用另一个 note，
从而把 fixture 状态、短 note 失败和 UI 回归混在一起。

**验收标准：**

- 在 Case 开始时创建或 reset 一个名称唯一、内容固定、明确带 `omd_home_status: inbox` 的短 note；
  另建中／长 note 作为控制组。不要依赖递增后缀 `-4` 或前一轮测试遗留状态。
- 步骤先验证该 note 同时出现在 Inbox 与 Recent，再从 **Review** 入口运行 AI tags / Summarize，最后
  验证 Done 后只从 Inbox 消失、Recent 仍可按时间和状态找到。
- 记录 model、endpoint、OMD executable / version、插件 build 与实际错误 code；重复测试前恢复
  fixture，不用重新 Capture 产生另一个不可预测的文件名。
- 把首次测试与已通过证据分开；UI-15–19 完成后更新 `manual-test-plan.md` 的当前执行队列与例子，
  并保留本次短 note 失败和 loading overlap 截图作为回归基线。

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

**状态：Deferred。优先级：P2。发布决策：OMD Home 当前不声明该集成已经接入。**

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

**状态：Deferred。优先级：P2。发布决策：OMD Home 当前不声明该集成已经接入。**

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

**状态：Deferred。优先级：P2。发布决策：OMD Home 当前不声明 Local batches 已接入。**

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

以上三项保留为 Deferred / P2 backlog。在完成前，对外能力说明应写成“OMD 引擎支持，OMD Home
尚未完整接入”，并且不得在 OMD Home 发布页直接声明支持 cookie-gated Douyin、Xiaohongshu /
Rednote 分享文字或 Local batches。

## Answer UX / 模型措辞方向

此方向独立于 UI-01–03 的 Settings 视觉整理；关注 Ask vault 答案如何把证据与建议清楚、自然地
呈现给普通用户，不改变 provider 选择或发送权限。

### ANSWER-01：用用户语言呈现原文事实与审慎建议

**状态：Deferred。优先级：P2。**

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

**状态：已实现自动修复，仍需 AI-04 有效 OpenAI key 原生复测。** OMD 后端现在负责精确的
provider／model 回答契约，Home 只消费检查结果；`gpt-4.1` 可按已验证 strict schema 进入 ready，
`gpt-4` 与未验证型号不会因出现在 catalog 中就成为 ready。Check setup 与发送前门槛都要求同一
provider／model 的检查仍有效，不会自动换模型或把 OpenAI strict schema 降级为 JSON mode。

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

### UI-20：Answer provider 在关闭状态保持可读

**状态：已修复并通过隔离原生视觉复测。优先级：P1。** AI answers 的 provider 行现在给说明列和
控件列稳定的最小宽度；下拉框占满控件列。原生 Obsidian 在约 500px Settings viewport 下实测
select 为 189px，当前 **Ollama on this computer** 完整可读，页面没有横向滚动；宽面板为 564px。

继续保持原有 minimal Settings 排版，不固定整行高度，也不为单个 provider 写特殊宽度。后续新增
更长 provider 名称时，AI-00 仍需检查宽／窄面板、150% 字体、键盘 focus 与关闭状态；不能只在
下拉展开后确认 option 可见。

### ANSWER-03：区分本次 keyword fallback 与以后问题的默认检索

**状态：已修复并通过原生动作矩阵。优先级：P1。** 结果已经显示 **Keyword search** 时，恢复动作
不再写成容易被理解为“再次切换本次答案”的 **Switch to keyword search**。按钮现为
**Use keyword search by default**，title 明确它会关闭以后问题的 semantic search；点击后显示
**Keyword search is default**。如果持久设置本来就是 keyword-only，该按钮不渲染，只保留与当前
故障相符的 Install model／Open retrieval settings。

本次答案仍只执行一次；按钮不会重发问题、改变 provider 或安装模型。隔离原生复测确认 hybrid
开启时显示三个准确动作，关闭后重复渲染只显示 Install model（适用时）与 Open retrieval settings，
并在测试后恢复原设置。

### ANSWER-04：DeepSeek Pro 结构化答案不能把输出预算耗尽在 thinking

**状态：后端已修复并通过自动回归；真实 DeepSeek key 的 `deepseek-v4-pro`／`deepseek-flash`
对照仍需 ANSWER-02-R1 原生实网复测。优先级：P0。** 用户观察到 `deepseek-v4-pro` 返回
**stopped before completing**，而 `deepseek-flash` 成功。该安全错误表示流在完整结构化答案前结束；
结合 DeepSeek 当前默认开启高强度 thinking，以及 OMD grounded answer 的 1200-token 有界输出，
最可能的原因是 Pro 的 reasoning 消耗了可用输出预算。由于错误路径有意不保存 provider 原始正文，
不能把这一次历史请求断言为已确认的 `finish_reason=length`。

OMD 现在只对带 `output_schema` 的 DeepSeek 请求同时发送 JSON mode 与显式
`thinking: {type: disabled}`，把预算留给最终 JSON；普通非结构化请求不受影响。没有通过提高 token
上限掩盖问题，也没有自动改用 Flash。后端 1685 tests、Ruff 和过滤 AppleDouble 文件后的
`py_compile` 通过。人工回归必须分别显示两个真实 model ID、完整引用答案与各自耗时；没有 key、
catalog 无型号或账号无权限时记为 `NOT RUN`，不能把 Flash 成功代替 Pro 通过。
