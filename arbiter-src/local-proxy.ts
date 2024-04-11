import Proxy from './proxy';
import axios, { AxiosRequestConfig } from 'axios';
import url from 'url';
import { delay } from './utils';

const { parseStringPromise } = require('xml2js');

interface Args {
  enabled: boolean,
  operator: string,
  apiEndpoint: string,
  connectionString: string
  proxyId: string
}

const getSignedClient = async (proxy: LocalProxy) => {
  const params: AxiosRequestConfig = {
    baseURL: proxy.apiEndpoint,
    headers: {
      // Так как какой-то глюк и в Host добавляется :80
      // приходится переписывать это
      'Host': url.parse(proxy.apiEndpoint).host,
      'Accept': '*/*',
    },
    maxRedirects: 0,
  };

  const client = axios.create(params);

  const { data: xml } = await client.get('/api/webserver/SesTokInfo');
  const { response: { SesInfo, TokInfo } } = await parseStringPromise(xml);

  client.defaults.headers = {
    ...client.defaults.headers,
    'Cookie': SesInfo[0],
    '__RequestVerificationToken': TokInfo[0],
  };

  return client;
};

const dataSwitchRequest = async (proxy: LocalProxy, status: number) => {
  const client = await getSignedClient(proxy);

  await client.post('/api/dialup/mobile-dataswitch',
    `<?xml version: "1.0" encoding="UTF-8"?><request><dataswitch>${status}</dataswitch></request>`,
  );

  proxy.log(`Изменил состояние модема ${status}`);
};

const waitUntilOff = async (proxy: LocalProxy) => {
  proxy.log(`Ожидаю выключения`);

  while (true) {
    const wanIPAddress = await checkStatus(proxy);

    if (!wanIPAddress) {
      proxy.log(`Модем выключен`);

      return;
    }

    await delay(500);
  }
};

const waitUntilOn = async (proxy: LocalProxy) => {
  proxy.log(`Пробую включить модем`);

  let tries = 20;

  while (--tries > 0) {
    const wanIPAddress = await checkStatus(proxy);

    if (wanIPAddress) {
      return wanIPAddress;
    }

    await delay(500);
  }

  throw new Error('Не смог включить интернет!');
};

const checkStatus = async (proxy: LocalProxy): Promise<boolean> => {
  const client = await getSignedClient(proxy);

  const { data: xml } = await client.get('/api/monitoring/status');
  const { response } = await parseStringPromise(xml);

  return response['PrimaryDns'][0];
};

export default class LocalProxy extends Proxy {

  // Адрес API для урпавления модемов
  operator: string;
  apiEndpoint: string;

  constructor ({
    operator,
    enabled,
    apiEndpoint,
    connectionString,
    proxyId,
  }: Args) {
    super(
      connectionString,
      enabled,
      proxyId
    );

    this.operator = 'UNKNOWN';
    this.apiEndpoint = apiEndpoint;
  }

  async update ({ apiEndpoint, connectionString, proxyId, enabled }: any) {
    this.proxyId = proxyId
    this.enabled = enabled;
    this.connectionString = connectionString;
    this.apiEndpoint = apiEndpoint;

    return true;
  }

  async getAccountBalance () {
    const client = await getSignedClient(this);

    const { data: xml } = await client.post('/api/ussd/send',
      `<?xml version="1.0" encoding="UTF-8"?><request><content>*100#</content><codeType>CodeType</codeType><timeout></timeout></request>`
    );

    const doc = await parseStringPromise(xml);

    if (doc?.response === 'OK') {
      let tries = 10;

      while (tries-- > 0) {
        const { data: xml } = await client.get('/api/ussd/get');
        const doc = await parseStringPromise(xml);

        if (doc?.response) {
          return doc.response.content[0];
        }

        await delay(2000);
      }
    }

    return 'UNKNOWN';
  }

  async getOperator () {
    const client = await getSignedClient(this);

    try {
      const { data: xml } = await client.get('/operator.cgi');
      const rawResponse = await parseStringPromise(xml);

      const { response: { FullName } } = rawResponse;

      this.log('Оператор: ' + FullName[0]);

      this.operator = FullName[0];
    } catch {
      try {
        const { data: xml } = await client.get('/api/net/current-plmn');
        const rawResponse = await parseStringPromise(xml);

        const { response: { FullName } } = rawResponse;

        this.log('Оператор: ' + FullName[0]);

        this.operator = FullName[0];
      } catch (e: any) {
        this.log('Ошибка определения оператора: ' + e.message);

        this.operator = 'ERROR';
      }
    }
  }

  toJson (): any {
    return {
      ...super.toJson(),
      operator: this.operator,
      apiEndpoint: this.apiEndpoint,
    };
  }

  protected async performCheckStatus (): Promise<void> {
    if (!await checkStatus(this)) {
      throw new Error('Модем не подключен к сети');
    }

    await this.getOperator();
  }

  protected async performRestart () {
    // Отключаем интернет на модеме
    await dataSwitchRequest(this, 0);

    // Ждём чтобы отключился модем
    await waitUntilOff(this);

    // Ждем 10 секунд
    await delay(1000 * 10);

    // Запускаем интернет на модеме
    await dataSwitchRequest(this, 1);

    // Ждем пока модем подключится к сети
    await waitUntilOn(this);

    // Узнаем какой сейчас оператор
    await this.getOperator();
  }
}
