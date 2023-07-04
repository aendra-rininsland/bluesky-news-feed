import { AppContext } from '../config'
import {
  QueryParams,
  OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import * as news from './news'
import * as data from './data'
import * as verifiedNews from './verified-news'
import * as journalists from './journalists'
import * as journalistLinks from './journalist-links'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

const algos: Record<string, AlgoHandler> = {
  [news.shortname]: news.handler,
  [data.shortname]: data.handler,
  [verifiedNews.shortname]: verifiedNews.handler,
  [journalists.shortname]: journalists.handler,
  [journalistLinks.shortname]: journalistLinks.handler,
}

export default algos
