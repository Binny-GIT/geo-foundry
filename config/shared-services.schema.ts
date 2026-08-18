import { z } from "zod"

const requiredString = z.string().trim().min(1)
const sharedServiceHost = z.union([z.literal("pg-server"), z.literal("127.0.0.1")])
const port = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(65535))
const redisDatabase = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(15))
const falseBoolean = z.literal("false").transform(() => false)
const trueBoolean = z.literal("true").transform(() => true)

const postgresEnvironmentShape = {
  GEO_FOUNDRY_PG_HOST: sharedServiceHost,
  GEO_FOUNDRY_PG_PORT: port,
  GEO_FOUNDRY_PG_BOOTSTRAP_DATABASE: z.literal("postgres"),
  GEO_FOUNDRY_PG_DATABASE: z.literal("geo_foundry"),
  GEO_FOUNDRY_PG_SCHEMA: z.literal("geo_foundry"),
  GEO_FOUNDRY_PG_USER: requiredString,
  GEO_FOUNDRY_PG_PASSWORD: requiredString,
} as const

const redisEnvironmentShape = {
  GEO_FOUNDRY_REDIS_HOST: sharedServiceHost,
  GEO_FOUNDRY_REDIS_PORT: port,
  GEO_FOUNDRY_REDIS_DATABASE: redisDatabase,
  GEO_FOUNDRY_REDIS_USERNAME: requiredString.optional(),
  GEO_FOUNDRY_REDIS_PASSWORD: requiredString,
} as const

const s3EnvironmentShape = {
  GEO_FOUNDRY_S3_ENDPOINT: z.literal("127.0.0.1"),
  GEO_FOUNDRY_S3_PORT: z.literal("9000").transform(Number),
  GEO_FOUNDRY_S3_USE_SSL: falseBoolean,
  GEO_FOUNDRY_S3_ACCESS_KEY: requiredString,
  GEO_FOUNDRY_S3_SECRET_KEY: requiredString,
  GEO_FOUNDRY_S3_FORCE_PATH_STYLE: trueBoolean,
  GEO_FOUNDRY_S3_SECRET_REF: z.literal("rustfs-geo-foundry-svc"),
} as const

const environmentSchema = z.object({
  ...postgresEnvironmentShape,
  ...redisEnvironmentShape,
  ...s3EnvironmentShape,
})

const cmsSharedServicesEnvironmentSchema = z.object({
  ...postgresEnvironmentShape,
  ...s3EnvironmentShape,
})

export type SharedServicesEnvironment = Readonly<z.output<typeof environmentSchema>>
export type CmsSharedServicesEnvironment = Readonly<
  z.output<typeof cmsSharedServicesEnvironmentSchema>
>

export class SharedServicesEnvironmentError extends Error {
  override readonly name = "SharedServicesEnvironmentError"
  readonly variables: readonly string[]

  constructor(variables: readonly string[]) {
    super("SHARED_SERVICE_ENV_MISSING")
    this.variables = variables
  }
}

export const parseSharedServicesEnvironment = (
  environment: Record<string, string | undefined>,
): SharedServicesEnvironment => {
  const parsed = environmentSchema.safeParse(environment)
  if (parsed.success) {
    return parsed.data
  }

  const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].sort()
  throw new SharedServicesEnvironmentError(variables)
}

export const parseCmsSharedServicesEnvironment = (
  environment: Record<string, string | undefined>,
): CmsSharedServicesEnvironment => {
  const parsed = cmsSharedServicesEnvironmentSchema.safeParse(environment)
  if (parsed.success) {
    return parsed.data
  }

  const variables = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].sort()
  throw new SharedServicesEnvironmentError(variables)
}
