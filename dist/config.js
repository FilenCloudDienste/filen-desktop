"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForSDKConfig = exports.setSDKConfig = exports.SDK_CONFIG = void 0;
exports.SDK_CONFIG = null;
function setSDKConfig(config) {
    exports.SDK_CONFIG = config;
    console.log("SDK config set");
}
exports.setSDKConfig = setSDKConfig;
function waitForSDKConfig() {
    return new Promise(resolve => {
        if (exports.SDK_CONFIG) {
            resolve(exports.SDK_CONFIG);
            return;
        }
        const wait = setInterval(() => {
            if (exports.SDK_CONFIG) {
                clearInterval(wait);
                resolve(exports.SDK_CONFIG);
            }
        }, 100);
    });
}
exports.waitForSDKConfig = waitForSDKConfig;
exports.default = exports.SDK_CONFIG;
//# sourceMappingURL=config.js.map