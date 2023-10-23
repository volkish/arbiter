"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const proxy_1 = __importDefault(require("./proxy"));
const axios_1 = __importDefault(require("axios"));
const utils_1 = require("./utils");
const ENDPOINT = 'https://mobileproxy.space';
const params = {
    headers: {
        'Authorization': 'Bearer 907a64cda8a66e30f1ab5fd08bb4b18d',
    },
    maxRedirects: 0,
};
const client = axios_1.default.create(params);
class MobileProxySpace extends proxy_1.default {
    static getList() {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield client.get(ENDPOINT + '/api.html?command=get_my_proxy')).data;
        });
    }
    constructor({ proxyId, connectionString, enabled }) {
        super(connectionString, enabled);
        this.proxyId = proxyId;
    }
    update({ connectionString, proxyId, enabled }) {
        return __awaiter(this, void 0, void 0, function* () {
            this.connectionString = connectionString;
            this.proxyId = proxyId;
            this.enabled = enabled;
            return true;
        });
    }
    getAccountBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            return 'NOT_AVAILABLE';
        });
    }
    toJson() {
        return Object.assign(Object.assign({}, super.toJson()), { proxyId: this.proxyId });
    }
    performCheckStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getProxy();
        });
    }
    performRestart() {
        return __awaiter(this, void 0, void 0, function* () {
            const proxy = yield this.getProxy();
            this.log('Адрес для перезагрузки: ' + proxy.proxy_change_ip_url);
            this.log('Начинаю процесс перезагрузки');
            try {
                yield client.get(proxy.proxy_change_ip_url + '&format=json');
                yield (0, utils_1.delay)(2000);
            }
            catch ( // Ошибка смены IP, пробуем перезагрузить прокси
            _a) { // Ошибка смены IP, пробуем перезагрузить прокси
                this.log('Получить новый IP не удалось, пробую перезагрузить оборудование');
                try {
                    yield this.executeCommand('reboot_proxy');
                    yield (0, utils_1.delay)(5000);
                }
                catch (e) {
                    this.log('Перезагрузить не вышло');
                    throw e;
                }
            }
        });
    }
    getProxy() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log('Запрашиваю данные по прокси ' + this.proxyId);
            const proxies = yield this.executeCommand('get_my_proxy');
            const proxy = proxies[0];
            this.log('Годен до: ' + proxy.proxy_exp);
            this.log('Оператор: ' + proxy.proxy_operator);
            this.log('ГЕО: ' + proxy.proxy_geo);
            return proxy;
        });
    }
    executeCommand(command) {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield client.get(ENDPOINT + '/api.html?command=' + command + '&proxy_id=' + this.proxyId)).data;
        });
    }
}
exports.default = MobileProxySpace;
