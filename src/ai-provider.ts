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

export function isOllamaCloudModel(
  model: Pick<LocalAiModelEntry, "name" | "remoteModel" | "remoteHost">,
): boolean {
  return Boolean(model.remoteModel || model.remoteHost || /(?:^|[:_-])cloud$/iu.test(model.name.trim()));
}

export function providerSetupDescription(provider: StoredAiProvider): string {
  switch (provider) {
    case "ollama":
      return "Vault evidence stays on this computer. OMD Home verifies Ollama local-only mode before every answer.";
    case "ollama-cloud":
      return "Check setup reads Cloud availability and model metadata from the local Ollama app without sending vault content. This build keeps hosted Vault Q&A disabled.";
    case "openai":
      return "Check setup authenticates with your developer API key and reads the provider model catalog without sending vault content. ChatGPT subscriptions and API billing are separate. This build keeps hosted Vault Q&A disabled.";
    case "anthropic":
      return "Check setup authenticates with your developer API key and reads the provider model catalog without sending vault content. Claude subscriptions and API billing are separate. This build keeps hosted Vault Q&A disabled.";
    case "deepseek":
      return "Check setup authenticates with your developer API key and reads the provider model catalog without sending vault content. This build keeps hosted Vault Q&A disabled.";
  }
}
