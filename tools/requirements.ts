import type { BaseRequirementItem, RequirementsReport } from '../src/types';

/** NVIDIA renamed the driver compatibility header in newer nvidia-smi builds. */
export function parseNvidiaCudaVersion(output: string): string | undefined {
  // Do not fall back to an arbitrary version: the KMD/driver version is not CUDA.
  return output.match(/\bCUDA\s+(?:UMD\s+)?Version\s*:\s*(\d+\.\d+)\b/i)?.[1];
}

export function pytorchBuildOptions(hw: { hasNvidiaGpu: boolean; platform: string; arch: string; cudaVersion?: string; computeCapability?: number }) {
  if (!hw.hasNvidiaGpu) return { cudaAvailable: false, reason: 'No NVIDIA GPU detected. CPU PyTorch remains available.' };
  if (!['win32', 'linux'].includes(hw.platform) || hw.arch !== 'x64') return { cudaAvailable: false, reason: 'Automatic CUDA PyTorch installation is supported on Windows/Linux x64. Use CPU or a separately managed compatible runtime.' };
  const cuda = Number(hw.cudaVersion), capability = hw.computeCapability;
  // Pinned PyTorch 2.8 wheel families, not GPU-name heuristics. The final import
  // and tiny CUDA kernel verify the actual installed driver/architecture match.
  if (!Number.isFinite(cuda) || capability === undefined) return { cudaAvailable: false, reason: 'Driver CUDA compatibility or GPU compute capability could not be verified. Update the driver/check again; CPU remains available.' };
  const cudaIndex = capability >= 10 ? 'cu128' : 'cu126';
  if (capability < 5 || capability > 12 || cuda < (cudaIndex === 'cu128' ? 12.8 : 12.6)) return { cudaAvailable: false, reason: 'The detected driver/GPU is outside the supported pinned CUDA wheel range. CPU PyTorch remains available.' };
  return { cudaAvailable: true, cudaIndex, reason: `Compatible driver and GPU detected for PyTorch 2.8 ${cudaIndex}. Installation will verify CUDA initialization.` };
}

export function pytorchInstallPlan(report: RequirementsReport, flavor: unknown, confirmed: boolean) {
  if (flavor === undefined) return null;
  if (flavor !== 'cpu' && flavor !== 'cuda') throw new Error('PyTorch build must be CPU or CUDA');
  const build = pytorchBuildOptions(report.hardware);
  if (flavor === 'cuda' && !build.cudaAvailable) throw new Error(build.reason);
  const installed = report.components.find(component => component.id === 'pytorch');
  if (installed?.installedVersion && !confirmed) throw new Error('Confirm replacement of the installed PyTorch build before continuing');
  return { flavor, index: flavor === 'cpu' ? 'cpu' : build.cudaIndex!, replace: !!installed?.installedVersion };
}

export const requirementDependencies: Record<string, string[]> = {
  faster_whisper: ['ctranslate2'], openai_whisper: ['pytorch'], nvidia_acceleration: ['faster_whisper', 'ctranslate2'],
};
export function expandRequirementSelection(ids: string[]): string[] {
  return [...new Set(ids.flatMap(id => [id, ...(requirementDependencies[id] || [])]))];
}
export function selectedMissingRequirements(components: BaseRequirementItem[], ids: string[]) {
  const selected = new Set(expandRequirementSelection(ids));
  return components.filter(c => c.isAppManaged && c.status !== 'ready' && (c.classification === 'required' || selected.has(c.id)));
}
export function evaluateRequirementReadiness(
  components: BaseRequirementItem[],
  options: { hasNvidiaGpu: boolean; accelerationPackagesReady: boolean },
): { allReady: boolean; statusColor: RequirementsReport['statusColor']; needsAttentionCount: number } {
  const ready = (id: string) => components.some(c => c.id === id && c.status === 'ready');
  const faster = ready('faster_whisper') && ready('ctranslate2');
  const openai = ready('openai_whisper') && ready('pytorch');
  const failures = components.filter(c => c.classification === 'required' && c.status !== 'ready').length + Number(!faster && !openai);
  return {
    allReady: failures === 0, needsAttentionCount: failures,
    statusColor: failures ? 'red' : !faster || (options.hasNvidiaGpu && !options.accelerationPackagesReady) ? 'yellow' : 'green',
  };
}
