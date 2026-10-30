import type { InformationReadItem } from './information';
/** Internal durable publication prototype; not an installed SDK write capability. */
export interface InformationPublication {
    sourceId: string;
    epoch: string;
    version: number;
    item: InformationReadItem;
    aliases: readonly {
        namespace: string;
        key: string;
    }[];
    retired: boolean;
}
