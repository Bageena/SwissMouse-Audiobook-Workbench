import { NavigationPanel } from './NavigationPanel';
import { useEffect, useState } from 'react';
import { FolderOpen, Inbox, Library, Plus, Search, X } from 'lucide-react';
import type { LibraryCollection, SavedLibrarySearch } from '../utils/libraryWorkspace';

export function LibraryNavigation({ collapsed, onCollapse, root, onRoot, collections, collectionId, onCollection, onCreateCollection, onDeleteCollection, saved, onSearch, onDeleteSearch, disabled = false }: {
  collapsed: boolean; onCollapse: () => void; root: string; onRoot: (root: 'inbox' | 'library' | 'workbench') => void;
  collections: LibraryCollection[]; collectionId: string; onCollection: (id: string) => void; onCreateCollection: (name: string) => void; onDeleteCollection: (id: string) => void;
  saved: SavedLibrarySearch[]; onSearch: (search: SavedLibrarySearch) => void; onDeleteSearch: (id: string) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState('');
  useEffect(() => { if (collapsed) onCollapse(); }, [collapsed]);
  return <NavigationPanel id="library-navigation" title="Library Navigation" navigationLabel="Library locations" items={(['inbox', 'library', 'workbench'] as const).map(value => ({
    id: value, label: value === 'inbox' ? 'Inbox' : value === 'library' ? 'Library' : 'Workbench projects',
    icon: value === 'inbox' ? <Inbox /> : value === 'library' ? <Library /> : <FolderOpen />,
    active: !collectionId && root === value, disabled, onClick: () => onRoot(value),
  }))}>
    {!collapsed && <>
      <h2 className="mt-5 px-2 font-bold">Collections</h2><p className="px-2 py-1 text-[10px] text-stone-500">Local lists across Inbox and Library.</p>
      {collections.map(collection => <div key={collection.id} className="flex items-center"><button type="button" disabled={disabled} aria-current={collectionId === collection.id ? 'page' : undefined} onClick={() => onCollection(collection.id)} className={`min-w-0 flex-1 rounded-lg p-2 text-left [overflow-wrap:anywhere] ${collectionId === collection.id ? 'bg-amber-50 font-bold' : ''}`}>{collection.name} <span className="text-stone-500">({collection.count ?? collection.bookIds.length})</span></button><button type="button" aria-label={`Remove collection ${collection.name}`} onClick={() => onDeleteCollection(collection.id)} className="rounded p-1 text-stone-500"><X className="h-3 w-3" /></button></div>)}
      <form className="mt-2 flex gap-1" onSubmit={event => { event.preventDefault(); if (name.trim()) { onCreateCollection(name.trim()); setName(''); } }}><input aria-label="New collection name" value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="New collection" className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1" /><button type="submit" disabled={!name.trim()} aria-label="Create collection" className="rounded border border-stone-300 p-2 disabled:opacity-40"><Plus className="h-3 w-3" /></button></form>
      <h2 className="mt-5 px-2 font-bold">Saved searches</h2>
      {!saved.length && <p className="px-2 py-2 text-[10px] text-stone-500">Save a search from Filters.</p>}
      {saved.map(search => <div key={search.id} className="flex items-center"><button type="button" disabled={disabled} onClick={() => onSearch(search)} className="flex min-w-0 flex-1 items-start gap-1 rounded-lg p-2 text-left [overflow-wrap:anywhere]"><Search className="mt-0.5 h-3 w-3 shrink-0" />{search.name}</button><button type="button" aria-label={`Remove saved search ${search.name}`} onClick={() => onDeleteSearch(search.id)} className="rounded p-1 text-stone-500"><X className="h-3 w-3" /></button></div>)}
    </>}
  </NavigationPanel>;
}
