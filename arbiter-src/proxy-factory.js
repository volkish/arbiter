"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const local_proxy_1 = __importDefault(require("./local-proxy"));
const mobile_proxy_space_1 = __importDefault(require("./mobile-proxy-space"));
class ProxyFactory {
    static createFromJSON(data) {
        if (!data.type || data.type === 'LocalProxy') {
            return new local_proxy_1.default(data);
        }
        else if (data.type === 'MobileProxySpace') {
            return new mobile_proxy_space_1.default(data);
        }
        else {
            throw new Error;
        }
    }
}
exports.default = ProxyFactory;
