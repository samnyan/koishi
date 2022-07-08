import { Adapter } from 'koishi'
import { TelegramBot } from './bot'
import { HttpPolling, HttpServer } from './http'
import * as Telegram from './types'

declare module 'koishi' {
  interface Session {
    telegram?: Telegram.Update & Telegram.Internal
  }

  interface Events {
    'telegram/inline-query'(session: Session): void
    'telegram/chosen-inline-result'(session: Session): void
    'telegram/callback-query'(session: Session): void
    'telegram/shipping-query'(session: Session): void
    'telegram/pre-checkout-query'(session: Session): void
    'telegram/poll'(session: Session): void
    'telegram/poll-answer'(session: Session): void
    'telegram/chat-member'(session: Session): void
  }
}

export * as Telegram from './types'
export * from './bot'
export * from './http'
export * from './sender'
export * from './utils'

export default Adapter.define('telegram', TelegramBot, {
  webhook: HttpServer,
  polling: HttpPolling,
}, ({ pollingTimeout }) => {
  return pollingTimeout ? 'polling' : 'webhook'
})
