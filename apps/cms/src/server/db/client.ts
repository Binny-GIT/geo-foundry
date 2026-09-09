/*
 * 服务端 Drizzle 实例工厂。
 *
 * 服务端 Drizzle 实例可从共享 pg Pool 或独立连接串构造；仓储层只依赖
 * 本模块返回的接口，不感知连接来源。
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import type { Pool } from "pg"

import * as editionSchema from "./edition-schema"
import * as entitySchema from "./entity-schema"
import * as ledgerSchema from "./ledger-schema"
import * as coreSchema from "./schema"
import * as sessionSchema from "./session-schema"
import * as workflowSchema from "./workflow-schema"

export const serverSchema = {
  ...coreSchema,
  ...editionSchema,
  ...entitySchema,
  ...ledgerSchema,
  ...sessionSchema,
  ...workflowSchema,
}

export type ServerDb = NodePgDatabase<typeof serverSchema>

export const createServerDb = (input: string | Pool): ServerDb =>
  typeof input === "string"
    ? drizzle(input, { schema: serverSchema })
    : drizzle({ client: input, schema: serverSchema })
