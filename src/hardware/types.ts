export interface SystemProfile {
  os: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryGb: number;
  accelerator: string;
  storageFreeGb?: number;
}

export interface LocalModelRecommendation {
  id: string;
  displayName: string;
  runtime?: string;
  quantization?: string;
  estimatedMemoryGb?: number;
  estimatedTps?: number;
  context?: number;
  fit?: string;
  toolCapability?: boolean;
}

export interface HardwareInspection {
  profile: SystemProfile;
  source: "llmfit" | "basic";
  llmfitAvailable: boolean;
  message?: string;
}

export interface RecommendationOptions {
  limit?: number;
  useCase?: string;
}

export interface HardwareIntelligence {
  inspect(signal?: AbortSignal): Promise<HardwareInspection>;
  recommendCodingModels(
    options?: RecommendationOptions,
    signal?: AbortSignal,
  ): Promise<LocalModelRecommendation[]>;
}
