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
const url_1 = __importDefault(require("url"));
const utils_1 = require("./utils");
const { parseStringPromise } = require('xml2js');
const getSignedClient = (proxy) => __awaiter(void 0, void 0, void 0, function* () {
    const params = {
        baseURL: proxy.apiEndpoint,
        headers: {
            // Так как какой-то глюк и в Host добавляется :80
            // приходится переписывать это
            'Host': url_1.default.parse(proxy.apiEndpoint).host,
            'Accept': '*/*',
        },
        maxRedirects: 0,
    };
    const client = axios_1.default.create(params);
    const { data: xml } = yield client.get('/api/webserver/SesTokInfo');
    const { response: { SesInfo, TokInfo } } = yield parseStringPromise(xml);
    client.defaults.headers = Object.assign(Object.assign({}, client.defaults.headers), { 'Cookie': SesInfo[0], '__RequestVerificationToken': TokInfo[0] });
    return client;
});
const dataSwitchRequest = (proxy, status) => __awaiter(void 0, void 0, void 0, function* () {
    const client = yield getSignedClient(proxy);
    yield client.post('/api/dialup/mobile-dataswitch', `<?xml version: "1.0" encoding="UTF-8"?><request><dataswitch>${status}</dataswitch></request>`);
    proxy.log(`Изменил состояние модема ${status}`);
});
const waitUntilOff = (proxy) => __awaiter(void 0, void 0, void 0, function* () {
    proxy.log(`Ожидаю выключения`);
    while (true) {
        const wanIPAddress = yield checkStatus(proxy);
        if (!wanIPAddress) {
            proxy.log(`Модем выключен`);
            return;
        }
        yield (0, utils_1.delay)(500);
    }
});
const waitUntilOn = (proxy) => __awaiter(void 0, void 0, void 0, function* () {
    proxy.log(`Пробую включить модем`);
    let tries = 20;
    while (--tries > 0) {
        const wanIPAddress = yield checkStatus(proxy);
        if (wanIPAddress) {
            return wanIPAddress;
        }
        yield (0, utils_1.delay)(500);
    }
    throw new Error('Не смог включить интернет!');
});
const checkStatus = (proxy) => __awaiter(void 0, void 0, void 0, function* () {
    const client = yield getSignedClient(proxy);
    const { data: xml } = yield client.get('/api/monitoring/status');
    const { response } = yield parseStringPromise(xml);
    return response['PrimaryDns'][0];
});
class LocalProxy extends proxy_1.default {
    constructor({ operator, enabled, apiEndpoint, connectionString, }) {
        super(connectionString, enabled);
        this.operator = operator;
        this.apiEndpoint = apiEndpoint;
    }
    update({ apiEndpoint, connectionString, enabled }) {
        return __awaiter(this, void 0, void 0, function* () {
            this.enabled = enabled;
            this.connectionString = connectionString;
            this.apiEndpoint = apiEndpoint;
            return true;
        });
    }
    getAccountBalance() {
        return __awaiter(this, void 0, void 0, function* () {
            const client = yield getSignedClient(this);
            const { data: xml } = yield client.post('/api/ussd/send', `<?xml version="1.0" encoding="UTF-8"?><request><content>*100#</content><codeType>CodeType</codeType><timeout></timeout></request>`);
            const doc = yield parseStringPromise(xml);
            if ((doc === null || doc === void 0 ? void 0 : doc.response) === 'OK') {
                let tries = 10;
                while (tries-- > 0) {
                    const { data: xml } = yield client.get('/api/ussd/get');
                    const doc = yield parseStringPromise(xml);
                    if (doc === null || doc === void 0 ? void 0 : doc.response) {
                        return doc.response.content[0];
                    }
                    yield (0, utils_1.delay)(2000);
                }
            }
            return 'UNKNOWN';
        });
    }
    getOperator() {
        return __awaiter(this, void 0, void 0, function* () {
            const client = yield getSignedClient(this);
            // /operator.cgi
            const { data: xml } = yield client.get('/api/net/current-plmn');
            const rawResponse = yield parseStringPromise(xml);
            try {
                const { response: { FullName } } = rawResponse;
                return FullName[0];
            }
            catch (e) {
                this.log('Ошибка определения оператора: ' + e.message + '. Response: ' + rawResponse);
                return '';
            }
        });
    }
    toJson() {
        return Object.assign(Object.assign({}, super.toJson()), { operator: this.operator, apiEndpoint: this.apiEndpoint });
    }
    performCheckStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!(yield checkStatus(this))) {
                throw new Error('Модем не подключен к сети');
            }
            yield this.getOperator();
        });
    }
    performRestart() {
        return __awaiter(this, void 0, void 0, function* () {
            // Отключаем интернет на модеме
            yield dataSwitchRequest(this, 0);
            // Ждём чтобы отключился модем
            yield waitUntilOff(this);
            // Ждем 10 секунд
            yield (0, utils_1.delay)(1000 * 10);
            // Запускаем интернет на модеме
            yield dataSwitchRequest(this, 1);
            // Ждем пока пока модем подключится к сети
            yield waitUntilOn(this);
            // Узнаем какой сейчас оператор
            yield this.getOperator();
        });
    }
}
exports.default = LocalProxy;
