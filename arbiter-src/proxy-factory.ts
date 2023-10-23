import LocalProxy from './local-proxy'
import Proxy from './proxy'
import MobileProxySpace from './mobile-proxy-space'

export default class ProxyFactory {

  static createFromJSON (data: any): Proxy {
    if (!data.type || data.type === 'LocalProxy') {
      return new LocalProxy(data)
    } else if (data.type === 'MobileProxySpace') {
      return new MobileProxySpace(data)
    } else {
      throw new Error
    }
  }
}
