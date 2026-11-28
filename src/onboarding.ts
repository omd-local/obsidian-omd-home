export const FIRST_USE_GUIDE_PATH = "OMD Home/Welcome to OMD Home.md";

export const FIRST_USE_GUIDE_TEXT = `# Welcome to OMD Home

Your plugin is ready to use. Image text recognition defaults to English, and audio transcription detects the spoken language automatically. If your images contain text in another language, or you prefer a fixed language for transcription, you can change either setting below.

[Open language settings](obsidian://omd-home-language-settings)

## Before you begin

- **OMD converter:** Capture needs a separate local OMD Engine installation. On macOS, install the prebuilt engine package for your Mac, or move OMD Engine.app to Applications, then open OMD Home settings and choose **Check again**. The plugin does not install the engine for you.
- **Local AI:** Note formatting, summaries, links, and tags use the optional local writing model you choose. Installing Ollama does not download a model; settings provide a model install command and **Check setup** to verify it afterward.
- **Cloud answers:** Cloud providers are opt-in. OMD Home previews the exact selected excerpts and asks before every request.
- **Social capture:** Douyin and Xiaohongshu / Rednote cookies are optional local file paths for posts that need signed-in access.
- **Calendar:** Apple Calendar integration is optional and available on macOS when its helper is installed.

You can close this note and use Home and your existing notes now. Start capturing after the OMD converter is ready; configure AI only when you want to use it.
`;

export function shouldShowFirstUseGuide(stored: unknown): boolean {
  if (!isRecord(stored)) return true;
  if (typeof stored.welcomeGuideShown === "boolean") return !stored.welcomeGuideShown;
  return Object.keys(stored).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
