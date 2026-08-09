export type ProviderInputModality = "text" | "file" | "image" | "video";

export type ProviderModelInputCapabilities = {
  readonly provider: string;
  readonly model: string;
  readonly text: true;
  readonly files: true;
  readonly image: boolean;
  readonly video: boolean;
  readonly modalities: readonly ProviderInputModality[];
};

export function normalizeInputCapabilityProvider(value: unknown): string;
export function providerModelInputCapabilities(
  provider: unknown,
  model: unknown,
): ProviderModelInputCapabilities;
export function providerModelSupportsInput(
  provider: unknown,
  model: unknown,
  modality: unknown,
): boolean;
export function providerInputCapabilityPrompt(provider: unknown, model: unknown): string;
export function providerInputCapabilityLabels(provider: unknown, model: unknown): string[];
