import * as utils from '@koishijs/utils'
import { Dict, MaybeArray } from 'cosmokit'
import { Database, Driver, Update } from 'minato'
import { Fragment, Universal } from '@satorijs/core'
import { Context } from './context'

declare module './context' {
  interface Events {
    'model'(name: keyof Tables): void
  }

  interface Context {
    database: DatabaseService
    model: DatabaseService
    broadcast(content: Fragment, forced?: boolean): Promise<string[]>
    broadcast(channels: readonly string[], content: Fragment, forced?: boolean): Promise<string[]>
  }
}

export interface User {
  id: number
  name: string
  /** @deprecated */
  flag: number
  authority: number
  locales: string[]
  permissions: string[]
  createdAt: Date
}

export namespace User {
  export enum Flag {
    ignore = 1,
  }

  export type Field = keyof User
  export type Observed<K extends Field = Field> = utils.Observed<Pick<User, K>, Promise<void>>
}

export interface Binding {
  aid: number
  bid: number
  pid: string
  platform: string
}

export interface Channel {
  id: string
  platform: string
  /** @deprecated */
  flag: number
  assignee: string
  guildId: string
  locales: string[]
  permissions: string[]
  createdAt: Date
}

export namespace Channel {
  export enum Flag {
    ignore = 1,
    silent = 4,
  }

  export type Field = keyof Channel
  export type Observed<K extends Field = Field> = utils.Observed<Pick<Channel, K>, Promise<void>>
}

export interface Tables {
  user: User
  binding: Binding
  channel: Channel
}

export class DatabaseService extends Database<Tables, Context> {
  constructor(ctx: Context) {
    super(ctx)

    this.extend('user', {
      id: 'unsigned(8)',
      name: { type: 'string', length: 255 },
      flag: 'unsigned(8)',
      authority: 'unsigned(4)',
      locales: 'list(255)',
      permissions: 'list',
      createdAt: 'timestamp',
    }, {
      autoInc: true,
    })

    this.extend('binding', {
      aid: 'unsigned(8)',
      bid: 'unsigned(8)',
      pid: 'string(255)',
      platform: 'string(255)',
    }, {
      primary: ['pid', 'platform'],
    })

    this.extend('channel', {
      id: 'string(255)',
      platform: 'string(255)',
      flag: 'unsigned(8)',
      assignee: 'string(255)',
      guildId: 'string(255)',
      locales: 'list(255)',
      permissions: 'list',
      createdAt: 'timestamp',
    }, {
      primary: ['id', 'platform'],
    })

    ctx.on('login-added', ({ platform }) => {
      if (platform in this.tables.user.fields) return
      this.migrate('user', { [platform]: 'string(255)' }, async (db) => {
        const users = await db.get('user', { [platform]: { $exists: true } }, ['id', platform as never])
        await db.upsert('binding', users.filter(u => u[platform]).map((user) => ({
          aid: user.id,
          bid: user.id,
          pid: user[platform],
          platform,
        })))
      })
    })
  }

  async getUser<K extends User.Field>(platform: string, pid: string, modifier?: Driver.Cursor<K>): Promise<Pick<User, K>> {
    const [binding] = await this.get('binding', { platform, pid }, ['aid'])
    if (!binding) return
    const [user] = await this.get('user', { id: binding.aid }, modifier)
    return user
  }

  async setUser(platform: string, pid: string, data: Update<User>) {
    const [binding] = await this.get('binding', { platform, pid }, ['aid'])
    if (!binding) throw new Error('user not found')
    return this.set('user', binding.aid, data)
  }

  async createUser(platform: string, pid: string, data: Partial<User>) {
    const user = await this.create('user', data)
    await this.create('binding', { aid: user.id, bid: user.id, pid, platform })
    return user
  }

  getChannel<K extends Channel.Field>(platform: string, id: string, modifier?: Driver.Cursor<K>): Promise<Pick<Channel, K | 'id' | 'platform'>>
  getChannel<K extends Channel.Field>(platform: string, ids: string[], modifier?: Driver.Cursor<K>): Promise<Pick<Channel, K>[]>
  async getChannel(platform: string, id: MaybeArray<string>, modifier?: Driver.Cursor<Channel.Field>) {
    const data = await this.get('channel', { platform, id }, modifier)
    if (Array.isArray(id)) return data
    if (data[0]) Object.assign(data[0], { platform, id })
    return data[0]
  }

  getSelfIds(platforms?: string[]): Dict<string[]> {
    const selfIdMap: Dict<string[]> = Object.create(null)
    for (const bot of this.ctx.bots) {
      if (platforms && !platforms.includes(bot.platform)) continue
      (selfIdMap[bot.platform] ||= []).push(bot.selfId)
    }
    return selfIdMap
  }

  getAssignedChannels<K extends Channel.Field>(fields?: K[], selfIdMap?: Dict<string[]>): Promise<Pick<Channel, K>[]>
  async getAssignedChannels(fields?: Channel.Field[], selfIdMap: Dict<string[]> = this.getSelfIds()) {
    return this.get('channel', {
      $or: Object.entries(selfIdMap).map(([platform, assignee]) => ({ platform, assignee })),
    }, fields)
  }

  setChannel(platform: string, id: string, data: Update<Channel>) {
    return this.set('channel', { platform, id }, data)
  }

  createChannel(platform: string, id: string, data: Partial<Channel>) {
    return this.create('channel', { platform, id, ...data })
  }

  async broadcast(...args: [Fragment, boolean?] | [readonly string[], Fragment, boolean?]) {
    let channels: string[], platforms: string[]
    if (Array.isArray(args[0])) {
      channels = args.shift() as any
      platforms = channels.map(c => c.split(':')[0])
    }
    const [content, forced] = args as [Fragment, boolean]
    if (!content) return []

    const selfIdMap = this.getSelfIds(platforms)
    const data = await this.getAssignedChannels(['id', 'assignee', 'flag', 'platform', 'guildId', 'locales'], selfIdMap)
    const assignMap: Dict<Dict<Pick<Channel, 'id' | 'guildId' | 'locales'>[]>> = {}
    for (const channel of data) {
      const { platform, id, assignee, flag } = channel
      if (channels) {
        const index = channels?.indexOf(`${platform}:${id}`)
        if (index < 0) continue
        channels.splice(index, 1)
      }
      if (!forced && (flag & Channel.Flag.silent)) continue
      ((assignMap[platform] ||= {})[assignee] ||= []).push(channel)
    }

    if (channels?.length) {
      this[Context.current].logger('app').warn('broadcast', 'channel not found: ', channels.join(', '))
    }

    return (await Promise.all(this.ctx.bots.map((bot) => {
      const targets = assignMap[bot.platform]?.[bot.selfId]
      if (!targets) return Promise.resolve([])
      const sessions = targets.map(({ id, guildId, locales }) => {
        const session = bot.session({
          type: 'message',
          channel: { id, type: Universal.Channel.Type.TEXT },
          guild: { id: guildId },
        })
        session.locales = locales
        return session
      })
      return bot.broadcast(sessions, content)
    }))).flat(1)
  }
}
