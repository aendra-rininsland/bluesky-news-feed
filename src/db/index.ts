import SqliteDb from 'better-sqlite3'
import { Kysely, Migrator, SqliteDialect, PostgresDialect } from 'kysely'
import { DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'
import { Pool } from 'pg'

const dialect = process.env.DATABASE_URL ? 'pg' : 'sqlite'

export const createDb = (location: string): Database => {
  if (dialect === 'pg') {
    const params = new URL(process.env.DATABASE_URL || '')

    return new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          user: params.username,
          password: params.password,
          host: params.hostname,
          database: params.pathname.split('/')[1],
          ssl: { rejectUnauthorized: false },
        }),
      }),
    })
  }
  return new Kysely<DatabaseSchema>({
    dialect: new SqliteDialect({
      database: new SqliteDb(location),
    }),
  })
}

export const migrateToLatest = async (db: Database) => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error
}

export type Database = Kysely<DatabaseSchema>
