import { Context, Schema } from 'koishi'
import basic, { BasicConfig } from './basic'

export * from './basic'

declare module 'koishi' {
  interface Modules {
    common: typeof import('.')
  }
}

export const name = 'common'

export interface Config extends BasicConfig {}

export const Config = Schema.object({
  echo: Schema.boolean().description('启用 echo 指令。').default(true),
  broadcast: Schema.boolean().description('启用 broadcast 指令。').default(true),
  contextify: Schema.boolean().description('启用 contextify 指令。').default(true),
})

export function apply(ctx: Context, config: Config) {
  ctx.command('common', '基础功能')

  ctx.plugin(basic, config)
}