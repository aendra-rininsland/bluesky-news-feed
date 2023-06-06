export type DatabaseSchema = {
  post: Headline
  sub_state: SubState
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
