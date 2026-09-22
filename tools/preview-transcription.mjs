// Isolated UI fixture; no production projects or runtime installations are changed.
import express from 'express';
import path from 'node:path';
const app = express();
app.use(express.json());
const config = { faster_transcription: true, lead_in_seconds: 1.5, profiles: {}, m4b_settings: {} };
const job = { id: 'transcription-qa', name: 'Transcription Settings QA', status: 'draft', createdAt: '', parts: [], chapters: [], candidates: [], logs: [], totalDurationSeconds: 0, totalSizeBytes: 0, selectedModelId: 'small', chapterSource: 'whisperx' };
const capability = engine => ({ engine, installed: true, version: 'test', runtimeVersion: engine === 'faster-whisper' ? '4.8.2' : '2.8.0+cpu', gpuDetected: true, gpuAvailable: engine === 'faster-whisper', cudaBuilt: engine === 'faster-whisper' ? undefined : false, deviceCount: engine === 'faster-whisper' ? 1 : 0, cpuComputeTypes: ['int8','float32'], gpuComputeTypes: engine === 'faster-whisper' ? ['float16','int8_float16'] : [], freeMemoryMb: 6144, supportsBatching: engine === 'faster-whisper', initialization: 'not-tested', reason: engine === 'openai-whisper' ? 'Installed PyTorch is CPU-only.' : undefined });
const hardware = { mode:'gpu',hasNvidiaGpu:true,platform:'win32',arch:'x64',gpuName:'Test NVIDIA GPU',vramGb:8,cudaVersion:'12.8',cpuModel:'Test CPU',recommendedModelId:'small',recommendationSummary:'Isolated UI fixture' };
app.get('/api/config',(_,res)=>res.json(config));
app.post('/api/config',(req,res)=>res.json({status:'ok',config:Object.assign(config,req.body)}));
app.get('/api/jobs',(_,res)=>res.json([job]));
app.get('/api/jobs/:id',(_,res)=>res.json(job));
app.post('/api/jobs/:id/step1-settings',(req,res)=>res.json({status:'ok',job:Object.assign(job,req.body)}));
app.get('/api/system/hardware',(_,res)=>res.json(hardware));
app.get('/api/transcription/capabilities',(req,res)=>res.json(capability(req.query.engine)));
app.get('/api/models',(req,res)=>res.json(['small','large-v3'].map(id=>({id,name:id,backend:req.query.engine,description:'Test model',isInstalled:true,isAvailable:true,requiresGpu:false,sizeGb:1,downloadSizeMb:500}))));
app.get('/api/settings/output-folder',(_,res)=>res.json({path:'Test output'}));
app.get('/api/themes',(_,res)=>res.json({themes:[],warnings:[]}));
app.get('/api/requirements/install-progress',(_,res)=>res.json({isActive:false,logs:[]}));
app.get('/api/step1/progress',(_,res)=>res.json({isActive:false,logs:[],stages:[]}));
app.get('/api/requirements/status',(_,res)=>res.json({
  components:['python','ffmpeg','ffprobe','faster_whisper','ctranslate2','openai_whisper','pytorch'].map(id=>({id,name:id,purpose:'Fixture component',status:'ready',classification:'optional',isAppManaged:true,installedVersion:'test'})),
  hardware,backendCapabilities:{'faster-whisper':capability('faster-whisper'),'openai-whisper':capability('openai-whisper')},
  pytorchBuild:{cudaAvailable:true,cudaIndex:'cu126',reason:'Compatible driver and GPU detected.'},statusColor:'green',summaryMessage:'Fixture ready',
}));
app.use(express.static(path.resolve('dist')));
app.get('*',(_,res)=>res.sendFile(path.resolve('dist/index.html')));
app.listen(3109,'127.0.0.1',()=>console.log('Transcription UI fixture http://127.0.0.1:3109'));
