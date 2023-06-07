import { readFileSync } from 'fs'

export const VERIFIED_DIDS = readFileSync('./VERIFIED.txt', 'utf8')
  .replace(/\#.*$/, '')
  .split('\n')
  .map((line) => line.trim())
