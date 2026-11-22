export const FIRST_USE_GUIDE_PATH = "OMD Home/Welcome to OMD Home.md";

export const FIRST_USE_GUIDE_TEXT = `# Welcome to OMD Home

Your plugin is ready to use. Image text recognition defaults to English, and audio transcription detects the spoken language automatically. If your images contain text in another language, or you prefer a fixed language for transcription, you can change either setting below.

[Open language settings](obsidian://omd-home-language-settings)

## Before you begin

- **OMD converter:** Capture needs a ready local OMD installation. Open OMD Home settings and use **Check again** if setup needs attention.
- **Local AI:** Note formatting, summaries, links, and tags use the optional local writing model you choose.
- **Cloud answers:** Cloud providers are opt-in. OMD Home previews the exact selected excerpts and asks before every request.
- **Social capture:** Douyin and Xiaohongshu / Rednote cookies are optional local file paths for posts that need signed-in access.
- **Calendar:** Apple Calendar integration is optional and available on macOS when its helper is installed.

You can keep every default, close this note, and start capturing immediately.
`;

export function shouldShowFirstUseGuide(stored: unknown): boolean {
  if (!isRecord(stored)) return true;
  if (typeof stored.welcomeGuideShown === "boolean") return !stored.welcomeGuideShown;
  return Object.keys(stored).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
