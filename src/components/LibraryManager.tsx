import {useCatalogPage} from './useCatalogPage';
import {catalogRequest, selectCatalog, selectedCatalogBatches} from '../core/catalog-client';
import type {CatalogQuery, CatalogSelection, CatalogCollection} from '../core/catalog';
import {DesktopWindow} from './DesktopWorkspace';
import type {AudiobookMetadata, LibraryBook} from '../types';
import type {SavedLibrarySearch} from '../utils/libraryWorkspace';
import type {LibraryTransferMode} from './MoveToLibrary';
import {LibraryColumnHeader} from './LibraryColumnHeader';
import React, {useState, useRef, useEffect, useMemo} from 'react';
import * as Icons from 'lucide-react';
import {LibraryNavigation} from './LibraryNavigation';
import {MoveToLibraryDialog} from './MoveToLibrary';
import {MeasuredLibraryRow, MeasuredLibraryTableRow, useLibraryVirtualRows} from './useLibraryVirtualRows';
import {emptyLibraryFilters, matchesLibraryFilters, loadCollections, loadSavedSearches, loadLibraryBrowse, validFilters, readStored, writeStored} from '../utils/libraryWorkspace';
function CardActions({
  title,
  children
}: {title:string; children:React.ReactNode}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      if (!ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    const escape = event => {
      if (event.key === "Escape" && ref.current) {
        event.stopPropagation();
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <details ref={ref} className="library-card-actions absolute bottom-3 right-3" onToggle={event => setOpen(event.currentTarget.open)}><summary aria-label={`Actions for ${title}`} title="Book actions" className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-stone-300 text-stone-700"><Icons.MoreHorizontal className="h-4 w-4" aria-hidden="true" /></summary><div className="library-card-actions-popup absolute bottom-full right-0 z-20 mb-2 w-44 rounded-lg border border-stone-200 bg-white p-1.5 shadow-lg" onClick={event => {
      if ((event.target as HTMLElement).closest("button") && ref.current) ref.current.open = false;
    }}>{children}</div></details>;
}
var pageSizes: (number | "all")[] = [25, 50, 100, 250, 500, "all"];
var savedPageSize = () => {
  const value = localStorage.getItem("swissmouse_library_page_size");
  return pageSizes.find(size => String(size) === value) || 50;
};
var restoredBrowse = loadLibraryBrowse();
let browsePosition = {
  active: !!restoredBrowse.root,
  root: "library",
  view: "cover",
  query: "",
  sort: "title",
  descending: false,
  availability: "available",
  page: 0,
  scrollTop: 0
};
browsePosition = {
  ...browsePosition,
  root: restoredBrowse.root || browsePosition.root,
  view: restoredBrowse.view || browsePosition.view,
  query: restoredBrowse.query || "",
  sort: ["title", "author", "narrator", "series", "seriesSequence", "publishedYear", "createdAt", "metadataUpdatedAt"].includes(restoredBrowse.sort || "") ? restoredBrowse.sort : "title",
  descending: !!restoredBrowse.descending,
  availability: restoredBrowse.availability || "available",
  page: restoredBrowse.page || 0,
  scrollTop: restoredBrowse.scrollTop || 0
};
var columns = [{
  key: "title",
  label: "Title",
  width: "min-w-52"
}, {
  key: "subtitle",
  label: "Subtitle",
  width: "min-w-44"
}, {
  key: "author",
  label: "Author",
  width: "min-w-40"
}, {
  key: "narrator",
  label: "Narrator",
  width: "min-w-40"
}, {
  key: "series",
  label: "Series",
  width: "min-w-40"
}, {
  key: "seriesSequence",
  label: "Series No.",
  width: "min-w-24"
}, {
  key: "edition",
  label: "Edition",
  width: "min-w-32"
}, {
  key: "description",
  label: "Description",
  width: "min-w-72"
}, {
  key: "genres",
  label: "Genre",
  width: "min-w-40"
}, {
  key: "publishedYear",
  label: "Year",
  width: "min-w-24"
}, {
  key: "publisher",
  label: "Publisher",
  width: "min-w-40"
}, {
  key: "language",
  label: "Language",
  width: "min-w-24"
}, {
  key: "isbn",
  label: "ISBN",
  width: "min-w-40"
}, {
  key: "asin",
  label: "ASIN",
  width: "min-w-32"
}, {
  key: "releaseDate",
  label: "Release date",
  width: "min-w-32"
}, {
  key: "copyright",
  label: "Copyright",
  width: "min-w-40"
}];
var sortOptions = [{
  key: "title",
  label: "Title"
}, {
  key: "author",
  label: "Author"
}, {
  key: "narrator",
  label: "Narrator"
}, {
  key: "series",
  label: "Series and number"
}, {
  key: "seriesSequence",
  label: "Series number"
}, {
  key: "publishedYear",
  label: "Year"
}, {
  key: "createdAt",
  label: "Recently added"
}, {
  key: "metadataUpdatedAt",
  label: "Recently modified"
}];
var suggestedFields = new Set(["author", "narrator", "series", "genres", "publisher", "language"]);
var normalize = value => value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, " ").trim();
var fieldValue = (book, field) => field === "genres" ? (book.metadata.genres || []).join(", ") : String(book.metadata[field] || "");
var seriesNumber = value => {
  const match = String(value || "").match(/^\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
};
function CoverPreview({
  book,
  size
}: {book:LibraryBook;size:string}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [book.coverUrl]);
  if (!book.coverUrl || failed) return <span className={`${size} flex items-center justify-center rounded-lg bg-stone-200 text-stone-500`}><Icons.BookOpen className="h-7 w-7" /></span>;
  return <img src={book.coverUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => {
    console.warn("Could not load library cover", book.id);
    setFailed(true);
  }} className={`${size} rounded-lg object-contain bg-stone-100`} />;
}
interface Props {
 catalog?: boolean;
 books: LibraryBook[]; scanWarning?: string; scanning?: boolean; onPlay?: (id: string) => void; onOpen: (id: string) => void;
 onSave: (changes: {id:string; fields:Partial<AudiobookMetadata>}[]) => Promise<void>;
 onWriteAudioMetadata: (ids:string[]) => Promise<{written:string[]; failures:string[]}>;
 onUpdateJson: (ids:string[]) => Promise<{written:string[]; failures:string[]}>;
 onMoveFolders: (ids:string[]) => Promise<{moved:string[];failures:string[];cancelled:boolean}>;
 onRelink: (id:string) => Promise<string|null>; onMoveToLibrary: (id:string,mode:LibraryTransferMode)=>Promise<string|undefined>;
 onOpenFolder:(id:string)=>Promise<void>; onRefresh:()=>Promise<void>;
 onDelete:(id:string,name:string)=>Promise<void>; onDeleteMany:(ids:string[])=>Promise<void | boolean>;
}
export const LibraryManager: React.FC<Props> = ({
  books: allBooks,
  catalog = false,
  onPlay,
  scanWarning,
  scanning,
  onOpen: openBook,
  onSave,
  onWriteAudioMetadata,
  onUpdateJson,
  onMoveFolders,
  onRelink,
  onMoveToLibrary,
  onOpenFolder,
  onRefresh,
  onDelete,
  onDeleteMany
}) => {
  const [columnSizes,setColumnSizes] = useState<Record<string,number>>(()=>{const saved=readStored<unknown>('swissmouse-library-columns',{});return saved && typeof saved==='object'&&!Array.isArray(saved)?Object.fromEntries(Object.entries(saved).filter(([,width])=>typeof width==='number'&&Number.isFinite(width)&&width>=48&&width<=1200)):{};});
  useEffect(()=>{const timer=setTimeout(()=>writeStored('swissmouse-library-columns',columnSizes),200);return ()=>clearTimeout(timer);},[columnSizes]);
  const [savedBrowse] = useState(loadLibraryBrowse);
  const [root, setRoot] = useState<"inbox" | "library" | "workbench">(() => browsePosition.active ? browsePosition.root as "inbox" | "library" | "workbench" : localStorage.getItem("swissmouse_library_root") === "inbox" ? "inbox" : "library");
  const [availability, setAvailability] = useState<"available"|"missing"|"all">(browsePosition.availability as "available"|"missing"|"all");
  const [filters, setFilters] = useState(() => validFilters(savedBrowse.filters));
  const [collections, setCollections] = useState<CatalogCollection[]>(loadCollections);
  const [collectionsLoaded,setCollectionsLoaded] = useState(!catalog);
  const [collectionId, setCollectionId] = useState(savedBrowse.collectionId || "");
  const [savedSearches, setSavedSearches] = useState(loadSavedSearches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readStored<boolean>("swissmouse-library-sidebar", false) === true);
  const [searchName, setSearchName] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const activeCollection = collections.find(item => item.id === collectionId);
  useEffect(() => {
    if (collectionsLoaded && collectionId && !collections.some(collection => collection.id === collectionId)) setCollectionId("");
  }, [collectionId, collections, collectionsLoaded]);
  const collectionMembers = useMemo(() => activeCollection ? new Set(activeCollection.bookIds) : null, [activeCollection]);
  useEffect(() => {
    if (catalog) return;
    if (!writeStored("swissmouse-collections", collections)) setStorageWarning("Collections could not be saved to browser storage. They remain available for this session.");
  }, [collections]);
  useEffect(() => {
    if (!writeStored("swissmouse-saved-searches", savedSearches)) setStorageWarning("Saved searches could not be saved to browser storage. They remain available for this session.");
  }, [savedSearches]);
  useEffect(() => {
    writeStored("swissmouse-library-sidebar", sidebarCollapsed);
  }, [sidebarCollapsed]);
  const books = useMemo(() => allBooks.filter(book => (collectionMembers ? collectionMembers.has(book.id) : root === "workbench" ? !book.rootType : (book.rootTypes || [book.rootType]).includes(root)) && (availability === "all" || (availability === "missing" ? book.sourceMissing : !book.sourceMissing))), [allBooks, root, availability, collectionMembers]);
  const changeRoot = next => {
    setRoot(next);
    setCollectionId("");
    clearSelection();
    setPage(0);
    setCatalogOffset(0);
    browsePosition.scrollTop = 0;
    selectionAnchor.current = null;
    localStorage.setItem("swissmouse_library_root", next);
  };
  const [view, setView] = useState(() => browsePosition.active ? browsePosition.view : ["cover", "list", "edit"].includes(localStorage.getItem("swissmouse_library_view") || "") ? localStorage.getItem("swissmouse_library_view") : "cover");
  const [sort, setSort] = useState(browsePosition.sort);
  const [descending, setDescending] = useState(browsePosition.descending);
  const [query, setQuery] = useState(browsePosition.query);
  const [page, setPage] = useState(browsePosition.page);
  const [pageSize, setPageSize] = useState(savedPageSize);
  const continuous = pageSize === "all" && view !== "edit";
  const [columnsCount, setColumnsCount] = useState(1);
  const [selected, setSelected] = useState<string[]>(savedBrowse.selected || []);
  const [allSelection,setAllSelection] = useState<CatalogSelection | null>(null);
  const [excluded,setExcluded] = useState<string[]>([]);
  const [selectionMembers,setSelectionMembers] = useState<Set<string>>(new Set());
  const selectedCount = allSelection ? allSelection.count - excluded.length : selected.length;
  const isSelected = (id: string) => allSelection ? selectionMembers.has(id) && !excluded.includes(id) : selected.includes(id);
  const clearSelection = () => { setSelected([]); setAllSelection(null); setExcluded([]); };
  const [catalogOffset,setCatalogOffset] = useState(savedBrowse.catalogOffset || 0);
  const pendingScroll = useRef<number | null>(savedBrowse.scrollTop || 0);
  const [catalogRefresh,setCatalogRefresh] = useState(0);
  const catalogRefreshKey = useMemo(() => ({}),[allBooks,catalogRefresh]);
  const [drafts, setDrafts] = useState({});
  const [bulkFields, setBulkFields] = useState([]);
  const [bulkValues, setBulkValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileMessage, setFileMessage] = useState("");
  const [moveBook, setMoveBook] = useState(null);
  const [moveError, setMoveError] = useState("");
  const transfer = async mode => {
    if (!moveBook) return;
    setBusy(true);
    setMoveError("");
    setFileMessage("");
    try {
      const warning = await onMoveToLibrary(moveBook.id, mode);
      setFileMessage(warning || (mode === "copy" ? "Copied to Library. Original files kept." : "Moved to Library. Files verified and source cleanup completed."));
      setMoveBook(null);
    } catch (error2) {
      setMoveError(error2 instanceof Error ? error2.message : "Could not transfer the project.");
    } finally {
      setBusy(false);
    }
  };
  const [matches, setMatches] = useState([]);
  const [matchTotal,setMatchTotal] = useState(0);
  const [matchesPending,setMatchesPending] = useState(false);
  const [matchesCapped,setMatchesCapped] = useState(false);
  const [matchStatus, setMatchStatus] = useState("loading");
  const [matchError, setMatchError] = useState("");
  const [matchRequest, setMatchRequest] = useState(0);
  const [reviewed, setReviewed] = useState([]);
  const [reviewedPage,setReviewedPage] = useState(0), [reviewedTotal,setReviewedTotal] = useState(0);
  const [showMatches, setShowMatches] = useState(false);
  const [matchFilter, setMatchFilter] = useState("all");
  const [matchPage, setMatchPage] = useState(0);
  const [comparison, setComparison] = useState(null);
  const pendingCellSaves = useRef(new Set());
  const selectionAnchor = useRef(null);
  useEffect(() => {
    if (catalog) return;
    const ids = new Set(allBooks.map(book => book.id));
    setSelected(current => current.filter(id => ids.has(id)));
  }, [allBooks]);
  useEffect(() => {
    if (catalog && !showMatches) { setMatchStatus("ready"); return; }
    const controller = new AbortController();
    setMatchStatus("loading");
    setMatchError("");
    void (async () => {
      try {
        const result = catalog ? await catalogRequest<{items:any[];total:number;pending:boolean;capped:boolean}>('/api/catalog/matches',{root,kind:matchFilter,offset:matchPage*100,limit:100},controller.signal) : await (await fetch('/api/library/matches',{signal:controller.signal})).json();
        if (controller.signal.aborted) return;
        setMatches(catalog ? result.items : result);
        setMatchTotal(catalog ? result.total : result.length);
        setMatchesPending(catalog && result.pending); setMatchesCapped(catalog && result.capped);
        setMatchStatus("ready");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setMatchError(cause instanceof Error ? cause.message : "Could not check for duplicates.");
        setMatchStatus("error");
      }
    })();
    return () => controller.abort();
  }, [allBooks, matchRequest, catalog && showMatches, catalog && root, catalog && matchFilter, catalog && matchPage]);
  useEffect(() => {
    if (!showMatches) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = catalog ? await catalogRequest<{items:any[];total:number}>('/api/catalog/matches',{root,reviewed:true,offset:reviewedPage*100,limit:100},controller.signal)
          : {items:await (await fetch('/api/library/matches/reviewed',{signal:controller.signal})).json(),total:0};
        if (!Array.isArray(result.items)) throw new Error('Could not read reviewed duplicate choices.');
        if (!controller.signal.aborted) { setReviewed(result.items); setReviewedTotal(catalog?result.total:result.items.length); }

      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load reviewed duplicate choices.");
      }
    })();
    return () => controller.abort();
  }, [allBooks, showMatches, matchRequest, reviewedPage, root]);
  useEffect(()=>{setReviewedPage(0);},[root]);
  useEffect(()=>{setReviewedPage(page=>Math.min(page,Math.max(0,Math.ceil(reviewedTotal/100)-1)));},[reviewedTotal]);
  useEffect(()=>{
    if (!showMatches || !matchesPending || matchesCapped) return;
    const timer=setTimeout(()=>setMatchRequest(value=>value+1),2000); return ()=>clearTimeout(timer);
  },[showMatches,matchesPending,matchesCapped,matchRequest]);
  const localSuggestions = useMemo(() => view !== "edit" ? {} : Object.fromEntries([...suggestedFields].map(field => {
    const seen = new Set();
    return [field, books.flatMap(book => fieldValue(book, field).split(field === "genres" ? "," : "\0")).map(value => value.trim()).filter(value => {
      const key = normalize(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.localeCompare(b))];
  })), [books, view]);
  const localFiltered = useMemo(() => {
    const result = books.filter(book => matchesLibraryFilters(book, filters, query));
    result.sort((a, b) => {
      let comparison2 = 0;
      if (sort === "series" || sort === "seriesSequence") {
        if (sort === "series") comparison2 = (a.metadata.series || "").localeCompare(b.metadata.series || "", void 0, {
          sensitivity: "base"
        });
        if (!comparison2) comparison2 = seriesNumber(a.metadata.seriesSequence) - seriesNumber(b.metadata.seriesSequence);
        if (!Number.isFinite(comparison2)) comparison2 = 0;
      } else if (sort === "createdAt") comparison2 = a.createdAt.localeCompare(b.createdAt);else if (sort === "metadataUpdatedAt") comparison2 = (a.metadataUpdatedAt || a.createdAt).localeCompare(b.metadataUpdatedAt || b.createdAt);else comparison2 = String(a.metadata[sort] || "").localeCompare(String(b.metadata[sort] || ""), void 0, {
        numeric: true,
        sensitivity: "base"
      });
      return (descending ? -comparison2 : comparison2) || a.metadata.title.localeCompare(b.metadata.title);
    });
    return result;
  }, [books, query, sort, descending, filters]);
  const effectivePageSize = pageSize === "all" ? 100 : pageSize;
  const catalogQuery: CatalogQuery = { root,availability,query,filters,sort:sort as CatalogQuery['sort'],descending,collectionId:collectionId || undefined };
  const remote = useCatalogPage(catalog,{ ...catalogQuery,limit:continuous ? 500 : effectivePageSize,windowStep:continuous ? Math.floor(400 / (view === "cover" ? columnsCount : 1)) * (view === "cover" ? columnsCount : 1) : undefined,offset:continuous ? catalogOffset : page * effectivePageSize },catalogRefreshKey);
  const filtered = catalog ? remote.items : localFiltered;
  useEffect(() => {
    if (!allSelection) { setSelectionMembers(new Set()); return; }
    const controller = new AbortController();
    void catalogRequest<string[]>('/api/catalog/selections/members',{ token:allSelection.token,ids:filtered.map(book=>book.id) },controller.signal)
      .then(ids=>{ if (!controller.signal.aborted) setSelectionMembers(new Set(ids)); }).catch(cause=>{ if (!controller.signal.aborted) setError(cause.message); });
    return ()=>controller.abort();
  },[allSelection,filtered]);
  const resultCount = catalog ? remote.total : filtered.length;
  const pageCount = Math.max(1, Math.ceil(resultCount / effectivePageSize));
  useEffect(() => { if (!catalog || !remote.loading) setPage(current => Math.min(current,pageCount-1)); },[pageCount,remote.loading]);
  useEffect(() => { if (catalog && continuous && !remote.loading && !remote.error && catalogOffset >= resultCount && catalogOffset > 0) { setCatalogOffset(Math.max(0,resultCount-500)); pendingScroll.current=0; } },[catalog,continuous,remote.loading,resultCount,catalogOffset]);
  const visible = catalog ? filtered : filtered.slice(Math.min(page, pageCount - 1) * effectivePageSize, (Math.min(page, pageCount - 1) + 1) * effectivePageSize);
  const virtualCount = continuous ? view === "cover" ? Math.ceil(filtered.length / columnsCount) : filtered.length : 0;
  const virtual = useLibraryVirtualRows(virtualCount, view === "cover" ? 332 : 80, `${root}:${collectionId}:${availability}:${view}:${query}:${JSON.stringify(filters)}:${sort}:${descending}:${columnsCount}:${pageSize}:${catalog ? remote.offset : 0}`);
  const [remoteSuggestions,setRemoteSuggestions] = useState<Record<string,string[]>>({});
  const [catalogFormats,setCatalogFormats] = useState<string[]>([]);
  useEffect(() => {
    if (!catalog) return;
    const controller = new AbortController();
    void catalogRequest<string[]>('/api/catalog/suggestions',{field:'format'},controller.signal).then(values => { if (!controller.signal.aborted) setCatalogFormats(values); }).catch(() => {});
    return () => controller.abort();
  },[catalog,catalogRefreshKey]);
  const suggestions = catalog ? remoteSuggestions : localSuggestions;
  useEffect(() => {
    if (!catalog || view !== 'edit') return;
    const controller = new AbortController();
    void Promise.all([...suggestedFields].map(async field => [field,await catalogRequest<string[]>('/api/catalog/suggestions',{ field },controller.signal)] as const))
      .then(entries => { if (!controller.signal.aborted) setRemoteSuggestions(Object.fromEntries(entries)); }).catch(() => {});
    return () => controller.abort();
  },[catalog,view,catalogRefreshKey]);
  useEffect(() => {
    if (!catalog || remote.loading || pendingScroll.current === null || !virtual.scroller.current) return;
    virtual.scroller.current.scrollTop = pendingScroll.current; pendingScroll.current = null; virtual.onScroll();
  },[catalog,remote.loading,remote.offset,filtered]);
  useEffect(() => {
    if (!catalog) return;
    let cancelled = false;
    void (async () => {
      if (!readStored('swissmouse-collections-catalog-v1',false)) {
        for (const collection of loadCollections()) await catalogRequest('/api/catalog/collections',{ id:collection.id,name:collection.name,ids:collection.bookIds,importOnly:true });
        writeStored('swissmouse-collections-catalog-v1',true);
      }
      const value = await catalogRequest<CatalogCollection[]>('/api/catalog/collections'); if (!cancelled) { setCollections(value); setCollectionsLoaded(true); }
    })().catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  },[catalog]);
  const eachSelected = async (operation: (ids:string[]) => Promise<unknown>) => {
    try { for await (const ids of selectedCatalogBatches(allSelection,selected,excluded)) { if (await operation(ids) === false) break; } }
    finally { setCatalogRefresh(value => value+1); }
  };
  const selectAllMatching = async () => {
    if (!catalog) { setSelected(filtered.map(book => book.id)); return; }
    try { const selection = await selectCatalog(catalogQuery); setAllSelection(selection); setSelected([]); setExcluded([]); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    const element = virtual.scroller.current;
    if (!element || !continuous) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth;
      setColumnsCount(view === "cover" ? width < 640 ? 1 : width < 1280 ? 2 : Math.max(2, Math.floor((width + 12) / 352)) : 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [continuous, view]);
  const windowPosition = useRef(savedBrowse.windowScroll || 0);
  const snapshotRef = useRef({});
  snapshotRef.current = {
    root,
    view,
    query,
    sort,
    descending,
    availability,
    page,
    catalogOffset,
    selected,
    filters,
    collectionId
  };
  const browseSaveTimer = useRef(null);
  const saveBrowse = (immediate = false) => {
    if (browseSaveTimer.current !== null) clearTimeout(browseSaveTimer.current);
    const persist = () => {
      browseSaveTimer.current = null;
      writeStored("swissmouse-library-workspace", {
        ...snapshotRef.current,
        scrollTop: browsePosition.scrollTop,
        windowScroll: windowPosition.current
      }, true);
    };
    if (immediate) persist();else browseSaveTimer.current = setTimeout(persist, 200);
  };
  useEffect(() => {
    browsePosition = {
      active: true,
      root,
      view,
      query,
      sort,
      descending,
      availability,
      page,
      scrollTop: browsePosition.scrollTop
    };
    saveBrowse();
  }, [root, view, query, sort, descending, availability, page, catalogOffset, selected, filters, collectionId]);
  useEffect(() => {
    const onScroll = () => {
      windowPosition.current = window.scrollY;
      saveBrowse();
    };
    const y = savedBrowse.windowScroll || 0;
    const frame = requestAnimationFrame(() => window.scrollTo(0, y));
    window.addEventListener("scroll", onScroll, {
      passive: true
    });
    const onHide = () => saveBrowse(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelAnimationFrame(frame);
      saveBrowse(true);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  useEffect(() => {
    if (continuous && virtual.scroller.current && browsePosition.active) virtual.scroller.current.scrollTop = browsePosition.scrollTop;
  }, [continuous, view, root, columnsCount]);
  const onOpen = id => {
    windowPosition.current = window.scrollY;
    saveBrowse(true);
    openBook(id);
  };
  const resetPosition = () => {
    setPage(0);
    setCatalogOffset(0); pendingScroll.current = null;
    browsePosition.scrollTop = 0;
    if (virtual.scroller.current) virtual.scroller.current.scrollTop = 0;
  };
  const chooseView = next => {
    setView(next);
    resetPosition();
    localStorage.setItem("swissmouse_library_view", next);
  };
  const chooseSort = next => {
    if (next === sort) setDescending(!descending);else {
      setSort(next);
      setDescending(next === "createdAt" || next === "metadataUpdatedAt");
    }
    resetPosition();
  };
  const toggleSelected = (id, shiftKey) => {
    if (allSelection) {
      if (!selectionMembers.has(id)) { setError('This book was added after the selection. Clear the selection to include it.'); return; }
      setExcluded(current => current.includes(id) ? current.filter(value => value !== id) : [...current,id]); return;
    }
    const order = filtered.map(book => book.id);
    const anchorIndex = selectionAnchor.current ? order.indexOf(selectionAnchor.current) : -1;
    const targetIndex = order.indexOf(id);
    if (shiftKey && anchorIndex !== -1 && targetIndex !== -1) {
      const range = order.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
      setSelected(current => [...new Set([...current, ...range])]);
    } else {
      setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
      selectionAnchor.current = id;
    }
  };
  const selectionControl = (book, showLabel = false) => <button type="button" role="checkbox" disabled={busy || catalog && remote.loading} aria-checked={isSelected(book.id)} aria-label={`${isSelected(book.id) ? "Deselect" : "Select"} ${book.metadata.title || book.name}`} onClick={event => toggleSelected(book.id, event.shiftKey)} className="library-select-toggle"><span className="library-select-circle" aria-hidden="true" />{showLabel && <span>{"Select"}</span>}</button>;
  const saveCell = async (book, field) => {
    const value = drafts[book.id]?.[field];
    if (value === void 0 || value === fieldValue(book, field)) return;
    setError("");
    setFileMessage("");
    const save = onSave([{
      id: book.id,
      fields: {
        [field]: field === "genres" ? value.split(",").map(item => item.trim()).filter(Boolean) : value
      }
    }]);
    pendingCellSaves.current.add(save);
    try {
      await save;
      setDrafts(current => {
        const next = {
          ...current,
          [book.id]: {
            ...current[book.id]
          }
        };
        delete next[book.id][field];
        return next;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save metadata.");
    } finally {
      pendingCellSaves.current.delete(save);
    }
  };
  const writeFiles = async () => {
    if (!selectedCount) return;
    setBusy(true);
    setError("");
    setFileMessage("");
    try {
      await Promise.all([...pendingCellSaves.current]);
      let written = 0, failed = 0; const failures: string[] = [];
      await eachSelected(async ids => { const batch = await onWriteAudioMetadata(ids); written += batch.written.length; failed += batch.failures.length; failures.push(...batch.failures.slice(0,Math.max(0,20-failures.length))); setFileMessage(`Wrote metadata to ${written} audiobook files.`); });
      if (failed) setError(`${failed} failures: ${failures.join('; ')}${failed > failures.length ? '; showing the first 20.' : ''}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not write metadata to audio files.");
    } finally {
      setBusy(false);
    }
  };
  const saveBulk = async () => {
    if (!selectedCount || !bulkFields.length) return;
    const fields = Object.fromEntries(bulkFields.map(field => [field, field === "genres" ? (bulkValues[field] || "").split(",").map(item => item.trim()).filter(Boolean) : bulkValues[field] || ""]));
    if ("title" in fields && !fields.title?.trim()) {
      setError("Title cannot be empty.");
      return;
    }
    setBusy(true);
    setError("");
    setFileMessage("");
    try {
      await eachSelected(ids => onSave(ids.map(id => ({ id,fields }))));
      setBulkFields([]);
      setBulkValues({});
      clearSelection();
      selectionAnchor.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save selected books.");
    } finally {
      setBusy(false);
    }
  };
  const updateJson = async () => {
    if (!selectedCount) return;
    const fields = Object.fromEntries(bulkFields.map(field => [field, field === "genres" ? (bulkValues[field] || "").split(",").map(item => item.trim()).filter(Boolean) : bulkValues[field] || ""]));
    if ("title" in fields && !fields.title?.trim()) {
      setError("Title cannot be empty.");
      return;
    }
    setBusy(true);
    setError("");
    setFileMessage("");
    try {
      await Promise.all([...pendingCellSaves.current]);
      if (bulkFields.length) {
        await eachSelected(ids => onSave(ids.map(id => ({ id,fields }))));
        setBulkFields([]);
        setBulkValues({});
      }
      let written = 0, failed = 0; const failures: string[] = [];
      await eachSelected(async ids => { const batch = await onUpdateJson(ids); written += batch.written.length; failed += batch.failures.length; failures.push(...batch.failures.slice(0,Math.max(0,20-failures.length))); setFileMessage(`Updated ${written} metadata.json files.`); });
      if (failed) setError(`${failed} failures: ${failures.join('; ')}${failed > failures.length ? '; showing the first 20.' : ''}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update metadata.json.");
    } finally {
      setBusy(false);
    }
  };
  const moveFolders = async () => {
    if (!selectedCount) return;
    const fields = Object.fromEntries(bulkFields.map(field => [field, field === "genres" ? (bulkValues[field] || "").split(",").map(item => item.trim()).filter(Boolean) : bulkValues[field] || ""]));
    if ("title" in fields && !fields.title?.trim()) {
      setError("Title cannot be empty.");
      return;
    }
    setBusy(true);
    setError("");
    setFileMessage("");
    try {
      await Promise.all([...pendingCellSaves.current]);
      if (bulkFields.length) {
        await eachSelected(ids => onSave(ids.map(id => ({ id,fields }))));
        setBulkFields([]);
        setBulkValues({});
      }
      let moved = 0, failed = 0, cancelled = false; const failures: string[] = [];
      await eachSelected(async ids => { const batch = await onMoveFolders(ids); moved += batch.moved.length; failed += batch.failures.length; failures.push(...batch.failures.slice(0,Math.max(0,20-failures.length))); cancelled = batch.cancelled; setFileMessage(`Moved ${moved} folders.`); return !cancelled; });
      if (cancelled) setFileMessage(`Folder move cancelled after ${moved} moves. Saved metadata was kept.`); else if (!moved && !failed) setFileMessage('Selected export folders already match their saved metadata.');
      if (failed) setError(`${failed} failures: ${failures.join('; ')}${failed > failures.length ? '; showing the first 20.' : ''}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move export folders.");
    } finally {
      setBusy(false);
    }
  };
  const cover = (book, size) => <CoverPreview book={book} size={size} />;
  const locationLabel = book => book.originalSourceMissing ? "M4B available \xB7 original removed" : book.sourceMissing ? "Source Missing" : book.sourceLocation === "managed" ? "Managed Library" : book.sourceLocation === "inbox" ? "In Inbox" : book.sourceLocation === "external" ? "External" : "";
  const bookIndicators = book => <span className="inline-flex items-center gap-2"><span title={book.importFinished ? "Imported book: audio processing was not requested" : book.processingStatus === "complete" ? "Previously completed by SwissMouse" : "No current successful final check"} aria-label={book.importFinished ? "Imported" : book.processingStatus === "complete" ? "Previously completed" : "Needs work"}>{book.importFinished ? <Icons.BookOpen className="h-3.5 w-3.5 text-stone-500" /> : book.processingStatus === "complete" ? <Icons.Check className="library-complete h-3.5 w-3.5" /> : <Icons.Wrench className="h-3.5 w-3.5 text-stone-500" />}</span>{book.identificationWarning && <span className="library-identification-warning" title={book.identificationWarning} aria-label={book.identificationWarning}><Icons.AlertCircle className="h-3.5 w-3.5" /></span>}{book.matchKinds?.includes("book") && <span title="Potential match for the same literary book; recordings may differ" aria-label="Potential book match"><Icons.Layers className="library-book-match h-3.5 w-3.5" /></span>}{book.matchKinds?.includes("audio") && <span title={book.audioMatchEvidence === "exact" ? "Exact duplicate audio files confirmed by SHA-256" : "Likely same recording based on sampled audio activity; review before merging"} aria-label="Potential duplicate audio"><Icons.AudioLines className="library-audio-match h-3.5 w-3.5" /></span>}{book.matchKinds?.includes("uncertain") && <span title="Uncertain book match; review missing metadata" aria-label="Uncertain match"><Icons.HelpCircle className="library-uncertain-match h-3.5 w-3.5" /></span>}</span>;
  const sourceControls = (book, indicators = true) => <span className="inline-flex flex-wrap items-center gap-2">{indicators && bookIndicators(book)}{locationLabel(book) && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${book.sourceMissing ? "bg-rose-100 text-rose-800" : "bg-stone-200 text-stone-700"}`}>{locationLabel(book)}</span>}{book.formats?.map(format => <span title={`${format} audio representation`} className="rounded border border-stone-300 bg-stone-50 px-1.5 py-0.5 text-[10px] font-bold text-stone-700" key={format}>{format}</span>)}{book.sourceMissing && <button type="button" disabled={busy} onClick={async () => {
      setBusy(true);
      setError("");
      try {
        const path = await onRelink(book.id);
        if (path) setFileMessage(`Relinked source: ${path}`);
      } catch (error2) {
        setError(error2 instanceof Error ? error2.message : "Could not relink source.");
      } finally {
        setBusy(false);
      }
    }} className="text-[11px] font-semibold text-amber-800 hover:underline disabled:opacity-40">{"Relink"}</button>}</span>;
  const playButton = (book: LibraryBook) => onPlay && <button type="button" disabled={!!book.sourceMissing} aria-label={`Play ${book.metadata.title || book.name}`} onClick={() => onPlay(book.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-stone-300 px-2.5 py-1 font-semibold text-stone-800 disabled:opacity-40"><Icons.Play className="h-4 w-4" aria-hidden="true" />Play</button>;
  const bookActions = book => <span className="inline-flex flex-wrap items-center gap-y-1 text-[11px] font-semibold text-amber-800">{(book.canMoveToLibrary || !book.sourceMissing && (book.representations?.length || 0) <= 1 && (book.sourceLocation === "external" || book.sourceLocation === "inbox")) && <span className="pr-2"><button type="button" disabled={busy} onClick={() => {
        setMoveError("");
        setMoveBook(book);
      }} className="hover:underline disabled:opacity-40">{"Move to Library"}</button></span>}<span className="border-l border-stone-300 px-2 first:border-l-0 first:pl-0"><button type="button" onClick={() => onOpen(book.id)} className="hover:underline">{"Open"}</button></span><span className="border-l border-stone-300 px-2"><button type="button" disabled={busy} onClick={async () => {
        setBusy(true);
        setError("");
        try {
          await onOpenFolder(book.id);
        } catch (error2) {
          setError(error2 instanceof Error ? error2.message : "Could not open the book folder.");
        } finally {
          setBusy(false);
        }
      }} className="inline-flex items-center gap-1 hover:underline disabled:opacity-40"><Icons.FolderOpen className="h-3.5 w-3.5" />{"Open Folder"}</button></span>{(book.representations?.length || 0) <= 1 && <span className="border-l border-stone-300 pl-2"><button type="button" onClick={() => void onDelete(book.id, book.name)} className="text-red-700 hover:underline">{"Delete"}</button></span>}</span>;
  const representationDetails = book => (book.representations?.length || 0) > 1 && <details className="mt-2 text-[11px] text-stone-600"><summary className="cursor-pointer font-semibold">{book.representations.length}{" representations"}</summary><div className="mt-1 space-y-1">{book.representations.map(item => <div className="break-all" key={`${item.id}:${item.path}`}><span>{item.formats.join(", ") || "Audio"}{" \xB7 "}{item.path}</span>{" "}<button type="button" onClick={() => onOpen(item.id)} className="font-semibold text-amber-800 underline">{"Open"}</button></div>)}</div></details>;
  const requestMatch = async (route, payload) => {
    const response = await fetch(`/api/library/matches/${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "X-SwissMouse-Catalog":"1"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not review match.");
    return data;
  };
  const compareMatch = async match => {
    setBusy(true);
    setError("");
    try {
      setComparison({
        ...(await requestMatch("compare", {
          a: match.a,
          b: match.b
        })),
        a: match.a,
        b: match.b
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not compare books.");
    } finally {
      setBusy(false);
    }
  };
  const decideMatch = async decision => {
    if (!comparison) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestMatch("decision", {
        a: comparison.a,
        b: comparison.b,
        decision: decision === "merge-b" ? "merge" : decision,
        primaryId: decision === "merge-b" ? comparison.b : comparison.a
      });
      setMatches(result.matches);
      setComparison(null);
      await onRefresh();
      setMatchRequest(value=>value+1);
      setFileMessage(decision.startsWith("merge") ? "Entries now share one logical Library card. Every source file remains at its original path." : "Review choice saved. Files were not changed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save review choice.");
    } finally {
      setBusy(false);
    }
  };
  const reopenMatch = async item => {
    setBusy(true);
    setError("");
    try {
      const result = await requestMatch("reopen", {
        a: item.a,
        b: item.b
      });
      setMatches(result.matches);
      setReviewed(current => current.filter(other => other.a !== item.a || other.b !== item.b));
      setMatchRequest(value=>value+1);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reopen match.");
    } finally {
      setBusy(false);
    }
  };
  const matchLabel = id => {
    const book = allBooks.find(book2 => book2.id === id || book2.representations?.some(item => item.id === id));
    return book ? `${book.metadata.title} \u2014 ${book.metadata.narrator || "narrator unknown"}` : id;
  };
  const detail = item => <div className="min-w-0 rounded-lg border border-stone-200 p-3 text-xs text-stone-700"><strong className="text-sm text-stone-900">{item.title}</strong><p>{item.author || "Author unknown"}{" \xB7 "}{item.narrator || "Narrator unknown"}</p><dl className="mt-2 grid grid-cols-2 gap-1"><dt>{"Runtime"}</dt><dd>{item.runtimeSeconds ? `${Math.round(item.runtimeSeconds / 60)} min` : "Unknown"}</dd><dt>{"Format"}</dt><dd>{item.formats.join(", ") || "Unknown"}</dd><dt>{"Codec"}</dt><dd>{item.codec || "Unknown"}{item.codec ? item.lossless ? " (lossless)" : " (lossy)" : ""}</dd><dt>{"Bitrate"}</dt><dd>{item.bitrate ? `${Math.round(item.bitrate / 1e3)} kbps` : "Unknown"}</dd><dt>{"Sample rate"}</dt><dd>{item.sampleRate ? `${item.sampleRate} Hz` : "Unknown"}</dd><dt>{"Channels"}</dt><dd>{item.channelLayout || item.channels || "Unknown"}</dd><dt>{"Size"}</dt><dd>{(item.fileSize / 1048576).toFixed(1)}{" MiB"}</dd><dt>{"Chapters"}</dt><dd>{item.chapterCount || "Unknown"}</dd><dt>{"Metadata fields"}</dt><dd>{item.metadataFields}</dd><dt>{"Cover"}</dt><dd>{item.coverResolution || (item.cover ? "Present" : "Missing")}</dd></dl><details className="mt-2"><summary>{"Physical paths"}</summary>{item.paths.map(path => <p className="break-all" key={path}>{path}</p>)}</details></div>;
  const locationMatches = useMemo(() => {
    if (catalog) return matches;
    const visibleIds = new Set(books.flatMap(book => [book.id, ...(book.representations?.map(item => item.id) || [])]));
    return matches.filter(match => visibleIds.has(match.a) || visibleIds.has(match.b));
  }, [books, matches]);
  const reviewableMatches = useMemo(() => locationMatches.filter(match => matchFilter === "all" || match.kind === matchFilter), [locationMatches, matchFilter]);
  const matchPageCount = Math.max(1, Math.ceil((catalog ? matchTotal : reviewableMatches.length) / 100));
  const currentMatchPage = Math.min(matchPage, matchPageCount - 1);
  const visibleMatches = catalog ? reviewableMatches : reviewableMatches.slice(currentMatchPage * 100, (currentMatchPage + 1) * 100);
  useEffect(() => setMatchPage(0), [root, availability, matchFilter]);
  useEffect(() => setMatchPage(current => Math.min(current, matchPageCount - 1)), [matchPageCount]);
  const renderCover = book => <article data-resource-id={book.resourceId} data-resource-kind="core.work" className="library-media-card relative flex flex-col rounded-xl border border-stone-200 bg-stone-50 p-3" key={book.id}><div className="library-card-heading flex min-w-0 items-start gap-3"><button type="button" onClick={() => onOpen(book.id)} className="shrink-0 self-start" aria-label={`Open ${book.metadata.title || book.name}`}>{cover(book, "aspect-square w-24")}</button><div className="min-w-0 flex-1"><button type="button" onClick={() => onOpen(book.id)} className="block w-full min-w-0 whitespace-normal text-left text-sm font-bold text-stone-950 [overflow-wrap:anywhere] hover:text-amber-800">{book.metadata.title || book.name}</button><p className="mt-1 text-xs font-medium text-stone-700">{book.metadata.author || "Unknown author"}</p>{book.metadata.series && <p className="mt-1 text-[11px] text-stone-600">{book.metadata.series}{book.metadata.seriesSequence ? ` \xB7 #${book.metadata.seriesSequence}` : ""}</p>}<p className="mt-2 text-[11px] text-stone-500">{[book.metadata.narrator, book.metadata.publishedYear].filter(Boolean).join(" \xB7 ")}</p><div className="mt-2">{sourceControls(book)}</div></div></div>{book.metadata.description && <p className="library-card-description text-xs text-stone-600" title={book.metadata.description}>{book.metadata.description}</p>}<div className="mt-auto border-t border-stone-200 pt-2 pr-10 text-xs">{selectionControl(book, true)} <span className="ml-3">{playButton(book)}</span></div><CardActions title={book.metadata.title || book.name}>{bookActions(book)}{representationDetails(book)}</CardActions></article>;
  const renderRow = book => <tr data-resource-id={book.resourceId} data-resource-kind="core.work" className="border-t border-stone-100 hover:bg-stone-50" key={book.id}><td className="p-2">{selectionControl(book)}<div className="mt-1">{bookIndicators(book)}</div></td><td className="p-2">{cover(book, "aspect-square w-9")}</td>{view === "list" ? <><td className="min-w-52 p-2"><button type="button" className="font-semibold text-stone-900 hover:text-amber-800" onClick={() => onOpen(book.id)}>{book.metadata.title || book.name}</button></td>{["author", "narrator", "series", "seriesSequence", "publishedYear"].map(field => <td className="min-w-28 p-2 text-stone-600" key={field}>{fieldValue(book, field)}</td>)}</> : <>{columns.map(({
        key,
        label,
        width
      }) => <td className={`p-1 ${width}`} key={key}><input aria-label={`${label} for ${book.metadata.title}`} value={drafts[book.id]?.[key] ?? fieldValue(book, key)} onChange={event => setDrafts(current => ({
          ...current,
          [book.id]: {
            ...current[book.id],
            [key]: event.target.value
          }
        }))} onBlur={() => void saveCell(book, key)} onKeyDown={event => {
          if (event.key === "Enter") event.currentTarget.blur();
        }} list={suggestedFields.has(key) ? `library-suggestions-${key}` : void 0} className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 focus:border-amber-400 focus:bg-white" /></td>)}</>}<td className="p-2"><div>{sourceControls(book, false)}</div><div className="mt-1">{playButton(book)} {bookActions(book)}</div>{representationDetails(book)}</td></tr>;
  const tableFields = view === 'list' ? [{key:'title',label:'Title'},{key:'author',label:'Author'},{key:'narrator',label:'Narrator'},{key:'series',label:'Series'},{key:'seriesSequence',label:'Series No.'},{key:'publishedYear',label:'Year'}] : columns;
  const defaults = [72,64,...(view === 'list' ? [240,160,160,180,100,80] : columns.map(c=>c.key==='description'?360:c.key==='title'?240:180)),240];
  const tableFieldsWithEnds = [{key:'select',label:'Select'},{key:'cover',label:'Cover'},...tableFields,{key:'actions',label:'Actions'}];
  const tableColumnWidths = tableFieldsWithEnds.map((column,index)=>columnSizes[view+':'+column.key] || defaults[index]);
  const tableColumns = <colgroup>{tableColumnWidths.map((width,index)=><col key={index} style={{width}} />)}</colgroup>;
  const tableWidth = tableColumnWidths.reduce((sum,width)=>sum+width,0);
  const tableStyle = {width:tableWidth,minWidth:tableWidth};
  const tableHeader = <thead className="sticky top-0 bg-stone-100 text-stone-700"><tr>{tableFieldsWithEnds.map((column,index)=><LibraryColumnHeader key={column.key} label={column.label} width={tableColumnWidths[index]} defaultWidth={defaults[index]} onResize={width=>setColumnSizes(current=>({...current,[view+':'+column.key]:width}))}>{sortOptions.some(option=>option.key===column.key)?<button type="button" onClick={()=>chooseSort(column.key)} className="font-semibold hover:text-amber-800">{column.label}{sort===column.key?descending?' ↓':' ↑':''}</button>:column.label}</LibraryColumnHeader>)}</tr></thead>;
  const onVirtualScroll = event => {
    if (catalog && !remote.loading && pendingScroll.current === null) {
      const element = event.currentTarget;
      const columns = view === "cover" ? columnsCount : 1;
      const step = Math.floor(400 / columns) * columns;
      if (element.scrollTop + element.clientHeight >= element.scrollHeight - 300 && remote.offset + filtered.length < remote.total) {
        pendingScroll.current = Math.max(0, element.scrollTop - (virtual.offsets[Math.floor(step / columns)] || 0));
        setCatalogOffset(remote.offset + step);
      } else if (element.scrollTop < 100 && remote.offset > 0) {
        const previous = Math.max(0, remote.offset - step);
        pendingScroll.current = element.scrollTop + (remote.offset-previous) / columns * (view === "cover" ? 332 : 80);
        setCatalogOffset(previous);
      }
    }
    virtual.onScroll();
    browsePosition.scrollTop = event.currentTarget.scrollTop;
    saveBrowse();
  };
  const updateFilter = (key, value) => {
    setFilters(current => ({
      ...current,
      [key]: value
    }));
    resetPosition();
  };
  const clearFilters = () => {
    setFilters({
      ...emptyLibraryFilters
    });
    setQuery("");
    setAvailability("available");
    resetPosition();
  };
  const applySavedSearch = saved => {
    changeRoot(saved.root);
    setCollectionId(collections.some(collection => collection.id === saved.collectionId) ? saved.collectionId : "");
    setQuery(saved.query);
    setFilters(saved.filters);
    setAvailability(saved.availability);
    setSort(sortOptions.some(option => option.key === saved.sort) ? saved.sort : "title");
    setDescending(saved.descending);
    resetPosition();
  };
  const filteredIds = new Set(filtered.map(book => book.id));
  const bookIndex = useMemo(() => new Map([...allBooks,...filtered].map(book => [book.id, book])), [allBooks,filtered]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const hiddenSelected = allSelection ? 0 : selected.filter(id => !filteredIds.has(id)).length;
  const selectionPage = continuous ? filtered.slice(virtual.start * (view === "cover" ? columnsCount : 1), virtual.end * (view === "cover" ? columnsCount : 1)) : visible;
  const saveCatalogCollection = async (input: Record<string,unknown>) => {
    try { setCollections(await catalogRequest<CatalogCollection[]>("/api/catalog/collections",input)); setCatalogRefresh(value => value+1); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const addToCollection = id => catalog ? void saveCatalogCollection({ id,ids:selected,selection:allSelection?.token,exclude:excluded }) : setCollections(current => current.map(collection => collection.id === id ? { ...collection,bookIds:[...new Set([...collection.bookIds,...selected])] } : collection));
  const navigation = <LibraryNavigation disabled={busy} collapsed={sidebarCollapsed} onCollapse={() => setSidebarCollapsed(value => !value)} root={root} onRoot={changeRoot} collections={collections} collectionId={collectionId} onCollection={id => {
    setCollectionId(id);
    clearSelection();
    resetPosition();
  }} onCreateCollection={name => {
    const id = crypto.randomUUID();
    if (catalog) { void saveCatalogCollection({ id,name,ids:selected,selection:allSelection?.token,exclude:excluded }).then(() => { setCollectionId(id); clearSelection(); resetPosition(); }); return; }
    setCollections(current => [...current, {
      id,
      name,
      bookIds: [...selected]
    }]);
    setCollectionId(id);
    resetPosition();
  }} onDeleteCollection={id => {
    if (window.confirm("Remove this collection? Books and files will remain unchanged.")) {
      if (catalog) void saveCatalogCollection({ id,remove:true });
      else setCollections(current => current.filter(item => item.id !== id));
      if (collectionId === id) setCollectionId("");
    }
  }} saved={savedSearches} onSearch={applySavedSearch} onDeleteSearch={id => setSavedSearches(current => current.filter(item => item.id !== id))} />;
  return <div data-sm-surface="library" className="space-y-4"><div className="flex justify-center"><h1 className="page-title-label inline-block text-2xl font-bold text-stone-950">Library Manager</h1></div><div className={`library-layout ${sidebarCollapsed ? "is-collapsed" : ""}`}>{navigation}<DesktopWindow id="library-books" title="Library books" contentKind="gallery"><section className="library-workspace workspace-panel min-w-0 rounded-2xl border border-stone-200 bg-white shadow-sm"><header className="workspace-panel-header workspace-toolbar flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3"><div className="flex flex-wrap items-center gap-3"><h2 className="workspace-panel-title library-heading-sticker text-sm font-bold">{activeCollection?.name || (root === "inbox" ? "Inbox" : root === "workbench" ? "Workbench projects" : "Library")}</h2><span className="text-xs text-stone-500">{catalog ? resultCount : books.length}{" books"}</span></div><div className="flex items-center gap-2"><button type="button" disabled={busy || scanning} onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onRefresh();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not refresh the library.");
            } finally {
              setBusy(false);
            }
          }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 px-3 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-40"><Icons.RefreshCw className={`h-4 w-4 ${scanning || busy ? "animate-spin" : ""}`} />{scanning ? "Scanning\u2026" : "Refresh"}</button></div></header><div className="space-y-4 p-4 sm:p-6">{catalog && remote.loading && <p role="status" className="text-xs text-stone-500">Loading library…</p>}{catalog && remote.error && <p role="alert" className="text-sm text-red-700">{remote.error}</p>}{storageWarning && <p role="status" className="text-xs text-amber-800">{storageWarning}</p>}{scanWarning && <p role="status" className="text-xs text-stone-600">{scanWarning}</p>}<div><button type="button" onClick={() => setShowMatches(value => !value)} aria-expanded={showMatches} aria-busy={matchStatus === "loading"} className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-800"><Icons.Layers className="h-4 w-4" />{"Potential Duplicates"}{catalog && !showMatches ? "" : <> ({matchStatus === "loading" ? "Checking\u2026" : matchStatus === "error" ? "Unavailable" : locationMatches.length})</>}</button></div>{matchStatus === "error" && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-red-700"><span>{matchError}</span><button type="button" onClick={() => setMatchRequest(value => value + 1)} className="font-semibold underline">{"Retry duplicate check"}</button></div>}{showMatches && <section className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3" aria-label="Potential Duplicates">{matchStatus === "loading" && <p role="status" className="text-xs text-stone-600">{"Checking for possible duplicates\u2026"}</p>}<div className="flex flex-wrap gap-2">{["all", "book", "audio", "uncertain"].map(kind => <button type="button" aria-pressed={matchFilter === kind} onClick={() => setMatchFilter(kind)} className={`rounded-lg px-2 py-1 text-xs ${matchFilter === kind ? "bg-amber-700 text-white" : "bg-white text-stone-700"}`} key={kind}>{kind === "all" ? "All" : kind === "book" ? "Book Matches" : kind === "audio" ? "Audio Matches" : "Uncertain"}</button>)}</div><p className="text-xs text-stone-600">{"Title, author, and file sizes suggest review candidates. Exact hashes confirm identical files; sampled audio activity can suggest the same recording across encodes. Technical values are clues, not a quality ranking."}</p>{matchesCapped && <p className="text-xs text-stone-600">Up to 2,000 candidates are kept ready for review. Reviewing choices makes room for more.</p>}{matchesPending && !matchesCapped && <p role="status" className="text-xs text-stone-600">Finding more candidates in the background...</p>}{(matchStatus === "ready" ? visibleMatches : []).map(match => <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-xs" key={`${match.a}:${match.b}`}><div><strong>{match.kind === "audio" ? "Audio match" : match.kind === "book" ? "Book match" : "Uncertain match"}</strong><p>{match.aTitle || matchLabel(match.a)}{" \u2194 "}{match.bTitle || matchLabel(match.b)}</p><p className="text-stone-500">{match.reasons.join(" \xB7 ")}{match.evidence ? ` \xB7 ${match.evidence}` : ""}</p></div><button type="button" disabled={busy} onClick={() => void compareMatch(match)} className="rounded border border-stone-300 px-2 py-1 font-semibold">{"Compare"}</button></div>)}{matchStatus === "ready" && matchPageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600"><span>{"Showing "}{currentMatchPage * 100 + 1}{"\u2013"}{Math.min((currentMatchPage + 1) * 100, catalog ? matchTotal : reviewableMatches.length)}{" of "}{catalog ? matchTotal : reviewableMatches.length}{" possible matches"}</span><nav aria-label="Duplicate result pages" className="flex items-center gap-2"><button type="button" disabled={currentMatchPage === 0} onClick={() => setMatchPage(currentMatchPage - 1)} className="rounded border border-stone-300 px-2 py-1 disabled:opacity-40">{"Previous matches"}</button><span>{currentMatchPage + 1}{" / "}{matchPageCount}</span><button type="button" disabled={currentMatchPage >= matchPageCount - 1} onClick={() => setMatchPage(currentMatchPage + 1)} className="rounded border border-stone-300 px-2 py-1 disabled:opacity-40">{"Next matches"}</button></nav></div>}{matchStatus === "ready" && !reviewableMatches.length && <p className="text-xs text-stone-600">{"No matches in this view."}</p>}{comparison && <div className="space-y-3 rounded-xl border border-amber-300 bg-white p-3"><h2 className="text-sm font-bold">{"Compare recordings"}</h2><div className="grid gap-2 md:grid-cols-2">{detail(comparison.left)}{detail(comparison.right)}</div><p className="text-xs font-semibold text-stone-700">{comparison.evidence}</p><p className="text-xs text-stone-600">{"Keep choices record your preference. Merge groups records into one Library card without moving, transcoding, or deleting source files."}</p><div className="flex flex-wrap gap-2">{[["keep-a", "Keep Entry A"], ["keep-b", "Keep Entry B"], ["keep-both", "Keep Both"], ["merge", "Merge under A"], ["merge-b", "Merge under B"], ["different", "Different Recording / Edition"], ["ignore", "Ignore Match"]].map(([value, label]) => <button type="button" disabled={busy} onClick={() => void decideMatch(value)} className="rounded border border-stone-300 px-2 py-1 text-xs font-semibold text-stone-800 hover:bg-stone-100" key={value}>{label}</button>)}<button type="button" onClick={() => setComparison(null)} className="px-2 py-1 text-xs">{"Close"}</button></div></div>}{!!reviewedTotal && <details className="text-xs"><summary className="cursor-pointer font-semibold">{"Reviewed choices ("}{reviewedTotal}{")"}</summary><div className="mt-2 space-y-1">{reviewed.map(item => <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-white p-2" key={`${item.a}:${item.b}`}><span>{item.aTitle || matchLabel(item.a)}{" \u2194 "}{item.bTitle || matchLabel(item.b)}{" \xB7 "}{item.decision.replaceAll("-", " ")}</span><button type="button" disabled={busy} onClick={() => void reopenMatch(item)} className="font-semibold text-amber-800 underline">{"Reopen"}</button></div>)}</div>{catalog && reviewedTotal>100 && <nav aria-label="Reviewed choice pages" className="mt-2 flex items-center gap-2"><button type="button" disabled={reviewedPage===0} onClick={()=>setReviewedPage(page=>page-1)}>Previous choices</button><span>{reviewedPage+1} / {Math.ceil(reviewedTotal/100)}</span><button type="button" disabled={(reviewedPage+1)*100>=reviewedTotal} onClick={()=>setReviewedPage(page=>page+1)}>Next choices</button></nav>}</details>}</section>}<div className="library-selection-bar sticky flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 text-xs" role="group" aria-label="Library selection actions"><span className="font-semibold" role="status">{selectedCount}{" selected"}{hiddenSelected ? ` \xB7 ${hiddenSelected} outside current results` : ""}</span><button type="button" disabled={busy || catalog && remote.loading || !selectionPage.length} onClick={() => { if (allSelection) setExcluded(current => current.filter(id => !selectionPage.some(book => book.id === id))); else setSelected(current => [...new Set([...current, ...selectionPage.map(book => book.id)])]); }} className="rounded border border-stone-300 px-2 py-1">{continuous ? "Select loaded rows" : "Select this page"}</button><button type="button" disabled={busy || !resultCount || catalog && remote.loading} onClick={() => void selectAllMatching()} className="rounded border border-stone-300 px-2 py-1">{"Select all "}{resultCount}{" matching results"}</button>{!!selectedCount && <><button type="button" onClick={() => {
            clearSelection();
            selectionAnchor.current = null;
          }} className="rounded px-2 py-1">{"Clear selection"}</button><button type="button" onClick={() => chooseView("edit")} className="rounded border border-stone-300 px-2 py-1">{"Bulk edit"}</button><label>{"Add to collection "}<select aria-label="Add selected to collection" value="" onChange={event => {
              if (event.target.value) addToCollection(event.target.value);
            }} className="rounded border border-stone-300 bg-white p-1"><option value="">{"Choose\u2026"}</option>{collections.map(collection => <option value={collection.id} key={collection.id}>{collection.name}</option>)}</select></label>{activeCollection && <button type="button" onClick={() => {
            if (catalog) { void saveCatalogCollection({ id:collectionId,ids:selected,selection:allSelection?.token,exclude:excluded,removeMembers:true }); clearSelection(); return; }
            setCollections(current => current.map(collection => collection.id === collectionId ? {
              ...collection,
              bookIds: collection.bookIds.filter(id => !selectedIds.has(id))
            } : collection));
            setSelected([]);
          }} className="rounded px-2 py-1">{"Remove from collection"}</button>}<button type="button" disabled={busy || (allSelection?.hasGroups || selected.some(id => (bookIndex.get(id)?.representations?.length || 0) > 1))} title="Open individual representations before deleting a merged book" onClick={() => {
            setBusy(true); void eachSelected(onDeleteMany).then(clearSelection).catch(cause => setError(cause.message)).finally(() => setBusy(false));
          }} className="ml-auto rounded px-2 py-1 text-red-700 disabled:opacity-40">{"Delete selected"}</button></>}</div><div className="workspace-toolbar library-toolbar flex flex-wrap items-center gap-2"><div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">{([["cover", Icons.Grid2X2, "Cover View"], ["list", Icons.List, "List View"], ["edit", Icons.Pencil, "Edit View"]] as [string, Icons.LucideIcon, string][]).map(([key, Icon, label]) => <button type="button" aria-pressed={view === key} onClick={() => chooseView(key)} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold ${view === key ? "bg-white text-amber-800 shadow-sm" : "text-stone-600"}`} key={key}><Icon className="h-3.5 w-3.5" />{label}</button>)}</div><label className="relative min-w-48 flex-1"><Icons.Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" /><input value={query} onChange={event => {
            setQuery(event.target.value);
            resetPosition();
          }} aria-label="Search library" placeholder="Search books" className="w-full rounded-xl border border-stone-200 py-2 pl-9 pr-3 text-sm" /></label><label className="text-xs text-stone-600">{"Availability "}<select value={availability} onChange={event => {
            setAvailability(event.target.value as "available"|"missing"|"all");
            resetPosition();
            setSelected([]);
          }} className="rounded-lg border border-stone-200 bg-white p-2"><option value="available">{"Available"}</option><option value="missing">{catalog ? "Unavailable" : <>{"Unavailable ("}{allBooks.filter(book => book.sourceMissing && (root === "workbench" ? !book.rootType : (book.rootTypes || [book.rootType]).includes(root))).length}{")"}</>}</option><option value="all">{"All"}</option></select></label><label className="text-xs text-stone-600">{"Sort "}<select value={sort} onChange={event => chooseSort(event.target.value)} className="ml-1 rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs">{sortOptions.map(option => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label><label className="text-xs text-stone-600">{"Books per page "}<select value={view === "edit" && pageSize === "all" ? 100 : pageSize} onChange={event => {
            const next = event.target.value === "all" ? "all" : Number(event.target.value);
            setPageSize(next);
            localStorage.setItem("swissmouse_library_page_size", String(next));
            resetPosition();
          }} className="ml-1 rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs">{pageSizes.map(size => <option value={size} disabled={size === "all" && view === "edit"} key={size}>{size === "all" ? "All" : size}</option>)}</select></label>{view === "edit" && pageSize === "all" && <span className="text-[11px] text-stone-500">{"Edit uses pages of 100."}</span>}<button type="button" onClick={() => {
          setDescending(!descending);
          resetPosition();
        }} aria-label={descending ? "Sort ascending" : "Sort descending"} className="rounded-lg border border-stone-200 px-2.5 py-2 text-xs font-semibold text-stone-700">{descending ? "\u2193 Desc" : "\u2191 Asc"}</button></div>{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{fileMessage && <p role="status" className="break-all rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{fileMessage}</p>}{view === "edit" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600"><p>{"Changes save to the library when you leave a field. Shift-click selection circles to select a range. Select books to update JSON, move export folders, or write tags into audio."}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !selectedCount} onClick={() => void updateJson()} className="rounded-lg border border-amber-400 px-3 py-2 font-bold text-amber-900 hover:bg-amber-50 disabled:opacity-40">{"Update JSON"}{selectedCount ? ` (${selectedCount} selected)` : ""}</button><button type="button" disabled={busy || !selectedCount} onClick={() => void moveFolders()} className="rounded-lg border border-stone-300 px-3 py-2 font-bold text-stone-800 hover:bg-stone-100 disabled:opacity-40">{"Move folders"}{selectedCount ? ` (${selectedCount} selected)` : ""}</button><button type="button" disabled={busy || !selectedCount} onClick={() => void writeFiles()} className="rounded-lg bg-amber-700 px-3 py-2 font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Writing metadata\u2026" : `Write metadata to audiobook file${selectedCount === 1 ? "" : "s"}${selectedCount ? ` (${selectedCount} selected)` : ""}`}</button></div></div>}<details className="rounded-lg border border-stone-200 bg-stone-50 p-3"><summary className="cursor-pointer text-xs font-semibold">{"Filters & saved searches"}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{["creator", "narrator", "series", "tag"].map(key => <label className="text-xs capitalize" key={key}>{key}<input aria-label={`Filter by ${key}`} value={filters[key]} onChange={event => updateFilter(key, event.target.value)} className="mt-1 w-full rounded border border-stone-300 px-2 py-1" /></label>)}<label className="text-xs">{"Format"}<select aria-label="Filter by format" value={filters.format} onChange={event => updateFilter("format", event.target.value)} className="mt-1 w-full rounded border border-stone-300 bg-white p-2"><option value="">{"All formats"}</option>{(catalog ? catalogFormats : [...new Set(allBooks.flatMap(book => book.formats || []))].sort()).map(format => <option value={format} key={format}>{format.toUpperCase()}</option>)}</select></label></div><form className="mt-3 flex flex-wrap gap-2" onSubmit={event => {
          event.preventDefault();
          if (searchName.trim()) {
            const existing = savedSearches.find(item => item.name.toLocaleLowerCase() === searchName.trim().toLocaleLowerCase());
            const search: SavedLibrarySearch = {
              id: existing?.id || crypto.randomUUID(),
              name: searchName.trim(),
              root,
              query,
              filters: {
                ...filters
              },
              availability,
              sort,
              descending,
              collectionId: collectionId || void 0
            };
            setSavedSearches(current => existing ? current.map(item => item.id === existing.id ? search : item) : [...current, search]);
            setSearchName("");
          }
        }}><input aria-label="Saved search name" value={searchName} maxLength={100} onChange={event => setSearchName(event.target.value)} placeholder="Name this search" className="min-w-0 rounded border border-stone-300 px-2 py-1 text-xs" /><button type="submit" disabled={!searchName.trim()} className="rounded border border-stone-300 px-3 py-1 text-xs disabled:opacity-40">{"Save search"}</button><span className="self-center text-[10px] text-stone-500">{"Saved on this browser; includes location, filters, and sorting."}</span></form></details>{(query || Object.values(filters).some(Boolean) || availability !== "available") && <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Active library filters">{query && <button type="button" onClick={() => {
          setQuery("");
          resetPosition();
        }} className="rounded-full border border-stone-300 bg-stone-50 px-2 py-1">{"Search: "}{query}{" \xD7"}</button>}{Object.keys(filters).filter(key => filters[key]).map(key => <button type="button" onClick={() => updateFilter(key, "")} aria-label={`Remove ${key} filter`} className="rounded-full border border-stone-300 bg-stone-50 px-2 py-1" key={key}>{key}{": "}{filters[key]}{" \xD7"}</button>)}{availability !== "available" && <button type="button" onClick={() => {
          setAvailability("available");
          resetPosition();
        }} className="rounded-full border border-stone-300 px-2 py-1">{"Availability: "}{availability}{" \xD7"}</button>}<button type="button" onClick={clearFilters} className="font-semibold underline">{"Clear Filters"}</button></div>}{view === "edit" && <details className="rounded-xl border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-stone-900">{"Bulk edit \xB7 "}{selectedCount}{" selected"}</summary><div className="mt-3 space-y-3"><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={() => { setAllSelection(null); setExcluded([]); setSelected(visible.map(book => book.id)); }} className="text-xs font-semibold text-amber-800 underline">{"Select visible"}</button><button type="button" onClick={clearSelection} className="text-xs font-semibold text-stone-600 underline">{"Clear selection"}</button></div><p className="text-xs text-stone-600">{"Choose each field to overwrite. All other metadata stays as it is. Checked fields with empty values will be cleared."}</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{columns.map(({
              key,
              label
            }) => <label className="rounded-lg bg-white p-2 text-xs ring-1 ring-stone-200" key={key}><span className="flex items-center gap-1.5 font-semibold"><input type="checkbox" className="library-field-checkbox" checked={bulkFields.includes(key)} onChange={() => setBulkFields(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])} />{label}</span><input value={bulkValues[key] || ""} disabled={!bulkFields.includes(key)} onChange={event => setBulkValues(current => ({
                ...current,
                [key]: event.target.value
              }))} list={suggestedFields.has(key) ? `library-suggestions-${key}` : void 0} className="mt-1 w-full rounded border border-stone-200 px-2 py-1.5 disabled:bg-stone-100" /></label>)}</div><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !selectedCount || !bulkFields.length} onClick={saveBulk} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy ? "Saving\u2026" : `Apply to ${selectedCount} books`}</button><button type="button" disabled={busy || !selectedCount} onClick={() => void updateJson()} className="rounded-lg border border-amber-400 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">{"Apply and update JSON"}</button><button type="button" disabled={busy || !selectedCount} onClick={() => void moveFolders()} className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-bold text-stone-800 disabled:opacity-50">{"Apply and move folders"}</button></div></div></details>}{Object.entries(suggestions).map(([field, values]) => <datalist id={`library-suggestions-${field}`} key={field}>{values.map(value => <option value={value} key={value} />)}</datalist>)}{!catalog && !books.length ? <div className="rounded-xl border border-dashed border-stone-300 p-12 text-center text-sm text-stone-600">{activeCollection ? "No books in this collection. Select books in Inbox or Library, then use Add to collection." : "No books at this location. Import a book or change Availability."}</div> : !filtered.length ? <p className="rounded-xl bg-stone-50 p-8 text-center text-sm text-stone-500">{catalog && remote.loading ? "Loading library…" : remote.error || (query.trim() || Object.values(filters).some(Boolean) ? "No books match that search. Clear filters or change Availability." : activeCollection ? "No books in this collection. Select books in Inbox or Library, then use Add to collection." : "No books in this view. Import a book or change Availability.")}</p> : view === "cover" ? continuous ? <div ref={virtual.scroller} onScroll={onVirtualScroll} className="max-h-[70vh] min-h-96 overflow-y-auto rounded-xl" aria-label="Continuous cover view"><div className="relative" style={{
          height: virtual.totalHeight
        }}>{Array.from({
            length: virtual.end - virtual.start
          }, (_, offset) => {
            const index = virtual.start + offset;
            return <div className="absolute inset-x-0" style={{
              top: virtual.offsets[index]
            }} key={index}><MeasuredLibraryRow index={index} onMeasure={virtual.measure} className="grid gap-3 pb-3" style={{
                height: 332, gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))`
              }}>{filtered.slice(index * columnsCount, (index + 1) * columnsCount).map(renderCover)}</MeasuredLibraryRow></div>;
          })}</div></div> : <div className="library-cover-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">{visible.map(renderCover)}</div> : continuous ? <div ref={virtual.scroller} onScroll={onVirtualScroll} className="max-h-[70vh] min-h-96 overflow-auto rounded-xl border border-stone-200" style={{overflowAnchor:"none",scrollbarGutter:"stable"}} aria-label="Continuous list view"><table className="library-details-table w-full table-fixed border-collapse text-left text-xs" style={tableStyle}>{tableColumns}{tableHeader}<tbody>{virtual.offsets[virtual.start] > 0 && <tr aria-hidden="true"><td colSpan={tableColumnWidths.length} style={{
                height: virtual.offsets[virtual.start],
                padding: 0
              }} /></tr>}{filtered.slice(virtual.start, virtual.end).map((book, offset) => <MeasuredLibraryTableRow index={virtual.start + offset} onMeasure={virtual.measure} key={book.id}>{renderRow(book)}</MeasuredLibraryTableRow>)}{virtual.totalHeight > virtual.offsets[virtual.end] && <tr aria-hidden="true"><td colSpan={tableColumnWidths.length} style={{
                height: virtual.totalHeight - virtual.offsets[virtual.end],
                padding: 0
              }} /></tr>}</tbody></table></div> : <div className="overflow-x-auto rounded-xl border border-stone-200"><table className="library-details-table w-full table-fixed border-collapse text-left text-xs" style={tableStyle}>{tableColumns}{tableHeader}<tbody>{visible.map(renderRow)}</tbody></table></div>}{!continuous && pageCount > 1 && <div className="flex items-center justify-between text-xs text-stone-600"><span>{"Showing "}{visible.length}{" of "}{resultCount}{" matching books"}</span><div className="flex items-center gap-2"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-stone-200 px-2 py-1 disabled:opacity-40">{"Previous"}</button><span>{Math.min(page, pageCount - 1) + 1}{" / "}{pageCount}</span><button disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} className="rounded border border-stone-200 px-2 py-1 disabled:opacity-40">{"Next"}</button></div></div>}{moveBook && <MoveToLibraryDialog jobId={moveBook.id} name={moveBook.name} busy={busy} error={moveError} unchecked={!moveBook.canMoveToLibrary} onChoose={mode => void transfer(mode)} onCancel={() => setMoveBook(null)} />}</div></section></DesktopWindow></div></div>;
};
