/// <reference path="../../../index.d.ts" />
/// <reference types="node" />
/// <reference types="node" />
import * as Fuse from "@gcas/fuse";
import crypto from "crypto";
export type FuseStatFS = {
    bsize: number;
    frsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
    files: number;
    ffree: number;
    favail: number;
    fsid: number;
    flag: number;
    namemax: number;
};
export type FuseErrorCallbackSimple = (err: number) => void;
export type FuseStatFSCallback = (err: number, stats?: FuseStatFS) => void;
export type FuseStatsCallback = (err: number, stats?: Fuse.Stats) => void;
export type FuseReaddirCallback = (err: number, names?: string[], stats?: Fuse.Stats[]) => void;
export type FuseReadlinkCallback = (err: number, linkName?: string) => void;
export type FuseGetxattrCallback = (err: number, buffer?: Buffer | null) => void;
export type FuseListxattrCallback = (err: number, list?: string[]) => void;
export type FuseOpenCallback = (err: number, fd?: number) => void;
export type FuseCreateCallback = (err: number, fd?: number, modePassedOn?: number) => void;
export type FuseReadWriteCallback = (err: number, bytes?: number) => void;
export type FuseUpload = {
    name: string;
    size: number;
    path: string;
    key: string;
    uuid: string;
    parent: string;
    uploadKey: string;
    region: string;
    bucket: string;
    hasher: crypto.Hash;
    nextHasherChunk: number;
};
export type OpenMode = "r" | "r+" | "w";
