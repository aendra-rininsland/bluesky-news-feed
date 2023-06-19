export type DatabaseSchema = {
  headline: Headline
  sub_state_headlines: SubState
  chart: Chart
}

export type Headline = {
  uri: string
  cid: string
  author: string
  replyParent: string | null
  replyRoot: string | null
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}

export type Chart = {
  uri: string
  cid: string
  author: string
  replyParent: string | null
  replyRoot: string | null
  indexedAt: string
}
