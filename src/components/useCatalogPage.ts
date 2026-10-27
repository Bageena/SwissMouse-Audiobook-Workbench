import { useEffect, useRef, useState } from 'react';
import { catalogRequest, queryCatalog } from '../core/catalog-client';
import type { CatalogPage, CatalogQuery } from '../core/catalog';

/** Keep one bounded window; obsolete requests are cancelled and pending results are marked loading. */
export function useCatalogPage(enabled: boolean, query: CatalogQuery, refresh: unknown) {
  const key = JSON.stringify(query);
  const identity = JSON.stringify({ ...query, offset:undefined, cursor:undefined });
  const anchors = useRef({ identity, refresh, values: new Map<number,string>() });
  const [state,setState] = useState<{ page:CatalogPage; key:string; loading:boolean; error:string }>({ page:{ items:[],total:0,offset:0,revision:0 },key:'',loading:enabled,error:'' });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    if (anchors.current.identity !== identity || anchors.current.refresh !== refresh) anchors.current = { identity,refresh,values:new Map() };
    setState(previous => ({ ...previous,loading:true,error:'' }));
    let revision = -1, polling = false, fetching = false;
    const load = () => {
      if (fetching || controller.signal.aborted) return;
      fetching = true;
      const cursor = anchors.current.values.get(query.offset || 0);
      void queryCatalog({ ...query,cursor },controller.signal).catch(cause => {
        if (!cursor || !/Catalog changed/.test(cause.message)) throw cause;
        anchors.current.values.clear(); return queryCatalog(query,controller.signal);
      }).then(page => {
        if (controller.signal.aborted) return;
        revision = page.revision;
        if (page.nextCursor) anchors.current.values.set(page.offset+page.items.length,page.nextCursor);
        if (page.windowCursor) anchors.current.values.set(page.offset+(query.windowStep || query.limit || 50),page.windowCursor);
        while (anchors.current.values.size > 128) anchors.current.values.delete(anchors.current.values.keys().next().value!);
        setState({ page,key,loading:false,error:'' });
      })
        .catch(error => { if (!controller.signal.aborted) setState(previous => ({ ...previous,key,loading:false,error:error.message })); }).finally(() => { fetching = false; });
    };
    const timer = setTimeout(load,100);
    const poll = setInterval(() => {
      if (polling) return; polling=true;
      void catalogRequest<{revision:number}>('/api/catalog/status',undefined,controller.signal).then(status=>{
        if (!controller.signal.aborted && status.revision !== revision) { anchors.current.values.clear(); load(); }
      }).catch(()=>{}).finally(()=>{polling=false;});
    },2000);
    return () => { clearTimeout(timer); clearInterval(poll); controller.abort(); };
  },[enabled,key,refresh]);
  return { ...state.page,items:state.error ? [] : state.page.items,loading:enabled && (state.loading || state.key !== key),error:state.error };
}
