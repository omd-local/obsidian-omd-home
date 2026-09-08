# UI backlog（deferred）

本文件仅记录已经观察到、但不属于当前实现范围的 UI 收尾事项。每项均为 deferred；本文不构成
实现完成或排期承诺。

## UI-01：Settings section 标题与 helper/note 的字体层级不一致

**状态：Deferred**

**证据与背景：** 在 Settings 的多个 section 中，紧贴 section 标题下方的 helper/note 文本在字号、
字重或颜色层级上不一致。有的看起来像正文说明，有的又像较弱的注释；用户连续浏览设置时会难以
判断哪些文字是同一层级的补充说明。此项涵盖同级 section 标题及其紧随的 helper/note，不扩展到表单 label、
错误状态或整个 Settings 的排版重做。

**验收标准：**

- 同级 section 标题彼此一致；其下 helper/note 也各自使用一致的字体、字重、字号、行高与对比层级，保留标题和说明之间的层级区别。
- 说明文字与错误/成功状态、可交互控件 label 仍能清楚区分。
- 窄宽 Settings 面板下不会因统一样式而截断、重叠或削弱可读性。

## UI-02：DeepSeek Developer key 与授权开关的说明/控件对齐不一致

**状态：Deferred**

**证据与背景：** 在 DeepSeek provider 设置中，**Developer key** 的说明与输入控件、以及
**Allow DeepSeek API answers** 的说明与开关，采用了不同的水平对齐/间距关系。两项都属于同一
provider-scoped 主流程，视觉节奏不一致会让 credential 与显式授权的关系显得断裂。此项只记录
对齐与间距问题，不改变授权语义、文案或 API 行为。

**验收标准：**

- Developer key 与 Allow DeepSeek API answers 在相同容器/列宽下具有一致的 label、说明和控件
  左右对齐规则及垂直间距。
- secret input、toggle、help text 和键盘 focus 状态在宽、窄 Settings 面板都保持可读且不重叠。
- 对齐调整不掩盖或弱化 DeepSeek API answers 的显式 opt-in 含义。
