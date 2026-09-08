/*
 * 服务端 Drizzle 实例工厂。
 *
 * 迁移期与 Payload 共存：调用方传 Payload 的连接池（payload.db.drizzle 的
 * 底层）或独立连接串都可以——仓储层只依赖本模块返回的 Drizzle 接口，
 * 不感知连接来源，认证切换时替换为自建池即可。
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import type { Pool } from "pg"

import * as entitySchema from "./entity-schema"
import * as ledgerSchema from "./ledger-schema"
import * as coreSchema from "./schema"

export const serverSchema = { ...coreSchema, ...entitySchema, ...ledgerSchema }

export type ServerDb = NodePgDatabase<typeof serverSchema>

export const createServerDb = (input: string | Pool): ServerDb =>
  typeof input === "string"
    ? drizzle(input, { schema: serverSchema })
    : drizzle({ client: input, schema: serverSchema })
