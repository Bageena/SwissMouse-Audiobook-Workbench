// Isolated requirements fixture. Never executes Python, pip or media tools.
const cp = require('node:child_process');
const originalExecFile = cp.execFile;
const util = require('node:util');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const all = ['python','faster-whisper','ctranslate2','openai-whisper','torch','nvidia-cublas-cu12','nvidia-cudnn-cu12'];
const local = new Set(all);
let ownershipVerified = false;
const packages = names => Object.fromEntries(names.map(name => [name,{ok:true,output:'1.2.3'}]));
const reply = (file, args) => {
  process.stderr.write('FIXTURE_EXEC:' + JSON.stringify({file,args:args.slice(0,1)}) + '\n');
  if (args[0] === '-version') return path.basename(file).startsWith('ffprobe') ? 'ffprobe version 8.0' : 'ffmpeg version 8.0';
  if (args[0] === '--version') return '2026.08.19';
  if (args[0] === '-S') return JSON.stringify(packages([...local]));
  if (args[1]?.includes('compatible=False')) return JSON.stringify({version:'3.12.1',compatible:true,packages:packages(all),engines:['faster-whisper','openai-whisper'],libraryPaths:[],errors:[]});
  if (args[1]?.includes('r = dict(engine=')) return JSON.stringify({engine:args[2],installed:true,version:'1.2.3',runtimeVersion:'1.2.3',gpuAvailable:false,deviceCount:0,cpuComputeTypes:['int8','float32'],gpuComputeTypes:[],supportsBatching:true,initialization:'not-tested'});
  if (args[1]?.includes('Private package ownership verified')) {
    if (!file.includes(path.join('runtime','venv'))) throw Error('Ownership check must use private Python');
    ownershipVerified = true; return 'Private package ownership verified';
  }
  throw Error('Unexpected fixture subprocess: ' + file);
};
cp.execFile = (file, args, options, callback) => {
  if (!Array.isArray(args)) return originalExecFile(file,args,options,callback);
  try { const output=reply(file,args); process.nextTick(()=>callback(null,output,'')); }
  catch (error) { process.nextTick(()=>callback(error)); }
};
cp.execFile[util.promisify.custom] = async (file,args) => ({stdout:reply(file,args),stderr:''});
cp.spawn = (file,args) => {
  process.stderr.write('FIXTURE_SPAWN:' + JSON.stringify({file,args}) + '\n');
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  if (args[1]?.includes('snapshot_download')) {
    const timer = setTimeout(()=>child.emit('close',1),400);
    child.kill = () => {clearTimeout(timer); child.emit('close',null);}; return child;
  }
  if (!file.includes(path.join('runtime','venv')) || args.slice(0,4).join(' ') !== '-m pip uninstall --yes' || !ownershipVerified) throw Error('Refusing unexpected fixture mutation');
  ownershipVerified = false;
  setTimeout(()=>{ for(const name of args.slice(4)) local.delete(name); child.stdout.write('Removed test-only metadata\n'); child.emit('close',0); },250);
  return child;
};
