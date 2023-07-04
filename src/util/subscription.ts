import { Subscription } from '@atproto/xrpc-server'
import { cborToLexRecord, readCar } from '@atproto/repo'
import { BlobRef } from '@atproto/lexicon'
import { ids, lexicons } from '../lexicon/lexicons'
import { BskyAgent } from '@atproto/api'
import { Record as PostRecord } from '../lexicon/types/app/bsky/feed/post'
import { Record as RepostRecord } from '../lexicon/types/app/bsky/feed/repost'
import { Record as LikeRecord } from '../lexicon/types/app/bsky/feed/like'
import { Record as FollowRecord } from '../lexicon/types/app/bsky/graph/follow'
import {
  Commit,
  OutputSchema as RepoEvent,
  isCommit,
} from '../lexicon/types/com/atproto/sync/subscribeRepos'
import { Database } from '../db'
import debug from 'debug'

const log = debug('newsfeed:subscriptionBase')

export const agent = new BskyAgent({ service: 'https://bsky.social' })

export abstract class FirehoseSubscriptionBase {
  public sub: Subscription<RepoEvent>
  public forbidden: { data: string[]; news: string[] }
  public verified: { data: string[]; news: string[]; journalists: string[] }
  mutelists: { data: string; news: string }
  allowlists: { data: string; news: string; journalists: string }

  constructor(
    public db: Database,
    public service: string,
    mutelists: any,
    allowlists: any,
  ) {
    this.sub = new Subscription({
      service: service,
      method: ids.ComAtprotoSyncSubscribeRepos,
      getParams: () => this.getCursor(),
      validate: (value: unknown) => {
        try {
          return lexicons.assertValidXrpcMessage<RepoEvent>(
            ids.ComAtprotoSyncSubscribeRepos,
            value,
          )
        } catch (err) {
          console.error('repo subscription skipped invalid message', err)
        }
      },
    })
    this.mutelists = mutelists
    this.allowlists = allowlists
    this.forbidden = { news: [], data: [] }
    this.verified = { news: [], data: [], journalists: [] }
  }

  abstract handleEvent(evt: RepoEvent): Promise<void>

  async run() {
    await agent.login({
      identifier: 'aendra.bsky.social',
      password: process.env.USER_PASS || '',
    })

    // Fetch initial lists
    await this.updateLists()

    for await (const evt of this.sub) {
      try {
        await this.handleEvent(evt)
      } catch (err) {
        console.error('repo subscription could not handle message', err)
      }
      // update stored cursor every 20 events or so
      if (isCommit(evt) && evt.seq % 20 === 0) {
        await this.updateCursor(evt.seq)
      }

      // update mute/verified lists and purge old every 10000 events
      if (isCommit(evt) && evt.seq % 10000 === 0) {
        await Promise.all([this.updateLists(), this.purgeOldJournalistSkeets()])
      }
    }
  }

  async updateLists() {
    this.forbidden.data = (
      await agent.app.bsky.graph.getList({ list: this.mutelists.data })
    ).data.items.map((d) => d.subject.did)

    this.forbidden.news = (
      await agent.app.bsky.graph.getList({ list: this.mutelists.news })
    ).data.items.map((d) => d.subject.did)

    this.verified.data = (
      await agent.app.bsky.graph.getList({
        list: this.allowlists.data,
      })
    ).data.items.map((d) => d.subject.did)

    this.verified.news = (
      await agent.app.bsky.graph.getList({
        list: this.allowlists.news,
      })
    ).data.items.map((d) => d.subject.did)

    this.verified.journalists = (
      await agent.app.bsky.graph.getList({
        list: this.allowlists.journalists,
      })
    ).data.items.map((d) => d.subject.did)

    log(`Updated mutes:`, this.forbidden)
    log(`Updated verifieds:`, this.verified)
  }

  async purgeOldJournalistSkeets() {
    // Delete posts older than MAX_AGE
    const MAX_AGE = 24 * 14 // two weeks
    const oneHour = 60 * 60 * 1000 /* ms */
    const timeago = new Date(
      new Date().getTime() - MAX_AGE * oneHour,
    ).toISOString()

    await this.db
      .deleteFrom('journalist')
      .where('indexedAt', '<', timeago)
      .execute()

    log('Purged old journo skeets')
  }

  async updateCursor(cursor: number) {
    await this.db
      .updateTable('sub_state_headlines')
      .set({ cursor })
      .where('service', '=', this.service)
      .execute()
  }

  async getCursor(): Promise<{ cursor?: number }> {
    const res = await this.db
      .selectFrom('sub_state_headlines')
      .selectAll()
      .where('service', '=', this.service)
      .executeTakeFirst()
    return res ? { cursor: res.cursor } : {}
  }
}

export const getOpsByType = async (evt: Commit): Promise<OperationsByType> => {
  const car = await readCar(evt.blocks)
  const opsByType: OperationsByType = {
    posts: { creates: [], deletes: [] },
    reposts: { creates: [], deletes: [] },
    likes: { creates: [], deletes: [] },
    follows: { creates: [], deletes: [] },
  }

  for (const op of evt.ops) {
    const uri = `at://${evt.repo}/${op.path}`
    const [collection] = op.path.split('/')

    if (op.action === 'update') continue // updates not supported yet

    if (op.action === 'create') {
      if (!op.cid) continue
      const recordBytes = car.blocks.get(op.cid)
      if (!recordBytes) continue
      const record = cborToLexRecord(recordBytes)
      const create = { uri, cid: op.cid.toString(), author: evt.repo }
      if (collection === ids.AppBskyFeedPost && isPost(record)) {
        opsByType.posts.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyFeedRepost && isRepost(record)) {
        opsByType.reposts.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyFeedLike && isLike(record)) {
        opsByType.likes.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyGraphFollow && isFollow(record)) {
        opsByType.follows.creates.push({ record, ...create })
      }
    }

    if (op.action === 'delete') {
      if (collection === ids.AppBskyFeedPost) {
        opsByType.posts.deletes.push({ uri })
      } else if (collection === ids.AppBskyFeedRepost) {
        opsByType.reposts.deletes.push({ uri })
      } else if (collection === ids.AppBskyFeedLike) {
        opsByType.likes.deletes.push({ uri })
      } else if (collection === ids.AppBskyGraphFollow) {
        opsByType.follows.deletes.push({ uri })
      }
    }
  }

  return opsByType
}

type OperationsByType = {
  posts: Operations<PostRecord>
  reposts: Operations<RepostRecord>
  likes: Operations<LikeRecord>
  follows: Operations<FollowRecord>
}

type Operations<T = Record<string, unknown>> = {
  creates: CreateOp<T>[]
  deletes: DeleteOp[]
}

type CreateOp<T> = {
  uri: string
  cid: string
  author: string
  record: T
}

type DeleteOp = {
  uri: string
}

export const isPost = (obj: unknown): obj is PostRecord => {
  return isType(obj, ids.AppBskyFeedPost)
}

export const isRepost = (obj: unknown): obj is RepostRecord => {
  return isType(obj, ids.AppBskyFeedRepost)
}

export const isLike = (obj: unknown): obj is LikeRecord => {
  return isType(obj, ids.AppBskyFeedLike)
}

export const isFollow = (obj: unknown): obj is FollowRecord => {
  return isType(obj, ids.AppBskyGraphFollow)
}

const isType = (obj: unknown, nsid: string) => {
  try {
    lexicons.assertValidRecord(nsid, fixBlobRefs(obj))
    return true
  } catch (err) {
    return false
  }
}

// @TODO right now record validation fails on BlobRefs
// simply because multiple packages have their own copy
// of the BlobRef class, causing instanceof checks to fail.
// This is a temporary solution.
const fixBlobRefs = (obj: unknown): unknown => {
  if (Array.isArray(obj)) {
    return obj.map(fixBlobRefs)
  }
  if (obj && typeof obj === 'object') {
    if (obj.constructor.name === 'BlobRef') {
      const blob = obj as BlobRef
      return new BlobRef(blob.ref, blob.mimeType, blob.size, blob.original)
    }
    return Object.entries(obj).reduce((acc, [key, val]) => {
      return Object.assign(acc, { [key]: fixBlobRefs(val) })
    }, {} as Record<string, unknown>)
  }
  return obj
}
