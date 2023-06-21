import { readFileSync } from 'fs'

export const VERIFIED_DIDS = readFileSync('./VERIFIED.txt', 'utf8')
  .split('\n')
  .map((line) => line.replace(/\s?\#.+$/, '').trim())
  .filter((i) => i)
