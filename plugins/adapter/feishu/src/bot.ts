import { Adapter, Bot, Quester, Schema } from 'koishi'
import { Internal } from './types'
import { AdapterConfig } from './utils'

export interface BotConfig extends Bot.BaseConfig, Quester.Config {
  endpoint: string
  appId: string
  appSecret: string
}

export const BotConfig = Schema.intersect([
  Schema.object({
    endpoint: Schema.string().required().description('机器人的终结点。'),
    appId: Schema.string().required().description('机器人的应用 ID。'),
    appSecret: Schema.string().role('secret').required().description('机器人的应用密钥。'),
  }),
  Quester.createSchema({
    endpoint: 'https://open.feishu.cn/open-apis/',
  }),
])

export class FeishuBot extends Bot<BotConfig> {
  static schema = AdapterConfig
  _token?: string
  http: Quester
  internal: Internal

  constructor(adapter: Adapter, config: BotConfig) {
    super(adapter, config)

    this.selfId = config.appId

    this.http = adapter.ctx.http.extend({
      endpoint: config.endpoint,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
    })

    this.internal = new Internal(this.http)

    this.refreshToken()
  }

  private async refreshToken(): Promise<void> {
    const { tenant_access_token: token } = await this.internal.getTenantAccessToken({
      app_id: this.config.appId,
      app_secret: this.config.appSecret,
    })
    this.logger.debug('refreshed token %s', token)
    this.token = token
  }

  get token() {
    return this._token
  }

  set token(v: string) {
    this._token = v
    this.http.config.headers.Authorization = `Bearer ${v}`
  }
}