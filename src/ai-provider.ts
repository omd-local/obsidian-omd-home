import type { LocalAiModelEntry, StoredAiProvider } from "./ollama-local-types.ts";

export const AI_PROVIDER_VALUES = [
  "ollama",
  "ollama-cloud",
  "openai",
  "anthropic",
  "deepseek",
] as const satisfies readonly StoredAiProvider[];

export type HostedApiProvider = Exclude<StoredAiProvider, "ollama" | "ollama-cloud">;
export type AiModelMemory = Record<StoredAiProvider, string>;

export const DEFAULT_AI_MODELS: AiModelMemory = {
  ollama: "qwen3:4b-instruct",
  "ollama-cloud": "",
  openai: "",
  anthropic: "",
  deepseek: "",
};

const PROVIDER_LABELS: Record<StoredAiProvider, string> = {
  ollama: "Ollama on this computer",
  "ollama-cloud": "Ollama Cloud",
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  deepseek: "DeepSeek API",
};

const PROVIDER_DESTINATIONS: Record<StoredAiProvider, string> = {
  ollama: "This computer",
  "ollama-cloud": "ollama.com",
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  deepseek: "api.deepseek.com",
};

const PROVIDER_ENV_VARS: Record<HostedApiProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

export function isStoredAiProvider(value: unknown): value is StoredAiProvider {
  return typeof value === "string" && (AI_PROVIDER_VALUES as readonly string[]).includes(value);
}

export function isHostedApiProvider(provider: StoredAiProvider): provider is HostedApiProvider {
  return provider === "openai" || provider === "anthropic" || provider === "deepseek";
}

export function isCloudAiProvider(provider: StoredAiProvider): boolean {
  return provider !== "ollama";
}

export function cloudAnswerPermissionEnabled(settings: {
  aiProvider: StoredAiProvider;
  allowedCloudAnswerProviders: StoredAiProvider[];
}): boolean {
  return isCloudAiProvider(settings.aiProvider)
    && settings.allowedCloudAnswerProviders.includes(settings.aiProvider);
}

export function aiProviderLabel(provider: StoredAiProvider): string {
  return PROVIDER_LABELS[provider];
}

export function aiProviderDestination(provider: StoredAiProvider): string {
  return PROVIDER_DESTINATIONS[provider];
}

export function aiProviderEnvVar(provider: HostedApiProvider): string {
  return PROVIDER_ENV_VARS[provider];
}

export function normalizeAiModelMemory(
  raw: unknown,
  legacyProvider: StoredAiProvider,
  legacyModel: string,
): AiModelMemory {
  const input = raw && typeof raw === "object" ? raw as Partial<Record<StoredAiProvider, unknown>> : {};
  const memory = { ...DEFAULT_AI_MODELS };
  for (const provider of AI_PROVIDER_VALUES) {
    const value = input[provider];
    if (typeof value === "string") memory[provider] = value.trim();
  }
  const migrated = legacyModel.trim();
  if (migrated && typeof input[legacyProvider] !== "string") memory[legacyProvider] = migrated;
  return memory;
}

export function selectedAiModel(settings: {
  aiProvider: StoredAiProvider;
  aiModel: string;
  aiModels: AiModelMemory;
}): string {
  return settings.aiModels[settings.aiProvider]?.trim() || settings.aiModel.trim();
}

export function modelIsCloudBacked(
  model: Pick<LocalAiModelEntry, "name" | "remoteModel" | "remoteHost">,
): boolean {
  if (model.remoteModel?.trim() || model.remoteHost?.trim()) return true;
  return model.name
    .trim()
    .toLowerCase()
    .split(/[:/_.@-]+/u)
    .includes("cloud");
}

export function providerSetupDescription(provider: StoredAiProvider): string {
  switch (provider) {
    case "ollama":
      return "Vault evidence and answer generation stay on this computer. Cloud availability in the Ollama app does not change the selected model; OMD Home rejects explicit Cloud model ids and models that report remote metadata.";
    case "ollama-cloud":
      return "Retrieval stays on this computer. After a per-request preview, the question and selected evidence are sent through the signed-in local Ollama app to Ollama Cloud.";
    case "openai":
      return "Retrieval stays on this computer. After a per-request preview, the question and selected evidence are sent to the OpenAI API. ChatGPT subscriptions and API billing are separate.";
    case "anthropic":
      return "Retrieval stays on this computer. After a per-request preview, the question and selected evidence are sent to the Anthropic API. Claude subscriptions and API billing are separate.";
    case "deepseek":
      return "Retrieval stays on this computer. After a per-request preview, the question and selected evidence are sent to the DeepSeek API.";
  }
}
