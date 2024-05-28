import { type CloudItem, type CloudItemShared } from "@filen/sdk";
export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
export type DriveCloudItem = Prettify<CloudItem & CloudItemShared & {
    selected: boolean;
}>;
export type DriveCloudItemWithPath = Prettify<DriveCloudItem & {
    path: string;
}>;
