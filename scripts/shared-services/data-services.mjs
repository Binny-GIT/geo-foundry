import pg from "pg"
import { createClient } from "redis"

import {
  PROJECT_DATABASE,
  PROJECT_NAME,
  PROJECT_SCHEMA,
  SharedServicesError,
} from "./resources.mjs"

const postgresClient = (environment, database) =>
  new pg.Client({
    host: environment.GEO_FOUNDRY_PG_HOST,
    port: environment.GEO_FOUNDRY_PG_PORT,
    database,
    user: environment.GEO_FOUNDRY_PG_USER,
    password: environment.GEO_FOUNDRY_PG_PASSWORD,
  })

const redisClient = (environment) =>
  createClient({
    database: environment.GEO_FOUNDRY_REDIS_DATABASE,
    password: environment.GEO_FOUNDRY_REDIS_PASSWORD,
    socket: {
      host: environment.GEO_FOUNDRY_REDIS_HOST,
      port: environment.GEO_FOUNDRY_REDIS_PORT,
    },
    username: environment.GEO_FOUNDRY_REDIS_USERNAME,
  })

export const provisionProjectDatabase = async (environment) => {
  const client = postgresClient(environment, environment.GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE)
  await client.connect()
  try {
    const identity = await client.query("SELECT current_user AS username")
    const database = await client.query(
      "SELECT pg_get_userbyid(datdba) AS username FROM pg_database WHERE datname = $1",
      [PROJECT_DATABASE],
    )
    if (database.rows[0] === undefined) {
      await client.query(`CREATE DATABASE ${PROJECT_DATABASE}`)
      return
    }
    if (database.rows[0].username !== identity.rows[0]?.username) {
      throw new SharedServicesError(
        "SHARED_SERVICE_POSTGRES_FOREIGN_DATABASE",
        "Refusing an existing geo_foundry database not owned by the Geo Foundry account.",
      )
    }
  } finally {
    await client.end()
  }
}

export const verifyPostgres = async (environment, resources) => {
  const client = postgresClient(environment, environment.GEO_FOUNDRY_PG_DATABASE)
  await client.connect()
  try {
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS username",
    )
    const row = identity.rows[0]
    if (row?.database !== PROJECT_DATABASE) {
      throw new SharedServicesError(
        "SHARED_SERVICE_POSTGRES_DATABASE_INVALID",
        "Connect only to the geo_foundry database with its project-scoped account.",
      )
    }
    const vectorAvailability = await client.query(
      "SELECT default_version FROM pg_available_extensions WHERE name = $1",
      ["vector"],
    )
    if (vectorAvailability.rows[0] === undefined) {
      throw new SharedServicesError(
        "SHARED_SERVICE_POSTGRES_PGVECTOR_UNAVAILABLE",
        "The existing shared PostgreSQL service must provide pgvector before Geo Foundry setup can pass.",
      )
    }
    await client.query("CREATE EXTENSION IF NOT EXISTS vector")
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${PROJECT_SCHEMA}`)
    const schemaOwner = await client.query(
      "SELECT pg_get_userbyid(nspowner) AS username FROM pg_namespace WHERE nspname = $1",
      [PROJECT_SCHEMA],
    )
    if (schemaOwner.rows[0]?.username !== row.username) {
      throw new SharedServicesError(
        "SHARED_SERVICE_POSTGRES_FOREIGN_SCHEMA",
        "Use a Geo Foundry account that owns the geo_foundry schema.",
      )
    }
    await client.query(
      `CREATE TABLE ${PROJECT_SCHEMA}.${resources.postgres.table} (embedding vector(3))`,
    )
    const vector = await client.query("SELECT '[1,2,3]'::vector::text AS value")
    return {
      endpoint: `${environment.GEO_FOUNDRY_PG_HOST}:${environment.GEO_FOUNDRY_PG_PORT}`,
      database: PROJECT_DATABASE,
      schema: PROJECT_SCHEMA,
      identity: row.username,
      vector: vector.rows[0]?.value,
      vectorVersion: vectorAvailability.rows[0].default_version,
    }
  } finally {
    await client.end()
  }
}

export const verifyRedis = async (environment, resources) => {
  const client = redisClient(environment)
  await client.connect()
  try {
    if ((await client.ping()) !== "PONG") {
      throw new SharedServicesError(
        "SHARED_SERVICE_REDIS_PING_FAILED",
        "Confirm the Geo Foundry Redis account can issue PING on the configured shared service.",
      )
    }
    const value = `${PROJECT_NAME}:${resources.redis.key}`
    await client.set(resources.redis.key, value)
    if ((await client.get(resources.redis.key)) !== value) {
      throw new SharedServicesError(
        "SHARED_SERVICE_REDIS_NAMESPACE_FAILED",
        "Confirm the Geo Foundry Redis account can read and write its prefixed keys.",
      )
    }
    return {
      endpoint: `${environment.GEO_FOUNDRY_REDIS_HOST}:${environment.GEO_FOUNDRY_REDIS_PORT}`,
      key: resources.redis.key,
      ping: "PONG",
    }
  } finally {
    await client.quit()
  }
}

export const cleanupPostgres = async (environment, manifest) => {
  const client = postgresClient(environment, environment.GEO_FOUNDRY_PG_DATABASE)
  await client.connect()
  try {
    const identity = await client.query("SELECT current_database() AS database")
    if (identity.rows[0]?.database !== PROJECT_DATABASE) {
      throw new SharedServicesError(
        "SHARED_SERVICE_POSTGRES_DATABASE_INVALID",
        "Cleanup may run only in the geo_foundry database.",
      )
    }
    await client.query(
      `DROP TABLE IF EXISTS ${PROJECT_SCHEMA}.${manifest.resources.postgres.table}`,
    )
  } finally {
    await client.end()
  }
}

export const cleanupRedis = async (environment, manifest) => {
  const client = redisClient(environment)
  await client.connect()
  try {
    await client.del(manifest.resources.redis.key)
  } finally {
    await client.quit()
  }
}
