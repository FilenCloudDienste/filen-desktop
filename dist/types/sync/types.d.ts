export type SyncMode = "twoWay" | "localToCloud" | "localBackup" | "cloudToLocal" | "cloudBackup";
export type SyncPair = {
    uuid: string;
    localPath: string;
    remotePath: string;
    remoteParentUUID: string;
    mode: SyncMode;
};
