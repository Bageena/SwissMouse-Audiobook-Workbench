
import { File, PanelsTopLeft, RefreshCw } from 'lucide-react';
export function RefreshDocumentIcon({ kind, spinning = false }: { kind: 'file' | 'page'; spinning?: boolean }) {
  const Back = kind === 'file' ? File : PanelsTopLeft;
  return <span aria-hidden="true" className="refresh-document-icon"><Back className="refresh-document-back" /><RefreshCw className={`refresh-document-front ${spinning ? 'animate-spin' : ''}`} /></span>;
}
