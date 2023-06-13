import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import { VERIFIED_DIDS } from './verified'
import debug from 'debug'
const log = debug('newsfeed:subscription')
export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return
    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)
    const postsToCreate = ops.posts.creates
      .filter((create) => {
        // only news-related posts
        return (
          create.record.embed?.external &&
          (VERIFIED_DIDS.includes(create.author) ||
            create.record.text.includes('📰') ||
            create.record.text.match(/^breaking:?\s/i))
        )
      })
      .map((create) => {
        // map news-related posts to a db row
        return {
          uri: create.uri,
          cid: create.cid,
          author: create.author,
          replyParent: create.record?.reply?.parent.uri ?? null,
          replyRoot: create.record?.reply?.root.uri ?? null,
          indexedAt: new Date().toISOString(),
        }
      })

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('headline')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      log(postsToCreate)
      await this.db
        .insertInto('headline')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
