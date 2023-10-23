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
const token_1 = __importDefault(require("./token"));
const events_1 = require("events");
const axios_1 = __importDefault(require("axios"));
const utils_1 = require("./utils");
const SocksProxyAgent = require('socks-proxy-agent');
class Proxy extends events_1.EventEmitter {
    constructor(connectionString, enabled = false) {
        super();
        /** Количество активных токенов */
        this.activeTokens = 0;
        /** Время последнего доступа */
        this.lastAccessTimestamp = 0;
        /** Находится в состоянии перезагрузки */
        this.restarting = false;
        /** Кол-во отданных токенов */
        this.tokensAcquired = 0;
        /** IP адрес */
        this.ipAddress = '';
        /** Требуется обслуживание */
        this.maintenance = false;
        this.id = String(Math.floor(Math.random() * 100000000000));
        this.enabled = enabled;
        this.connectionString = connectionString;
    }
    log(message) {
        this.emit('log', `[${new Date}] [${this.constructor.name}] [${this.connectionString}] ${message}`);
    }
    /**
     * Получить токен подключения к прокси
     * @param max
     */
    acquire(max) {
        if (!this.enabled || // Прокси выключен
            this.maintenance || // Прокси ожидает перезагрузку
            this.lastError // Ошибка прокси
        ) {
            return;
        }
        this.activeTokens++; // Активные токены
        this.tokensAcquired++; // Всего сколько было выдано токенов
        // Выдали максимум сколько можно токенов,
        // помечаем что прокси нужна перезагрузка
        if (this.tokensAcquired === max) {
            this.maintenance = true;
        }
        // Дата последнего доступа к прокси
        this.lastAccessTimestamp = (new Date()).getTime();
        const token = new token_1.default();
        token.once('destroy', () => __awaiter(this, void 0, void 0, function* () {
            this.activeTokens--;
            // Активных токенов больше не осталось.
            // Если прокси требуется перезагрузка и прокси ещё включено, то перезагружаем
            if (this.activeTokens === 0 && this.maintenance) {
                this.emit('will-restart');
                if (this.enabled) {
                    yield this.restart();
                }
                this.maintenance = false;
                this.emit('did-restart');
            }
        }));
        return token;
    }
    /**
     * Перезагрузить прокси
     */
    restart() {
        return __awaiter(this, void 0, void 0, function* () {
            this.restarting = true; // Помечаем что прокси на обслуживании
            this.lastError = undefined; // Сбрасываем ошибку
            try {
                this.log('Перезагрузка...');
                yield this.performRestart();
                // Чуть-чуть потупим
                yield (0, utils_1.delay)(2000);
                // await this.testConnection()
                yield this.getIpAddress();
                this.tokensAcquired = 0; // Сбрасываем кол-во использованных токенов
                this.log('Успешно перезагружен');
                return true;
            }
            catch (e) {
                this.lastError = e.message;
                this.log('Не удалось перезагрузить: ' + e.message);
                return false;
            }
            finally {
                this.restarting = false;
            }
        });
    }
    /**
     * Проверяем состояние прокси и возвращаем текущий IP адрес
     */
    checkStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.performCheckStatus();
                // await this.testConnection()
                yield this.getIpAddress();
                return this.ipAddress;
            }
            catch (e) {
                this.log('Ошибка проверки статуса: ' + e.message);
                return '';
            }
        });
    }
    /**
     * Первичная проверка прокси
     */
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.tokensAcquired = 0;
            this.activeTokens = 0;
            this.lastError = undefined;
            // Прокси выключен, пропускаем инициализацию
            if (!this.enabled) {
                return;
            }
            // Времено отключем прокси на этапе инициализации
            this.enabled = false;
            // Проверяем, как себя чуствует прокси
            // если всё хорошо, то помечаем что прокси активный
            if (yield this.checkStatus()) {
                this.log('Прокси работает');
                this.enabled = true;
            }
            // Пробуем сделать рестарт прокси
            else {
                this.log(`Прокси не работает. Пробую сделать перезагрузку`);
                if (yield this.restart()) {
                    this.enabled = true;
                }
            }
        });
    }
    /**
     * Конверация прокси в JSON формат (Для сохранения)
     */
    toJson() {
        return {
            type: this.constructor.name,
            connectionString: this.connectionString,
            enabled: this.enabled,
        };
    }
    /**
     * Выгрузка данных по прокси
     */
    dump() {
        return {
            connectionString: this.connectionString,
            enabled: this.enabled,
            activeTokens: this.activeTokens,
            lastAccessTimestamp: this.lastAccessTimestamp,
            maintenance: this.maintenance,
            restarting: this.restarting,
            tokensAcquired: this.tokensAcquired,
        };
    }
    /**
     * Проверяем коннект до удаленного сайта
     * @private
     */
    testConnection() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const httpAgent = new SocksProxyAgent(`socks5://${this.connectionString}`);
                const client = axios_1.default.create({
                    baseURL: 'http://shxcraw.club',
                    headers: {
                        'Host': 'shxcraw.club',
                        'User-Agent': 'curl/7.64.1',
                    },
                    httpAgent: httpAgent,
                    maxRedirects: 0,
                    timeout: 4000,
                });
                const { data } = yield client.get('/');
                if (!data.includes('Your new web server is ready to use')) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error('Не могу открыть shxcraw.club');
                }
                this.log('Успешно загрузил shxcraw.club');
            }
            catch (e) {
                throw new Error('Не смог загрузить robots.txt [' + e.message + '] [' + e.name + '] Data: ' + (JSON.stringify((_a = e.response) === null || _a === void 0 ? void 0 : _a.data)) + ' Headers: ' + JSON.stringify((_b = e.response) === null || _b === void 0 ? void 0 : _b.headers));
            }
        });
    }
    /**
     * Получаем IP адрес на выходе
     * @private
     */
    getIpAddress() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            this.log('Проверяю доступ в интернет');
            let error;
            // Пробуем 2 раза
            for (let i = 0; i < 2; i++) {
                try {
                    const httpAgent = new SocksProxyAgent(`socks5://${this.connectionString}`);
                    const client = axios_1.default.create({
                        baseURL: 'http://st.babysfera.ru',
                        headers: {
                            'Host': 'st.babysfera.ru',
                            'User-Agent': 'bots',
                        },
                        httpAgent: httpAgent,
                        maxRedirects: 0,
                        timeout: 4000,
                    });
                    this.ipAddress = (yield client.get('/myip')).data.trim();
                    this.log('IP: ' + this.ipAddress);
                    return;
                }
                catch (e) {
                    error = e;
                    yield (0, utils_1.delay)(1000);
                }
            }
            throw new Error('Не смог проверить IP адрес [' + error.message + '] [' + error.name + ']' +
                ' Data: ' + JSON.stringify((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) +
                ' Headers: ' + JSON.stringify((_b = error.response) === null || _b === void 0 ? void 0 : _b.headers));
        });
    }
    disable() {
        this.maintenance = false;
        this.restarting = false;
        this.tokensAcquired = 0;
        this.lastAccessTimestamp = 0;
        this.lastError = '';
    }
}
exports.default = Proxy;
