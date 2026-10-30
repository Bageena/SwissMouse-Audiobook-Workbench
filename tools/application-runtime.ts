import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import type {Request,Response} from 'express';
import type {ApplicationModuleManifest,ApplicationModuleStatus} from '../packages/sdk/applications';

/** Uses the existing Node runtime. Failure isolation is not an OS/filesystem sandbox. */
export class ApplicationRuntime {
  private child?:ChildProcess;private port=0;private token=randomBytes(32).toString('hex');
  private output='';private stopping=false;private failure?:Error;private draining=false;
  constructor(readonly manifest:ApplicationModuleManifest,readonly directory:string,readonly appRoot:string){}
  isRunning(){return !!this.child&&this.child.exitCode===null&&this.child.signalCode===null&&!this.failure&&!this.stopping;}
  private async call(route:string,post=false,timeoutMs=10000){
    if(!this.isRunning())throw new Error('Module backend is unavailable.');
    const response=await fetch(`http://127.0.0.1:${this.port}${route}`,{method:post?'POST':'GET',headers:{'X-SwissMouse-Module-Token':this.token,...(post?{'Content-Type':'application/json'}:{})},...(post?{body:'{}'}:{}),signal:AbortSignal.timeout(timeoutMs)});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Module backend operation failed.');return body;
  }
  async start(){
    if(this.stopping)throw new Error('Module activation was cancelled.');
    const allocation=net.createServer();allocation.listen(0,'127.0.0.1');await once(allocation,'listening');this.port=(allocation.address() as net.AddressInfo).port;await new Promise<void>(done=>allocation.close(()=>done()));
    if(this.stopping)throw new Error('Module activation was cancelled.');
    // App data can live outside the installation. Resolve standard JS helpers from the
    // host runtime, never by requiring a sibling source checkout or copying dependencies.
    const hostRequire=createRequire(typeof __filename==='string'?__filename:import.meta.url);
    const dependencies=path.dirname(path.dirname(hostRequire.resolve('express/package.json')));
    const nodePath=[dependencies,process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
    this.child=spawn(process.execPath,[path.join(this.directory,this.manifest.backend)],{cwd:this.appRoot,env:{...process.env,NODE_PATH:nodePath,APP_ROOT:this.appRoot,PORT:String(this.port),NODE_ENV:'production',SWISSMOUSE_OPEN_BROWSER:'0',SWISSMOUSE_HOST_API:'2',SWISSMOUSE_MODULE_CHILD_TOKEN:this.token,SWISSMOUSE_MODULE_WEB_ROOT:path.join(this.directory,'web')},detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
    this.child.stdout!.on('data',bytes=>{this.output=(this.output+bytes).slice(-12000);});this.child.stderr!.on('data',bytes=>{this.output=(this.output+bytes).slice(-12000);});
    this.child.on('error',error=>{this.failure=error;});
    let last='Starting module backend';
    try{
      const deadline=Date.now()+60000;
      while(Date.now()<deadline){
        if(this.stopping)throw new Error('Module activation was cancelled.');
        if(this.failure)throw this.failure;
        if(this.child.exitCode!==null)throw new Error(`Module backend exited (${this.child.exitCode}). ${this.output}`);
        try{await this.call(this.manifest.application.health,false,1500);return;}catch(error){last=String(error);}
        await new Promise(done=>setTimeout(done,100));
      }
      throw new Error(`${last}. ${this.output}`);
    }catch(error){await this.stop();throw error;}
  }
  async prepareRemoval():Promise<ApplicationModuleStatus>{this.draining=true;try{const status=await this.call(this.manifest.application.prepareRemoval,true);if(status.busy)this.draining=false;return status;}catch(error){this.draining=false;throw error;}}
  forward(req:Request,res:Response){
    if(!this.isRunning()||this.draining||!this.manifest.application.routes.some(prefix=>req.path===prefix||req.path.startsWith(prefix+'/')))return false;
    const headers={...req.headers,'x-swissmouse-module-token':this.token};
    // Express consumed JSON before the proxy. Serialize that exact parsed body once.
    let body:Buffer|undefined;
    if(req.body!==undefined&&req.is('application/json')){body=Buffer.from(JSON.stringify(req.body));headers['content-length']=String(body.length);delete headers['transfer-encoding'];}
    const upstream=http.request({host:'127.0.0.1',port:this.port,path:req.originalUrl,method:req.method,headers},incoming=>{res.status(incoming.statusCode||502);for(const [name,value]of Object.entries(incoming.headers))if(value!==undefined&&!['connection','transfer-encoding'].includes(name))res.setHeader(name,value);incoming.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)res.status(503).json({error:'The module backend is unavailable. Its saved data has been retained.'});else res.destroy();});
    res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
    if(body)upstream.end(body);else if(req.readableEnded)upstream.end();else req.pipe(upstream);
    return true;
  }
  async stop(){
    this.stopping=true;const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null)return;
    const exited=once(child,'exit');
    // Terminate only the process tree created for this module, including managed tool children.
    if(process.platform==='win32')await new Promise<void>(resolve=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>resolve()));
    else try{process.kill(-child.pid!,'SIGTERM');}catch{child.kill();}
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([exited,new Promise<void>(resolve=>{timeout=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');resolve();},5000);})]);}
    finally{if(timeout)clearTimeout(timeout);}
  }
  publicAsset(url:string){const name=this.manifest.application.publicAssets[url];if(!name)return;const file=path.resolve(this.directory,name);if(!fs.existsSync(file))return;return{name,file};}
}
