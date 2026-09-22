---
omd_home_status: inbox
captured_at: 2026-09-23T09:05:00+12:00
tags:
  - omd-release-fixture
  - review/multilingual
  - language/中文
  - language/العربية
---

# OMD Review Multilingual Long Filename 中文 العربية

This note is long enough to give small local writing models a stable topic while testing long filenames, mixed scripts, nested tags, relative time, and responsive actions. It explains that OMD Home keeps captured notes in an Inbox until the user explicitly finishes review. Applying a summary, a related-note link, or a tag must preserve the Inbox state. Choosing Done reviewing changes only the workflow status to Reviewed.

简体中文段落：这个测试笔记用于检查长文件名、标签筛选、摘要写入和窄窗口排版。用户可以先生成建议，编辑摘要，再决定是否写入；关闭侧栏不应自动完成审核。

فقرة عربية: تتحقق هذه الملاحظة من اتجاه النص ووضوح الوسوم ووقت التحديث في نافذة ضيقة. يجب ألا يغيّر إنشاء الاقتراحات حالة الملاحظة تلقائياً.

The stable evidence marker is `OMD-REVIEW-MULTILINGUAL-923`. The existing group is `review`; a useful new tag is `workflow/evidence`. Suggested separate note topics may be shown as ideas, but they must not be written as tags unless the model also returns them in New tags and the user selects them.

## Full Content

Review is an explicit user decision. Summary, links, and tags are optional proposal items.
