import { normalizeCaptureSource } from "./omnibox-utils.ts";

export const OCR_LANGUAGE_PRESETS = ["eng", "chi_sim+eng", "chi_tra+eng"] as const;

export type OcrLanguagePreset = typeof OCR_LANGUAGE_PRESETS[number];
export type CaptureAsrSetting = "inherit-adapter-default" | "auto-detect" | "en" | "zh";

export type CaptureOcrOption =
  | Readonly<{ mode: "inherit" }>
  | Readonly<{ mode: "preset"; language: OcrLanguagePreset }>
  | Readonly<{ mode: "custom"; language: string }>;

export type CaptureAsrOption =
  | Readonly<{ mode: "inherit-adapter-default" }>
  | Readonly<{ mode: "auto-detect" }>
  | Readonly<{ mode: "explicit"; language: "en" | "zh" }>;

export interface CaptureRequest {
  readonly source: string;
  readonly tags: readonly string[];
  readonly polish: boolean;
  readonly suggest: boolean;
  readonly ocr: CaptureOcrOption;
  readonly asr: CaptureAsrOption;
}

export type CaptureFailureIssueContext = "capture" | "ai";

export interface CaptureFailureRecord {
  readonly id: number;
  readonly issueId: number;
  readonly issueContext: CaptureFailureIssueContext;
  readonly failedAt: number;
  readonly detail: string;
  readonly request: CaptureRequest;
}

export type CaptureLanguageAvailability = Readonly<{
  status: "unchecked" | "supported" | "unsupported";
  message: string;
  ocrPresets: readonly Readonly<{ label: string; value: OcrLanguagePreset }>[];
  customOcr: boolean;
  ocrBackendAvailable: boolean | null;
  ocrInstalledPacks: readonly string[] | null;
  asrAutoDetect: boolean;
  asrExplicit: boolean;
}>;

export interface CaptureRequestInput {
  source: string;
  tags?: readonly string[];
  polish?: boolean;
  suggest?: boolean;
  ocr?: CaptureOcrOption;
  asr?: CaptureAsrOption;
}

export interface CaptureRequestSettings {
  capturePolish: boolean;
  captureSuggestLinksAndTags: boolean;
  captureOcrLanguage: string;
  captureAsrLanguage: CaptureAsrSetting;
}

export function createCaptureRequest(input: CaptureRequestInput): CaptureRequest {
  const tags = Object.freeze((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean));
  const ocr = Object.freeze(normalizeOcrOption(input.ocr ?? { mode: "inherit" }));
  const asr = Object.freeze(normalizeAsrOption(input.asr ?? { mode: "inherit-adapter-default" }));
  return Object.freeze({
    source: normalizeCaptureSource(input.source),
    tags,
    polish: input.polish === true,
    suggest: input.suggest === true,
    ocr,
    asr,
  });
}

export function createCaptureFailureRecord(
  id: number,
  issueId: number,
  issueContext: CaptureFailureIssueContext,
  failedAt: number,
  detail: string,
  request: CaptureRequest,
): CaptureFailureRecord {
  return Object.freeze({
    id,
    issueId,
    issueContext,
    failedAt: Number.isFinite(failedAt) ? Math.max(0, failedAt) : 0,
    detail: detail.trim() || "Capture did not finish.",
    request: createCaptureRequest(request),
  });
}

export function captureFailureForIssue(
  failure: CaptureFailureRecord | null,
  issueId: number,
): CaptureFailureRecord | null {
  return failure?.issueId === issueId ? failure : null;
}

export function captureRequestFromSettings(
  source: string,
  settings: CaptureRequestSettings,
): CaptureRequest {
  return createCaptureRequest({
    source,
    tags: [],
    polish: settings.capturePolish,
    suggest: settings.captureSuggestLinksAndTags,
    ocr: ocrOptionFromSetting(settings.captureOcrLanguage),
    asr: asrOptionFromSetting(settings.captureAsrLanguage),
  });
}

export function hasCaptureLanguageOverrides(
  request: Pick<CaptureRequest, "ocr" | "asr">,
): boolean {
  return request.ocr.mode !== "inherit" || request.asr.mode !== "inherit-adapter-default";
}

export function ocrLanguageValue(option: CaptureOcrOption): string | null {
  return option.mode === "inherit" ? null : option.language;
}

export function whisperLanguageValue(option: CaptureAsrOption): string | null {
  if (option.mode === "inherit-adapter-default") return null;
  return option.mode === "auto-detect" ? "auto" : option.language;
}

export function isSafeCustomOcrLanguage(value: string): boolean {
  return normalizeOcrLanguageSet(value) !== null;
}

export function normalizeOcrLanguageSet(value: string): string | null {
  if (!value.trim() || value.length > 256) return null;
  const rawPacks = value.split("+");
  if (rawPacks.length > 8) return null;
  const packs: string[] = [];
  const seen = new Set<string>();
  for (const rawPack of rawPacks) {
    const pack = rawPack.trim();
    if (
      !pack
      || pack.length > 64
      || pack.includes("..")
      || !/^[A-Za-z][A-Za-z0-9_-]*(?:\/[A-Za-z][A-Za-z0-9_-]*)?$/u.test(pack)
    ) return null;
    if (!seen.has(pack)) {
      packs.push(pack);
      seen.add(pack);
    }
  }
  return packs.join("+");
}

export function missingInstalledOcrPacks(
  language: string,
  installedPacks: readonly string[] | null,
): string[] {
  if (installedPacks === null) return [];
  const normalized = normalizeOcrLanguageSet(language);
  if (!normalized) return [];
  const installed = new Set(installedPacks);
  return normalized.split("+").filter((pack) => !installed.has(pack));
}

export function filterReadyOcrPresets<T extends Readonly<{ value: string }>>(
  presets: readonly T[],
  backendAvailable: boolean | null,
  installedPacks: readonly string[] | null,
): T[] {
  if (backendAvailable === false) return [];
  return presets.filter((preset) => missingInstalledOcrPacks(preset.value, installedPacks).length === 0);
}

export function captureLanguageSelectionError(
  request: Pick<CaptureRequest, "ocr" | "asr">,
  availability: CaptureLanguageAvailability,
): string | null {
  if (request.ocr.mode !== "inherit") {
    const language = request.ocr.language;
    if (availability.status === "unsupported" || availability.ocrBackendAvailable === false) {
      return "Image-language preferences are unavailable. Choose No language preference or update the local recognition setup.";
    }
    const missing = missingInstalledOcrPacks(language, availability.ocrInstalledPacks);
    if (missing.length) {
      return `Missing installed Tesseract language packs: ${missing.join(", ")}. Install them or choose No language preference.`;
    }
    if (request.ocr.mode === "preset"
      && !availability.ocrPresets.some((preset) => preset.value === language)) {
      return "That image-language preset is not available in the detected OMD build.";
    }
    if (request.ocr.mode === "custom" && !availability.customOcr) {
      return "Custom image-language defaults are not available in the detected OMD build.";
    }
  }
  if (request.asr.mode === "auto-detect" && !availability.asrAutoDetect) {
    return "Speech auto-detection is not available in the detected OMD build.";
  }
  if (request.asr.mode === "explicit" && !availability.asrExplicit) {
    return "Explicit speech-language hints are not available in the detected OMD build.";
  }
  return null;
}

export function ocrOptionFromSetting(value: string): CaptureOcrOption {
  const language = normalizeOcrLanguageSet(value);
  if (!language) return { mode: "inherit" };
  if (isOcrLanguagePreset(language)) return { mode: "preset", language };
  return isSafeCustomOcrLanguage(language)
    ? { mode: "custom", language }
    : { mode: "inherit" };
}

export function asrOptionFromSetting(value: CaptureAsrSetting): CaptureAsrOption {
  if (value === "auto-detect") return { mode: "auto-detect" };
  if (value === "en" || value === "zh") return { mode: "explicit", language: value };
  return { mode: "inherit-adapter-default" };
}

function normalizeOcrOption(option: CaptureOcrOption): CaptureOcrOption {
  if (option.mode === "inherit") return { mode: "inherit" };
  if (option.mode === "preset") {
    const language = option.language.trim().toLowerCase();
    if (!isOcrLanguagePreset(language)) throw new Error(`Unsupported OCR preset: ${option.language}`);
    return { mode: "preset", language };
  }
  const language = normalizeOcrLanguageSet(option.language);
  if (!language) {
    const count = option.language.split("+").length;
    if (count > 8) throw new Error("Custom OCR supports up to eight language pack ids.");
    throw new Error("Custom OCR must contain only safe Tesseract language pack ids joined with +.");
  }
  return { mode: "custom", language };
}

function normalizeAsrOption(option: CaptureAsrOption): CaptureAsrOption {
  if (option.mode === "auto-detect") return { mode: "auto-detect" };
  if (option.mode === "explicit") return { mode: "explicit", language: option.language };
  return { mode: "inherit-adapter-default" };
}

function isOcrLanguagePreset(value: string): value is OcrLanguagePreset {
  return (OCR_LANGUAGE_PRESETS as readonly string[]).includes(value);
}
