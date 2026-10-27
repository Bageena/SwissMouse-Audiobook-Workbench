import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AudiobookMetadata, ChapterEntry } from '../src/types';
import { extendedMetadata } from '../src/utils/extendedMetadata';
import { audiobookshelfMetadata } from '../src/utils/audiobookshelfMetadata';

/** Compatibility off never touches an existing metadata.json. All writes are atomic. */
export function writeMetadataSidecars(metadata:AudiobookMetadata, chapters:ChapterEntry[], folders:string[], options:{ audiobookshelf?:boolean; resourceId?:string; assertOwnership:(folder:string)=>void; associate:(file:string)=>void }) {
  const sidecars = [['exmetadata.json',extendedMetadata(metadata,chapters,options.resourceId)], ...(options.audiobookshelf ? [['metadata.json',audiobookshelfMetadata(metadata,chapters)]] : [])] as const;
  const written:string[] = [];
  for (const folder of new Set(folders)) {
    options.assertOwnership(folder);
    for (const [name,data] of sidecars) {
      const target = path.join(folder,name as string), staging = target + '.' + randomUUID() + '.tmp';
      try {
        fs.writeFileSync(staging,JSON.stringify(data,null,2)+'\n','utf8'); fs.renameSync(staging,target);
        options.associate(target); written.push(target);
      } finally { if (fs.existsSync(staging)) fs.rmSync(staging,{force:true}); }
    }
  }
  return written;
}
