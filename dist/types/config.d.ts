import { type FilenSDKConfig } from "@filen/sdk";
export declare let SDK_CONFIG: FilenSDKConfig | null;
export declare function setSDKConfig(config: FilenSDKConfig): void;
export declare function waitForSDKConfig(): Promise<FilenSDKConfig>;
export default SDK_CONFIG;
