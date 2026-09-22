import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PYTHON_DLL_SETUP } from './transcription-engine';
import type { BackendCapabilities, TranscriptionBackend } from '../src/transcription';

const execute = promisify(execFile);
export const BACKEND_CAPABILITY_SCRIPT = String.raw`
import json, sys, importlib.util, importlib.metadata
engine = sys.argv[1]
r = dict(engine=engine, installed=False, gpuAvailable=False, deviceCount=0,
         cpuComputeTypes=[], gpuComputeTypes=[], supportsBatching=False, initialization='not-tested')
try:
    if engine == 'openai-whisper':
        import torch
        r.update(installed=importlib.util.find_spec('whisper') is not None,
                 runtimeVersion=torch.__version__,
                 cudaBuilt=bool(torch.version.cuda), cudaVersion=torch.version.cuda,
                 cpuComputeTypes=['float32'])
        if r['installed']:
            r['version'] = importlib.metadata.version('openai-whisper')
        if torch.version.cuda and torch.cuda.is_available():
            torch.cuda.init()
            # A tiny kernel verifies the driver/build/architecture combination.
            x = torch.ones(1, device='cuda'); x.add_(1); torch.cuda.synchronize()
            r.update(gpuAvailable=True, deviceCount=torch.cuda.device_count(),
                     gpuComputeTypes=['float16', 'float32'], initialization='verified',
                     freeMemoryMb=int(torch.cuda.mem_get_info()[0] / 1048576))
        elif not torch.version.cuda:
            r['reason'] = 'Installed PyTorch is CPU-only.'
        else:
            r['reason'] = 'CUDA-enabled PyTorch cannot access a compatible GPU/driver.'
    else:
        import ctranslate2 as ct
        r.update(installed=importlib.util.find_spec('faster_whisper') is not None,
                 version=importlib.metadata.version('faster-whisper'), runtimeVersion=ct.__version__,
                 cpuComputeTypes=sorted(ct.get_supported_compute_types('cpu')))
        import faster_whisper
        r['supportsBatching'] = hasattr(faster_whisper, 'BatchedInferencePipeline')
        r['deviceCount'] = ct.get_cuda_device_count()
        if r['deviceCount']:
            r['gpuComputeTypes'] = sorted(ct.get_supported_compute_types('cuda', device_index=0))
            r['gpuAvailable'] = bool(r['gpuComputeTypes'])
        if not r['gpuAvailable']:
            r['reason'] = 'CTranslate2 cannot access a supported CUDA device; CPU remains available.'
except Exception as e:
    import traceback
    traceback.print_exc()
    r['gpuAvailable'] = False
    r['initialization'] = 'failed'
    r['reason'] = str(e)[:700]
print(json.dumps(r))
`;

export async function probeBackendCapabilities(python: string, engine: TranscriptionBackend, gpuDetected: boolean, env: NodeJS.ProcessEnv): Promise<BackendCapabilities> {
  try {
    const { stdout, stderr } = await execute(python, ['-c', PYTHON_DLL_SETUP + BACKEND_CAPABILITY_SCRIPT, engine], { env, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    const result: BackendCapabilities = { ...JSON.parse(stdout.trim().split(/\r?\n/).pop()!), gpuDetected };
    if (result.initialization === 'failed') console.error(`[Transcription capability ERROR] ${engine}\n${stderr?.trim() || result.reason}`);
    if (result.gpuAvailable && result.freeMemoryMb === undefined) {
      // Advisory only. Respect an explicitly selected CUDA device when possible.
      const visible = env.CUDA_VISIBLE_DEVICES?.split(',')[0]?.trim();
      if (!visible || /^(\d+|GPU-[a-f\d-]+)$/i.test(visible)) {
        try {
          const memory = await execute('nvidia-smi', ['-i', visible || '0', '--query-gpu=memory.free', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 3000 });
          const free = Number(memory.stdout.trim());
          if (Number.isFinite(free) && free > 0) result.freeMemoryMb = free;
        } catch { /* Unknown memory deliberately limits batching to 1. */ }
      }
    }
    return result;
  } catch (error: any) {
    // Avoid execFile's message, which can contain the complete inline program.
    console.error(`[Transcription capability ERROR] ${engine}\n${String(error.stderr || `Probe failed (${error.code || error.name || 'unknown error'})`).trim()}`);
    return { engine, installed: false, gpuDetected, gpuAvailable: false, deviceCount: 0, cpuComputeTypes: [], gpuComputeTypes: [], supportsBatching: false, initialization: 'failed', reason: String(error.stderr || error.message).slice(-700) };
  }
}
