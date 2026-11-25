export interface OllamaAppLaunchOptions {
  timeout: number;
  windowsHide: boolean;
}

export type OllamaAppExecFile = (
  executable: string,
  args: string[],
  options: OllamaAppLaunchOptions,
  callback: (error: Error | null) => void,
) => unknown;

export function canOpenOllamaDesktopApp(platform: string = desktopPlatform()): boolean {
  return platform === "darwin";
}

export async function openOllamaDesktopApp(
  execFile: OllamaAppExecFile | null = desktopExecFile(),
  platform: string = desktopPlatform(),
): Promise<void> {
  if (!canOpenOllamaDesktopApp(platform)) {
    throw new Error("OMD Home can open the Ollama desktop app automatically on macOS only.");
  }
  if (!execFile) throw new Error("Desktop process APIs are unavailable.");

  await new Promise<void>((resolve, reject) => {
    execFile(
      "/usr/bin/open",
      ["-a", "Ollama"],
      { timeout: 5_000, windowsHide: true },
      (error) => {
        if (error) {
          reject(new Error("The Ollama app could not be opened from Applications.", { cause: error }));
          return;
        }
        resolve();
      },
    );
  });
}

function desktopExecFile(): OllamaAppExecFile | null {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:child_process") };
  const execFile = runtimeWindow.require?.("node:child_process").execFile;
  return execFile ?? null;
}

function desktopPlatform(): string {
  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:process") };
    const platform = runtimeWindow.require?.("node:process").platform;
    if (platform) return platform;
  }
  return typeof process === "undefined" ? "" : process.platform;
}
