import Proxy from './proxy'
import axios, { AxiosRequestConfig } from 'axios'
import { delay } from './utils'

interface Args {
  enabled: boolean,
  connectionString: string,
  proxyId: string,
}

interface IProxy {
  proxy_id: string,
  proxy_exp: string,
  proxy_login: string,
  proxy_pass: string,
  proxy_hostname: string,
  proxy_host_ip: string,
  proxy_independent_http_hostname: string,
  proxy_independent_http_host_ip: string,
  proxy_independent_socks5_hostname: string,
  proxy_independent_socks5_host_ip: string,
  proxy_independent_port: string,
  proxy_http_port: string,
  proxy_socks5_port: number,
  proxy_operator: string,
  proxy_geo: string,
  proxy_auto_renewal: string,
  proxy_reboot_time: number,
  proxy_ipauth: string,
  proxy_auto_change_equipment: string,
  proxy_change_ip_url: string
}

const ENDPOINT = 'https://mobileproxy.space'

const params: AxiosRequestConfig = {
  headers: {
    'Authorization': 'Bearer 907a64cda8a66e30f1ab5fd08bb4b18d',
  },
  maxRedirects: 0,
}

const client = axios.create(params)

export default class MobileProxySpace extends Proxy {

  static async getList (): Promise<Array<IProxy>> {
    return (await client.get<Array<IProxy>>(ENDPOINT + '/api.html?command=get_my_proxy')).data
  }

  proxyId: string

  constructor ({ proxyId, connectionString, enabled }: Args) {
    super(connectionString, enabled)

    this.proxyId = proxyId
  }

  async update ({ connectionString, proxyId, enabled }: Args) {
    this.connectionString = connectionString
    this.proxyId = proxyId
    this.enabled = enabled

    return true
  }
  
  async getAccountBalance () {
	return 'NOT_AVAILABLE';
  }

  toJson (): any {
    return {
      ...super.toJson(),
      proxyId: this.proxyId,
    }
  }

  protected async performCheckStatus (): Promise<void> {
    await this.getProxy()
  }

  protected async performRestart () {
    const proxy = await this.getProxy()

    this.log('Адрес для перезагрузки: ' + proxy.proxy_change_ip_url)
    this.log('Начинаю процесс перезагрузки')

    try {
      await client.get(proxy.proxy_change_ip_url + '&format=json')
      await delay(2000)
    } catch { // Ошибка смены IP, пробуем перезагрузить прокси
      this.log('Получить новый IP не удалось, пробую перезагрузить оборудование')

      try {
        await this.executeCommand('reboot_proxy')
        await delay(5000)
      } catch (e: any) {
        this.log('Перезагрузить не вышло')
        throw e
      }
    }
  }

  protected async getProxy (): Promise<IProxy> {
    this.log('Запрашиваю данные по прокси ' + this.proxyId)

    const proxies = await this.executeCommand<Array<IProxy>>('get_my_proxy')
    const proxy = proxies[0]

    this.log('Годен до: ' + proxy.proxy_exp)
    this.log('Оператор: ' + proxy.proxy_operator)
    this.log('ГЕО: ' + proxy.proxy_geo)

    return proxy
  }

  protected async executeCommand<T extends any> (command: string): Promise<T> {
    return (await client.get<T>(ENDPOINT + '/api.html?command=' + command + '&proxy_id=' + this.proxyId)).data
  }
}