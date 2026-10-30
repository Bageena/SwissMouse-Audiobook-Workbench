import type {Express} from 'express';
/** Register before mutation queues: shutdown must report busy instead of joining that work. */
export function registerModuleLifecycleRoute(app:Express,ports:{busy:()=>string|undefined;settle:()=>Promise<{historyPending:boolean;publicationPending:boolean}>}){
  app.post('/api/module-lifecycle/prepare-removal',async(_req,res)=>{
    const busy=ports.busy();if(busy){res.status(409).json({error:busy});return;}
    try{res.json(await ports.settle());}catch(error){res.status(409).json({error:String(error)});}
  });
}
