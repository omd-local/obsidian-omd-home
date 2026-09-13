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
