import type { ReactNode } from 'react';
export interface PreferenceContext<TConfig = unknown> { config:TConfig; updateConfig:(config:TConfig)=>void }
export interface PreferenceField {
  id:string;label:string;description:string;control:'toggle'|'text'|'number';value:string|number|boolean;
  min?:number;max?:number;step?:number;onChange:(value:string|number|boolean)=>void;
}
export interface PreferenceSection<TConfig = unknown> {
  id:string;owner:string;category:string;title:string;description:string;keywords?:readonly string[];
  render?:(context:PreferenceContext<TConfig>)=>ReactNode;
  fields?:(context:PreferenceContext<TConfig>)=>readonly PreferenceField[];
}
/** Trusted UI contributions. Atomic registration and cleanup do not own or delete configuration. */
export function createPreferencesRegistry<TConfig = unknown>() {
  const sections=new Map<string,PreferenceSection<TConfig>>();
  return {
    register(section:PreferenceSection<TConfig>) {
      if(!/^[a-z][a-z0-9-]*$/.test(section.owner)||!section.id.startsWith(section.owner+'.')||!/^[a-z0-9.-]+$/.test(section.id))throw new Error('Preference IDs must be namespaced by their owner.');
      if(!section.category||!section.title.trim())throw new Error('Preferences require a category and title.');
      if(sections.has(section.id))throw new Error(`Preference section already registered: ${section.id}`);
      const saved=Object.freeze({...section,keywords:Object.freeze([...(section.keywords||[])])});sections.set(saved.id,saved);
      return ()=>{if(sections.get(saved.id)===saved)sections.delete(saved.id);};
    },
    activate(owner:string,contributions:readonly PreferenceSection<TConfig>[]) {
      if(contributions.some(s=>s.owner!==owner))throw new Error('Preference owner mismatch.');
      const cleanup:(()=>void)[]=[];
      try { for(const section of contributions)cleanup.push(this.register(section)); }
      catch(error){for(const remove of cleanup.reverse())remove();throw error;}
      let active=true;return()=>{if(active){active=false;for(const remove of cleanup.reverse())remove();}};
    },
    list:()=>[...sections.values()],
  };
}
export function matchesPreference(section:PreferenceSection<any>,query:string) {
  const text=[section.title,section.description,section.owner,...(section.keywords||[])].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term=>text.includes(term));
}
