/** Provisional, data-only bridge to the existing verified-transfer engine. */
export type FileStamp = { name: string; size: number; mtime: number; identity: string };
export type MoveEntry = { source: string; name: string; stamp: FileStamp };
export type CopiedFile = { name: string; stamp: FileStamp; hash: string };
export type TransferJournal = {
  version: 2; id: string; source: string; target: string; mode: 'copy' | 'move';
  entries: MoveEntry[]; pending?: { source: string; quarantine: string };
  operation?: 'project' | 'exports' | 'import';
  destinationRoot?: string;
  copied?: CopiedFile[];
  reusedTarget?: boolean;
};
