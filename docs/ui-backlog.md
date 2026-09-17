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

**状态：Open，已记录，尚未实现。**

**证据与背景：** 2026-09-17 CAP-02 用户反馈：Review 中有 Summary preview，但 Apply 后笔记没有摘要。
源码确认当前 Apply 只写所选 links / tags 和 reviewed 状态，不写 summary；
“Preview only. Nothing is written until you choose Apply.” 容易被理解为 Apply 后会保存当前摘要。
终态仍保留这句未来时态说明，也与实际状态不符。

**改进方向与验收：** 明确摘要仅帮助检查建议、不会写入笔记；Review 与成功 / 失败终态的文字
各自准确，不暗示 Apply 会保存整个预览。若以后支持保存摘要，需独立可选操作与写入保护，
不得通过修文案顺便把模型摘要自动写入。保留 minimal 风格；人工核对保存范围和提示一致。

## UI-06：Apply 部分写入后显示 Review required，缺少明确恢复操作

**状态：Open，发布阻塞；功能失败与恢复 UX 均待修复 / 复测。**

**证据与背景：** 2026-09-17 CAP-02，用户点击 Apply 后显示 **Review required**，
正文提示 links 可能已写入、frontmatter 未完成；用户无法理解还需审核什么，窗口没有相应恢复入口。
只读检查截图目标 `Sources/Documents/Small local capture fixture.md`：已存在 managed Related notes，
状态仍为 `omd_home_status: inbox`；另两个同源笔记也有相同组合。本项记录为 Apply **FAIL / partial failure**，
不能当成成功后尚待用户点一次 Review。具体失败根因待诊断；多个分支会进入 partial-failure，
不得仅凭标题认定已实际执行过 rollback。

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
- 原生复测正常 Apply、修改后的 conflict、frontmatter 失败与保护性回滚路径，确认正文、元数据、
  UI 状态一致。CAP-02 本项通过前不得作为发布验收通过。

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
