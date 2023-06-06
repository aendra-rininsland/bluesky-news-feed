import { readFileSync } from 'fs'

export const ALLOWLIST = readFileSync('./ALLOWLIST.txt', 'utf8')
  .replace(/\#.*$/, '')
  .split('\n')
  .map((line) => line.trim())
