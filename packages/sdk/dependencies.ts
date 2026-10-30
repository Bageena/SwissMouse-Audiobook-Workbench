export interface RequirementDetails {description:string;website:string;license:string;licenseUrl:string;usedBy:string}
export interface DependencyStatus {id:string;name:string;status:string}
export function missingRequiredDependencies(components:readonly DependencyStatus[],required:readonly string[]):DependencyStatus[] {
  const byId=new Map(components.map(c=>[c.id,c]));
  return [...new Set(required)].map(id=>byId.get(id)||{id,name:id,status:'missing'}).filter(c=>c.status!=='ready');
}
/** Shared consumer metadata. Tool acquisition remains a separate host operation. */
export function createRequirementRegistry() {
  const consumers=new Map<string,{metadata:Readonly<Record<string,RequirementDetails>>;features:Readonly<Record<string,readonly string[]>>}>();
  const details:Record<string,RequirementDetails>={};
  const rebuild=()=>{
    for(const key of Object.keys(details))delete details[key];
    for(const contribution of consumers.values())for(const [id,detail]of Object.entries(contribution.metadata))details[id]=Object.freeze({...detail,usedBy:details[id]?`${details[id].usedBy}; ${detail.usedBy}`:detail.usedBy});
  };
  return {
    details,
    activate(owner:string,input:Readonly<Record<string,RequirementDetails>>,features:Readonly<Record<string,readonly string[]>>={}) {
      if(!/^[a-z][a-z0-9-]*$/.test(owner)||consumers.has(owner))throw new Error('Invalid or already active requirement owner.');
      const saved:Record<string,RequirementDetails>={};
      for(const [id,detail]of Object.entries(input)) {
        if(!/^[a-z][a-z0-9_]*$/.test(id)||!detail||['description','license','usedBy','website','licenseUrl'].some(key=>typeof detail[key]!=='string'||!detail[key].trim()||detail[key].length>2000)||new URL(detail.website).protocol!=='https:'||new URL(detail.licenseUrl).protocol!=='https:')throw new Error('Invalid requirement metadata.');
        const old=details[id];if(old&&(old.website!==detail.website||old.license!==detail.license||old.licenseUrl!==detail.licenseUrl))throw new Error('Conflicting shared requirement metadata.');
        saved[id]=Object.freeze({...detail});
      }
      const copiedFeatures:Record<string,readonly string[]>={};
      for(const [id,required]of Object.entries(features)) {
        if(!id.startsWith(owner+'.')||!/^[a-z][a-z0-9._-]+$/.test(id)||!Array.isArray(required)||required.some(tool=>!Object.hasOwn(saved,tool)))throw new Error('Invalid or undeclared feature requirements.');
        copiedFeatures[id]=Object.freeze([...new Set(required)]);
      }
      const contribution={metadata:Object.freeze(saved),features:Object.freeze(copiedFeatures)};consumers.set(owner,contribution);rebuild();
      return()=>{if(consumers.get(owner)===contribution){consumers.delete(owner);rebuild();}};
    },
    consumers:()=>[...consumers.keys()],
    resolve(features:readonly string[]) {
      return [...new Set(features.flatMap(id=>{
        for(const consumer of consumers.values())if(Object.hasOwn(consumer.features,id))return consumer.features[id];
        throw new Error(`Feature is unavailable: ${id}`);
      }))];
    },
  };
}
