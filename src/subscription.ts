import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import * as AppBskyEmbedExternal from './lexicon/types/app/bsky/embed/external'
import { FirehoseSubscriptionBase, getOpsByType } from './util/subscription'
import debug from 'debug'

const log = debug('newsfeed:subscription')

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return
    const ops = await getOpsByType(evt)

    const postsToDelete = ops.posts.deletes.map((del) => del.uri)

    const headlinesToCreate = ops.posts.creates
      .filter((create) => !this.forbidden.news.includes(create.author))
      .filter((create) => {
        // only news-related posts
        return (
          (create.record.embed?.external || // Embedded link
            create.record.text.includes('https://')) && // Non-embedded link
          (this.verified.news.includes(create.author) || // Verified news orgs
            create.record.text.includes('📰') || // Newspaper Emoji
            create.record.text.match(/^breaking:?\s/i) || // "breaking:"
            create.record.text.match(/#breaking(?:\s|$)/i)) // "#breaking"
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

    // only chart-posts
    const chartsToCreate = ops.posts.creates
      .filter((create) => !this.forbidden.data.includes(create.author))
      .filter((create) => {
        // External link with thumbnail
        if (AppBskyEmbedExternal.isExternal(create.record.embed?.external)) {
          return (
            create.record.embed?.external.thumb &&
            (create.record.text.includes('📈') || // chart emojis
              create.record.text.includes('📉') ||
              create.record.text.includes('📊'))
          )
        }

        // Image posts
        return (
          create.record.embed?.images &&
          (create.record.text.includes('📈') || // chart emojis
            create.record.text.includes('📉') ||
            create.record.text.includes('📊'))
        )
      })
      .map((create) => {
        // map chart-related posts to a db row
        return {
          uri: create.uri,
          cid: create.cid,
          author: create.author,
          replyParent: create.record?.reply?.parent.uri ?? null,
          replyRoot: create.record?.reply?.root.uri ?? null,
          indexedAt: new Date().toISOString(),
        }
      })

    // All skeets by journalists
    const journalistSkeetsToCreate = ops.posts.creates
      .filter((create) => this.verified.journalists.includes(create.author))
      .map((create) => {
        const hasExternal =
          AppBskyEmbedExternal.isExternal(create.record.embed?.external) || // Embedded link
          create.record.text.includes('https://') // Non-embedded link
        // map news-related posts to a db row
        return {
          uri: create.uri,
          cid: create.cid,
          author: create.author,
          replyParent: create.record?.reply?.parent.uri ?? null,
          replyRoot: create.record?.reply?.root.uri ?? null,
          indexedAt: new Date().toISOString(),
          hasExternal,
        }
      })

    // Delete posts marked for deletion from database
    if (postsToDelete.length > 0) {
      await Promise.all([
        this.db
          .deleteFrom('headline')
          .where('uri', 'in', postsToDelete)
          .execute(),
        this.db.deleteFrom('chart').where('uri', 'in', postsToDelete).execute(),
        this.db
          .deleteFrom('journalist')
          .where('uri', 'in', postsToDelete)
          .execute(),
      ])
    }

    // Create entries in headline table
    if (headlinesToCreate.length > 0) {
      log(headlinesToCreate)
      await this.db
        .insertInto('headline')
        .values(headlinesToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    // Create entries in chart table
    if (chartsToCreate.length > 0) {
      log(chartsToCreate)
      await this.db
        .insertInto('chart')
        .values(chartsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }

    // Create entries in the journalist table
    if (journalistSkeetsToCreate.length > 0) {
      log(journalistSkeetsToCreate)
      await this.db
        .insertInto('journalist')
        .values(journalistSkeetsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }
}
