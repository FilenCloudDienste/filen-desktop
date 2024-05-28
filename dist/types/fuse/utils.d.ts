/// <reference types="lodash" />
import type { OpenMode } from "./types";
export declare const uuidToNumber: ((uuid: string) => number) & import("lodash").MemoizedFunction;
export declare const flagsToMode: (flags: number) => OpenMode;
export declare const pathToHash: ((path: string) => string) & import("lodash").MemoizedFunction;
