import type { BaseRequirementItem, RequirementsReport } from '../src/types';

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
