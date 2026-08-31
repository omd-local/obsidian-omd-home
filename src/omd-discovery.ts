import { isEnrichmentError, OmdEnrichmentError } from "./enrichment/errors.ts";

export const OMD_INSTALL_GUIDE_URL = "https://github.com/omd-local/markdown-everything#quick-start";

export type OmdDiscoveryMode = "automatic" | "custom";

export interface OmdDiscoveryEnvironment {
  platform: NodeJS.Platform;
  homeDirectory: string;
  condaPrefix?: string;
  virtualEnvironment?: string;
}

export interface OmdDiscoveryResult {
  executable: string;
  mode: OmdDiscoveryMode;
  candidatesTried: string[];
}

export interface OmdInstallInstructions {
  buttonLabel: string;
  notice: string;
  commands: string;
}

export type OmdCapabilityProbe = (executable: string) => Promise<unknown>;

export function isAutomaticOmdExecutable(value: string): boolean {
  const executable = value.trim().toLowerCase();
  return !executable || executable === "omd" || executable === "omd.exe";
}

export function omdExecutableCandidates(
  configuredExecutable: string,
  environment: OmdDiscoveryEnvironment,
): string[] {
  const configured = configuredExecutable.trim();
  if (!isAutomaticOmdExecutable(configured)) return [configured];

  const executableName = environment.platform === "win32" ? "omd.exe" : "omd";
  const candidates = environment.platform === "win32" ? ["omd", "omd.exe"] : ["omd"];
  const environmentPrefixes = [environment.condaPrefix, environment.virtualEnvironment];
  for (const prefix of environmentPrefixes) {
    if (prefix?.trim()) candidates.push(executableInPrefix(prefix, executableName, environment.platform));
  }

  if (environment.platform === "darwin") {
    candidates.push(
      "/opt/homebrew/bin/omd",
      "/usr/local/bin/omd",
      "/opt/local/bin/omd",
      "/opt/homebrew/Caskroom/miniconda/base/bin/omd",
      "/usr/local/Caskroom/miniconda/base/bin/omd",
    );
  } else if (environment.platform !== "win32") {
    candidates.push("/usr/local/bin/omd", "/usr/bin/omd", "/snap/bin/omd");
  }

  const home = environment.homeDirectory.trim().replace(/[\\/]+$/u, "");
  if (home) {
    if (environment.platform === "win32") {
      candidates.push(
        executableInPrefix(`${home}\\miniconda3`, executableName, environment.platform),
        executableInPrefix(`${home}\\anaconda3`, executableName, environment.platform),
        executableInPrefix(`${home}\\miniforge3`, executableName, environment.platform),
        executableInPrefix(`${home}\\mambaforge`, executableName, environment.platform),
      );
    } else {
      candidates.push(
        `${home}/.local/bin/omd`,
        `${home}/miniconda3/bin/omd`,
        `${home}/anaconda3/bin/omd`,
        `${home}/miniforge3/bin/omd`,
        `${home}/mambaforge/bin/omd`,
      );
    }
  }

  return uniqueNonEmpty(candidates);
}

export async function discoverOmdExecutable(
  configuredExecutable: string,
  environment: OmdDiscoveryEnvironment,
  probe: OmdCapabilityProbe,
): Promise<OmdDiscoveryResult> {
  const candidates = omdExecutableCandidates(configuredExecutable, environment);
  const candidatesTried: string[] = [];
  let preferredError: unknown;

  for (const executable of candidates) {
    candidatesTried.push(executable);
    try {
      await probe(executable);
      return {
        executable,
        mode: isAutomaticOmdExecutable(configuredExecutable) ? "automatic" : "custom",
        candidatesTried,
      };
    } catch (error) {
      if (isEnrichmentError(error) && error.code === "cancelled") throw error;
      preferredError = chooseMoreActionableError(preferredError, error);
    }
  }

  if (preferredError instanceof Error) throw preferredError;
  if (preferredError) {
    throw new OmdEnrichmentError("omd_failed", "OMD discovery failed while checking a local candidate.");
  }
  throw new OmdEnrichmentError(
    "missing_executable",
    "OMD was not found in common install locations.",
  );
}

export function omdInstallInstructions(platform: NodeJS.Platform): OmdInstallInstructions {
  if (platform === "darwin") {
    return {
      buttonLabel: "Copy install commands",
      notice: "Copied the official Homebrew install commands.",
      commands: "brew install omd-local/omd/omd\nomd doctor",
    };
  }
  if (platform === "win32") {
    return {
      buttonLabel: "Copy install steps",
      notice: "Copied the official source install steps.",
      commands: [
        "git clone https://github.com/omd-local/markdown-everything.git",
        "cd markdown-everything",
        "py -m pip install -e \".[all]\"",
        "omd doctor",
      ].join("\n"),
    };
  }
  return {
    buttonLabel: "Copy install steps",
    notice: "Copied the official source install steps.",
    commands: [
      "git clone https://github.com/omd-local/markdown-everything.git",
      "cd markdown-everything",
      "python3 -m pip install -e '.[all]'",
      "omd doctor",
    ].join("\n"),
  };
}

function executableInPrefix(prefix: string, executableName: string, platform: NodeJS.Platform): string {
  const cleanPrefix = prefix.trim().replace(/[\\/]+$/u, "");
  return platform === "win32"
    ? `${cleanPrefix}\\Scripts\\${executableName}`
    : `${cleanPrefix}/bin/${executableName}`;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function chooseMoreActionableError(current: unknown, candidate: unknown): unknown {
  return errorPriority(candidate) > errorPriority(current) ? candidate : current;
}

function errorPriority(error: unknown): number {
  if (!isEnrichmentError(error)) return error ? 2 : 0;
  if (error.code === "unsupported_capability" || error.code === "unsupported_schema") return 5;
  if (error.code === "capability_timeout" || error.code === "capability_invalid_json") return 4;
  if (error.code === "missing_executable") return 1;
  return 3;
}
