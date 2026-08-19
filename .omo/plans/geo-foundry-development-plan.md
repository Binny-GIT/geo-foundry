# geo-foundry-development-plan - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 一套从空仓库落地到可验收 MVP 的完整实施蓝图：统一管理两个独立网站的 AI 内容生产、质量门禁、稳定 URL、不可变发布、回滚、SSR 页面和共享 Renderer，并配套可审计的测试与 CI 证据。

**Why this approach:** 先锁定 PageDocument、URL、状态机和发布协议，再建设 CMS、AI、Compiler 与 Renderer，可以避免各模块各自定义接口；Control Plane 与 Serving Plane 严格隔离，确保内容生产系统故障时已发布网站仍可服务。

**What it will NOT do:** 本轮不建设通用页面搭建器、社交/会员/广告/电商能力，也不实现 P1/P2 的自主 Research、Planner、知识图谱、多语言、多 Provider、Vue Renderer、静态导出或 GEO Analytics。生产请求不会调用 CMS、数据库、Redis 或 LLM。

**Effort:** XL
**Risk:** High - 风险主要来自跨租户隔离、至少一次任务语义、不可变发布/CAS 一致性，以及多个公共包的长期兼容契约。
**Decisions to sanity-check:** Node 24 + pnpm/Turborepo 分进程；Payload 3.88.0；单一 OpenAI-compatible Provider；PageDocument 严格字段与 `extensions`；默认相似度/质量阈值；Next.js 与 Express 两个 SSR 示例宿主。

Your next move: 使用 `$start-work geo-foundry-development-plan` 在独立 worker 会话开始执行，或先要求高精度双审。完整执行细节如下。

---

> TL;DR (machine): XL/high-risk greenfield TypeScript platform; 5 implementation waves, 40 implementation todos, 4 final verifiers; delivers Payload multi-site CMS, AI/quality jobs, deterministic compiler, immutable S3-compatible releases, isolated runtime, shared React renderer, and two-site SSR acceptance.

## Scope
### Must have

- A Node.js 24, pnpm 11.22.0, Turborepo 2.10.10, TypeScript 5.9.3, ESM-only monorepo rooted at `apps/*`, `packages/*`, and `examples/*`; root scripts must provide `format`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check`, and `dev`.
- Separate deployable processes: `apps/cms` (Payload 3.88.0), `apps/content-service`, `apps/worker`, `examples/site-a-next`, and `examples/site-b-express`; the two examples consume the same published packages and must not deep-import workspace source.
- P0 domain scope: Site, Domain, Content, ContentEdition, Media, URL Registry, asynchronous Operation, QualityAssessment, Release, ReleasePointer, and audit records. Source/Fact/Claim management UI, autonomous Research, Planner, and Improve APIs remain outside P0.
- Content generation must still be staged rather than topic-to-article: `GenerationBrief -> outline -> draft -> site adaptation -> deterministic evaluation -> semantic evaluation -> LLM evaluation -> optional bounded revision -> review`. P0 receives a fixed operator-supplied research bundle; it does not crawl or research the web.
- Stable APIs: `POST /v1/generate`, `POST /v1/evaluate`, `POST /v1/publish`, `POST /v1/rollback`, and `GET /v1/operations/:operationId`. Every mutating endpoint requires `Idempotency-Key`; a new request returns `202`, an exact replay returns the original `200/202` response, and reuse with a different request fingerprint returns `409 IDEMPOTENCY_KEY_REUSED`.
- A strict `PageDocument` v1 Zod schema with explicit `schemaVersion: 1`, stable block discriminators, namespaced `extensions`, JSON Schema export, fixtures, and package-level public exports. Unknown root or block fields fail validation; unknown data is allowed only inside `extensions` keys matching `^[a-z0-9]+(?:[.-][a-z0-9]+)+/[a-z0-9-]+$`.
- Runtime compatibility policy: initial release accepts v1 only and rejects v0/v2; a migration registry API is shipped now, and any future v2 release is blocked until a pure v1-to-v2 migration plus fixtures exists. Runtime and renderer always consume the latest internal type.
- Page types: `article`, `article-list`, `category`, `tag`, `redirect`, and `not-found`; content blocks: paragraph, heading, image, quote, list, table, FAQ, callout, code, video, embed, and references.
- URL uniqueness on normalized `(siteId, locale, pathname)`; reservation before publish; updates preserve the active URL; a manual slug change creates one-hop `301`; redirect loops, chains longer than one hop, cross-tenant redirects, collisions, and draft sitemap entries are rejected.
- Quality Engine with deterministic, semantic, and LLM dimensions. Defaults: cross-domain similarity `>=0.92` blocks, `0.85-0.919` requires review; same-site title similarity `>=0.90` blocks; overall score must be `>=80`, `quality/seo/geo/siteFit/originality` each `>=75`, and no `high` or `critical` issue may remain. Provider timeout/error fails closed. Thresholds are Site configuration, persisted with each assessment.
- One P0 `LLMProvider` implementation using an OpenAI-compatible HTTP contract configured by `AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL`, and `AI_EMBEDDING_MODEL`; CI uses a deterministic fake provider. Do not add provider selection UI or a multi-provider registry.
- PostgreSQL and Redis must use Mark's existing shared services. Object storage uses the shared `rustfs-server` Docker service at `127.0.0.1:9000`; the project creates only its own database/schema, Redis namespace/prefix, and `geo-foundry/objects/` RustFS prefix through the least-privilege service account. The project must not add/run PostgreSQL/Redis containers or manage the RustFS container lifecycle.
- Immutable S3-compatible artifacts under `sites/<siteId>/releases/<releaseId>/`; all page files are uploaded before `manifest.json`, each object uses conditional create, and a single `sites/<siteId>/channels/current.json` pointer changes with ETag/`If-Match` CAS. Rollback only points to an already verified release; P0 performs no artifact garbage collection.
- Serving Plane isolation: `@geo/runtime` may read only Site routing configuration, the current pointer, immutable artifacts, and its L1 cache. It must not import Payload, PostgreSQL, Redis, BullMQ, compiler, quality, or AI packages and must continue serving published pages when all Control Plane services are stopped.
- `@geo/render-core` and `@geo/render-react` provide semantic output, metadata, JSON-LD, breadcrumbs, lists, redirects, and not-found handling. Themes may override tokens and declared components/slots only; they may not add PageDocument node types or arbitrary layout DSLs.
- A fixed two-site MVP acceptance fixture: `site-a.test` uses a Next.js theme and `site-b.test` uses an Express SSR theme; one shared Content produces two different Editions; one quality run passes and one fails; publishing, updating without URL change, slug redirect, sitemap update, concurrent publish conflict, and single-site rollback are all demonstrated.

#### Data ownership

| Store | Source-of-truth data | Explicitly not authoritative |
| --- | --- | --- |
| Payload/PostgreSQL | tenants/users/roles, Sites/Domains, Content/Editions and versions, URL records, Operations, assessments, release metadata, idempotency records, audit events | BullMQ progress, Worker memory, generated files before a verified release |
| Redis/BullMQ | transient scheduling, attempts, progress, delayed/retry state, flow dependencies | final Edition state, quality decision, release/current pointer |
| RustFS/S3-compatible | immutable PageDocument objects, assets, release manifest, current pointer object | editor workflow, queue status, authorization policy |
| Runtime L1 cache | disposable copies keyed by site/release/path | any persistent or recovery state |

#### State machines

| Aggregate | Allowed transitions | Guardrails |
| --- | --- | --- |
| Operation | `queued -> running -> succeeded/failed/cancelled` | terminal rows never reopen; retry creates a new attempt linked to the same idempotency record |
| ContentEdition | `draft -> generating -> review -> approved -> compiled -> published -> archived`; generation failure returns to `draft`; editing a published version creates a new draft version | only reviewer approves; only publisher publishes; QualityAssessment must pass before `approved -> compiled` |
| QualityAssessment | `pending -> running -> passed/failed/error` | `error` fails closed; stored threshold, prompt version, model ID, provider, input hash, and issue list are immutable |
| Release | `building -> validated -> uploaded -> current -> superseded/rolled_back`; any pre-current stage may become `failed` | only a verified manifest may become current; current pointer CAS conflict never overwrites another release |
| UrlRecord | `reserved -> active -> redirected/gone` | active URL remains stable on content update; redirected/gone records never return to active; redirects are single-hop and same-site |

#### Authorization baseline

| Role | Permissions |
| --- | --- |
| `super-admin` | cross-tenant administration and diagnostics only |
| `tenant-admin` | manage tenant users, Site, Domain, strategy, and thresholds inside one tenant |
| `editor` | create/edit draft Content and Edition, upload tenant media, request generation/evaluation |
| `reviewer` | approve/reject Editions and inspect immutable quality evidence |
| `publisher` | publish, supersede, and rollback verified releases; cannot edit content |
| `content-service` | service identity scoped to one tenant and one Operation; may write generated Edition versions and assessments only |

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No general-purpose page builder, comments, membership, ads, ecommerce, social publishing, marketing automation, ranking analytics, or production-request LLM calls.
- No P1/P2 implementation: no autonomous Research crawler, Content Planner, Source/Fact/Claim management UI, Knowledge Graph, multilingual editions, content decay, IndexNow/CDN purge, static export, Vue renderer, provider marketplace, or advanced analytics.
- No backward-compatibility shims for unpublished draft shapes, no dual ESM/CJS packaging, no runtime deep imports, and no speculative adapter registry beyond the single approved interfaces.
- No shared default tenant, cross-tenant fallback, ID-enumeration access, public draft reads, unauthenticated custom Payload endpoints, or object keys lacking tenant/site prefixes.
- No direct overwrite of release objects, no publish-before-manifest-verification, no pointer update without CAS, no rollback by recompilation, and no deletion/GC of prior releases in P0.
- No tests whose success depends on a live paid LLM, external website, production database, production Redis, or production object store.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for schema, domain transitions, URL rules, compiler determinism, quality aggregation, idempotency, and release protocol; tests-after but task-coupled for Payload/PostgreSQL/Redis/RustFS integration and browser E2E. Frameworks: Vitest 4.1.10, fast-check 4.9.0, Playwright 1.62.1, and `kimi-webbridge` for final real-browser QA. Integration tests use dedicated namespaces on existing shared services, serialized by a project-scoped lock, never Testcontainers or newly created infrastructure containers.
- Evidence: <attemptDir>/task-<N>-geo-foundry-development-plan.<ext> (attemptDir = currentAttemptDir from 'omo ulw-loop status --json', .omo/evidence/ulw/<session>/<goalId>/a<attempt>; outside ulw-loop use .omo/evidence/)

- Every task must run the narrow test first, then affected Turbo tasks. A task cannot claim success from grep, a subagent summary, or a cached log; record the exact command, exit code, and produced evidence artifact.
- Contract evidence: JUnit XML, `coverage-summary.json`, PageDocument fixtures, JSON Schema, URL transition report, two compiler manifests, SHA-256 inventory, and byte diff proving deterministic output.
- Integration evidence: sanitized HTTP fixtures, SQL migration version, tenant access matrix results, BullMQ job timeline, attempts and failure reason, object inventory, manifest verification, publish/rollback receipts, and pointer ETags.
- Browser evidence: raw SSR HTML before hydration, canonical/robots/OpenGraph/JSON-LD assertions, sitemap XML, disabled-JavaScript content check, desktop/mobile screenshots, axe report, network HAR, and Playwright trace on retry/failure.
- Failure injection is mandatory for cross-tenant access, duplicate requests, Worker crash before/after side effects, Redis outage, object upload interruption, manifest corruption, CAS conflict, stale/missing artifact, invalid schema version, quality provider timeout, redirect loop, and Control Plane shutdown.
- Root release gate: `pnpm install --frozen-lockfile && pnpm check && pnpm test:integration && pnpm build && pnpm test:e2e`; CI must run with Turbo remote cache disabled at least once to prove no stale-cache success.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- **Wave 1 - Foundation and contracts (Todos 1-8):** repository governance, workspace, shared-service connectivity/isolation, evidence harness, domain/state contracts, PageDocument, URL, and artifact protocol. Todos 3-8 may proceed in parallel after Todo 1; Todo 2 runs in parallel with contract work.
- **Wave 2 - CMS Control Plane (Todos 9-16):** Payload/PostgreSQL setup, tenancy/roles, Site/Domain, Content/Edition, media, URL lifecycle, workflow/audit, and secured integration endpoints. Collection work parallelizes after the Payload base and tenancy layer.
- **Wave 3 - Content Intelligence and Quality (Todos 17-24):** operation/idempotency ledger, API contracts, provider adapter, generation pipeline, deterministic rules, semantic similarity, LLM evaluator, and resilient Worker orchestration.
- **Wave 4 - Compiler, publisher, and Serving Plane (Todos 25-32):** deterministic compiler, SEO/JSON-LD, page routing/sitemap, artifact build, CAS publisher, rollback, runtime resolver/cache, and Control Plane isolation.
- **Wave 5 - Renderer, examples, packaging, and MVP acceptance (Todos 33-40):** render packages, two themes/framework hosts, package-consumer smoke, seeded two-site scenario, browser/SSR tests, failure-injection suite, and operational documentation.
- **Final wave (F1-F4):** four independent reviewers run in parallel only after all implementation todos pass; all four must approve.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2-40 | - |
| 2 | 1 | 9,17,29-32,38-40 | 3-8 |
| 3 | 1 | 9-24 | 4-8 |
| 4 | 1 | 11-16,18-28,33-40 | 2,3,5-8 |
| 5 | 1 | 14,25-28,30-40 | 2-4,6-8 |
| 6 | 1 | 14,27-32,38-40 | 2-5,7,8 |
| 7 | 1 | all test-bearing todos | 2-6,8 |
| 8 | 1 | 33-37,40 | 2-7 |
| 9 | 2,3 | 10-16 | 17,19-24 |
| 10 | 9 | 11-16,38-40 | 17-24 |
| 11 | 9,10 | 13-16,25-32,38-40 | 12,17-24 |
| 12 | 9,10 | 16,38-40 | 11,13-15,17-24 |
| 13 | 4,9,10 | 15,17-28,38-40 | 11,12,14 |
| 14 | 5,9-11 | 15,16,25-32,38-40 | 12,13 |
| 15 | 9-14 | 16,17-32,38-40 | - |
| 16 | 9-15 | 17-24,38-40 | - |
| 17 | 2,3,13,16 | 18-24,29,38-40 | 19-21 |
| 18 | 4,16,17 | 22-24,38-40 | 19-21 |
| 19 | 4,7,13 | 22,24,38-40 | 17,18,20,21 |
| 20 | 2,4,7,13 | 22,24,38-40 | 17-19,21 |
| 21 | 4,7,13,18 | 22,24,38-40 | 17,19,20 |
| 22 | 18-21 | 23-28,38-40 | - |
| 23 | 17-22 | 24,29,38-40 | - |
| 24 | 17-23 | 25-29,38-40 | - |
| 25 | 4,5,13,14,22,24 | 26-32,38-40 | - |
| 26 | 4,5,25 | 27-32,35-40 | - |
| 27 | 5,6,25,26 | 28-32,38-40 | - |
| 28 | 6,24,27 | 29-32,38-40 | - |
| 29 | 2,6,17,23,28 | 30-32,38-40 | - |
| 30 | 6,28,29 | 31,32,35-40 | - |
| 31 | 4-6,27-30 | 32,35-40 | - |
| 32 | 2,31 | 38-40 | 33,34 |
| 33 | 4,8,25,26 | 34-40 | 32 |
| 34 | 8,33 | 35-40 | 32 |
| 35 | 26,30,31,34 | 37-40 | 36 |
| 36 | 26,30,31,34 | 37-40 | 35 |
| 37 | 8,33-36 | 38-40 | - |
| 38 | 2-37 | 39,40,F1-F4 | - |
| 39 | 2-38 | 40,F1-F4 | - |
| 40 | 1-39 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Bootstrap the governed pnpm/Turborepo monorepo
  What to do / Must NOT do: Create root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.node-version`, `.npmrc`, `.gitignore`, `.env.example`, `Makefile`, `README.md`, and empty `apps/`, `packages/`, `examples/` workspace manifests. Pin Node 24, `packageManager: pnpm@11.22.0`, Turbo 2.10.10, TypeScript 5.9.3, Biome 2.5.8; use `workspace:*`, ESM-only, strict TypeScript, no `any`/suppression directives, and root scripts named in Scope. Ignore `.omo/drafts/`, `.omo/evidence/`, secrets, build outputs, volumes, and local `mydocs/`; keep `.omo/plans/geo-foundry-development-plan.md` tracked as the approved execution contract.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2-40
  References (executor has NO interview context - be exhaustive): `/home/ubuntu/project/Binny-GIT/nkmed/package.json:5-20`; `/home/ubuntu/project/Binny-GIT/nkmed/.github/workflows/ci.yml:22-46`; this plan `Scope`; target roots listed above.
  Acceptance criteria (agent-executable): `corepack enable && pnpm install --frozen-lockfile && pnpm exec turbo run typecheck lint --output-logs=full` exits 0; `node -p "require('./package.json').packageManager"` prints `pnpm@11.22.0`; `rg '"type": "module"' package.json apps packages examples` finds every package manifest; `git status --short` contains no generated dependency/build files.
  QA scenarios (exact tool + invocation): happy: run `make check-toolchain` under Node 24 and save stdout; failure: run the same script with `EXPECTED_NODE_MAJOR=22` and assert non-zero plus `NODE_VERSION_MISMATCH`. Evidence `<attemptDir>/task-1-geo-foundry-development-plan.txt`.
  Commit: Y | `chore(repo): 初始化 pnpm Turborepo 工程基线`

- [x] 2. Configure isolated namespaces on shared PostgreSQL, Redis, and RustFS
  What to do / Must NOT do: Add non-secret environment schema and connectivity/isolation scripts that target the existing shared services only: PostgreSQL `pg-server:5432`, Redis `redis-server:6379`, and S3-compatible RustFS `rustfs-server` at `127.0.0.1:9000` with path-style addressing. Provision only `geo_foundry` database/schema plus pgvector extension, Redis prefix `geo-foundry:<run-id>:`, and pre-authorized `geo-foundry/objects/<run-id>/` RustFS prefix; require a project-scoped test lock and cleanup only that exact prefix. Validate shared-service health and least-privilege access using injected credentials. Probe conditional creates and stale ETag pointer updates; unsupported CAS blocks publisher implementation. Do not add `compose.yaml`, Testcontainers, new PostgreSQL/Redis/object-storage containers, bucket create/delete/tagging calls, fixed ports, destructive server configuration, plaintext credentials, or reuse sibling-project namespaces.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 9,17,29-32,38-40
  References: `/home/ubuntu/project/obsidian-knowledge-base/Operations/Environments/mk-dev.md:31-46`; `/home/ubuntu/project/obsidian-knowledge-base/Infrastructure/Shared Services.md`; `/home/ubuntu/project/obsidian-knowledge-base/Operations/Evidence/260817-RustFS-mk-dev-provisioning.md`; this plan `Data ownership`, `Verification strategy`; target `config/shared-services.schema.ts`, `scripts/shared-services/*.mjs`, `.env.example`.
  Acceptance criteria: with credentials injected only through the existing secret mechanism, `pnpm shared:check` proves pgvector is available in the geo-foundry database/schema, Redis PING and namespace-only read/write works, RustFS path-style prefix create/read/delete works, conditional create returns `200/412`, stale ETag pointer update returns `200/412`, and no service settings are mutated; `pnpm shared:cleanup --run-id <id>` removes only resources returned by the matching run manifest.
  QA scenarios: happy: connectivity report records service identity, namespace/prefix, secret reference IDs, CAS results, and cleanup receipt without secrets; failure: missing service variable, unavailable service, insufficient privilege, foreign prefix, lock collision, conditional-write mismatch, and stale ETag mismatch fail fast with remediation and no cleanup outside the run manifest. Evidence `<attemptDir>/task-2-geo-foundry-development-plan.json`.
  Commit: Y | `chore(infra): 配置共享服务命名空间与连通性校验`

- [x] 3. Define branded identifiers, ownership records, and transition primitives
  What to do / Must NOT do: Create `packages/domain` with branded IDs for Tenant, Site, Domain, Content, Edition, Operation, Assessment, URL, Release, and User; typed errors; clocks/hashes; ownership fields; audit actor; and pure exhaustive transition functions for the five state machines in Scope. Illegal transitions must return typed codes, never throw generic strings or silently coerce.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 9-24
  References: this plan `Data ownership`, `State machines`, `Authorization baseline`; target `packages/domain/src/ids.ts`, `state-machines/*.ts`, `errors.ts`.
  Acceptance criteria: TDD tests cover every allowed edge and every disallowed edge; `pnpm --filter @geo/domain test --coverage` exits 0 with 100% branch coverage on transition modules; `pnpm --filter @geo/domain typecheck` exits 0.
  QA scenarios: happy: transition a draft Edition through published using a fixed clock and audit actor; failure: attempt `draft -> published`, `failed Operation -> running`, and `redirected URL -> active`, asserting stable error codes. Evidence `<attemptDir>/task-3-geo-foundry-development-plan.json`.
  Commit: Y | `feat(domain): 固化核心标识与状态机`

- [x] 4. Implement strict PageDocument v1 and migration registry contracts
  What to do / Must NOT do: Create `packages/schema` with Zod 4.4.3 schemas/types for PageDocument identity, route, metadata, SEO, hero, author, citations, entities, related pages, breadcrumbs, structured data, all required blocks and page types; export JSON Schema and canonical fixtures. Enforce strict objects and namespaced `extensions`; create a pure migration registry that currently supports v1 identity migration and rejects v0/v2 with typed errors. Do not permit arbitrary HTML as the sole body representation or accept unknown block types.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 11-16,18-28,33-40
  References: user PRD PageDocument/Page Types/Content Block sections captured in this plan `Must have`; target `packages/schema/src/page-document/v1/*`, `migrations.ts`, `fixtures/*`.
  Acceptance criteria: property and fixture tests prove valid round-trip serialization; each block has one valid and at least two invalid fixtures; unknown root keys/block keys fail; namespaced extensions survive round-trip; `pnpm --filter @geo/schema test && pnpm --filter @geo/schema build` exits 0 and writes `dist/page-document.schema.json`.
  QA scenarios: happy: parse/serialize all six page types; failure: feed schemaVersion 0/2, malformed heading level, unknown block, and unnamespaced extension, asserting structured path errors. Evidence `<attemptDir>/task-4-geo-foundry-development-plan.json`.
  Commit: Y | `feat(schema): 定义严格 PageDocument v1 契约`

- [x] 5. Specify URL normalization, reservation, and redirect invariants
  What to do / Must NOT do: Create `packages/domain/src/url` for hostname/path/locale normalization, canonical construction, unique key calculation, slug reservation, stable update behavior, manual rename to single-hop redirect, gone handling, sitemap eligibility, and redirect graph validation. Normalize Unicode and percent encoding deterministically; reject query/fragment in pathnames, cross-site targets, chains, loops, and reserved route collisions. Never derive a published URL dynamically from the current title.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 14,25-28,30-40
  References: this plan `Must have` URL rules and `State machines`; target `packages/domain/src/url/*.ts`.
  Acceptance criteria: fast-check properties prove normalization idempotence and uniqueness; table tests cover reserve/publish/update/rename/gone; `pnpm --filter @geo/domain test:url-contract` exits 0, runs the URL test command, builds the public package, and deterministically emits `url-transition-report.json`.
  QA scenarios: happy: run `pnpm --filter @geo/domain test:url-contract` to publish then update a title while preserving URL, rename with one 301, and generate the deterministic public-package report; failure: concurrent collision, `%2F` ambiguity, loop, redirect chain, cross-tenant target, and draft sitemap inclusion all return explicit codes. Evidence `<attemptDir>/task-5-geo-foundry-development-plan.json`.
  Commit: Y | `feat(domain): 定义 URL 注册与重定向规则`

- [x] 6. Define immutable artifact, manifest, pointer, and receipt schemas
  What to do / Must NOT do: Add release contracts under `packages/schema` and `packages/publisher`: canonical manifest with site/release/schema version, source version IDs, sorted object list, bytes, SHA-256, content type, compiler version, and creation time; current pointer with release ID/manifest hash; publish and rollback receipts with prior/new ETag and audit actor. Define `ArtifactStore` methods for conditional create, read, list, head, and CAS pointer update. Do not expose unconditional overwrite/delete methods in P0.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 14,27-32,38-40
  References: this plan `Data ownership`, release state machine, immutable release protocol; target `packages/schema/src/release/*`, `packages/publisher/src/artifact-store.ts`.
  Acceptance criteria: schema fixtures validate and canonical serialization is byte-stable; interface contract forbids overwrite/delete; `pnpm --filter @geo/schema test -- release` and API extraction/type tests pass.
  QA scenarios: happy: canonicalize the same unordered object inventory twice and obtain identical manifest bytes/hash; failure: duplicate path, traversal path, missing hash, altered object, stale ETag, and pointer to unverified release are rejected. Evidence `<attemptDir>/task-6-geo-foundry-development-plan.json`.
  Commit: Y | `feat(schema): 定义不可变发布与回滚契约`

- [x] 7. Build the test, provenance, and evidence harness
  What to do / Must NOT do: Configure Vitest projects, coverage, fast-check seeds, shared-service test namespace/lock setup, Playwright projects, deterministic UTC/locale/random seed helpers, JUnit/JSON reporters, and `scripts/evidence` to write only under the active attempt directory. Define scripts that fail when expected reports are absent or a command was served only from stale Turbo cache. Do not treat snapshots or coverage percentage as the sole assertion.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: every test-bearing todo
  References: this plan `Verification strategy`; `/home/ubuntu/project/Binny-GIT/nkmed/.github/workflows/ci.yml:22-46`; target `vitest.workspace.ts`, `playwright.config.ts`, `packages/testing/*`, `scripts/evidence/*`.
  Acceptance criteria: `pnpm test:harness` creates JUnit, coverage summary, provenance containing Git SHA/Node/pnpm/lockfile hash/timezone/locale/seed, and an intentional failing fixture is reported as failure; missing evidence causes non-zero exit.
  QA scenarios: happy: run one unit, one shared-service integration, and one Playwright smoke with reports; failure: delete a required report and assert `pnpm evidence:verify` fails naming the path. Evidence `<attemptDir>/task-7-geo-foundry-development-plan.json`.
  Commit: Y | `test(repo): 建立可审计测试证据体系`

- [x] 8. Enforce package boundaries, exports, and ESM consumer compatibility
  What to do / Must NOT do: Create workspace package manifests for `@geo/domain`, `@geo/schema`, `@geo/content-client`, `@geo/quality-rules`, `@geo/compiler`, `@geo/publisher`, `@geo/runtime`, `@geo/render-core`, `@geo/render-react`, and `@geo/testing`; use compiled `dist` exports, explicit public subpaths, React peer dependencies, and architecture tests forbidding Serving Plane imports from Control Plane. Add packed-tarball Node ESM consumer tests. Do not support CJS, deep imports, source exports, or React dependencies in schema/runtime.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 33-37,40
  References: this plan `Must have`; target `packages/*/package.json`, `packages/testing/src/architecture/*`, `scripts/package-smoke.mjs`.
  Acceptance criteria: `pnpm packages:validate && pnpm packages:pack-smoke` exits 0; dependency graph proves `runtime -> schema` only and `render-react -> render-core/schema/react`; a temp consumer installs tarballs and imports only declared exports.
  QA scenarios: happy: ESM temp consumer parses a fixture and renders one page; failure: fixture branch introduces `@geo/compiler` import into runtime and a deep import into consumer, both rejected. Evidence `<attemptDir>/task-8-geo-foundry-development-plan.txt`.
  Commit: Y | `chore(packages): 固化公共包边界与 ESM 导出`

- [x] 9. Initialize Payload CMS with reviewed PostgreSQL migrations
  What to do / Must NOT do: Create `apps/cms` using exact matching versions `payload`, `@payloadcms/db-postgres`, `@payloadcms/plugin-multi-tenant`, `@payloadcms/storage-s3`, and `@payloadcms/next` at 3.88.0. Configure the approved shared PostgreSQL database/schema and shared RustFS path-style endpoint/prefix, Lexical blocks compatible with PageDocument, migration generation/deploy scripts, health/readiness endpoints, and media adapter. Development may generate migrations, but CI/production must use checked-in migration files once Mark authorizes the repository's initial commit and never `db push`; until then migration provenance must use the task evidence manifest and source hash, not a fabricated Git commit claim. Do not use experimental schema-per-tenant features or a per-project object-storage container.
  Parallelization: Wave 2 | Blocked by: 2,3 | Blocks: 10-16
  References: Payload constraints recorded in draft `/home/ubuntu/project/Binny-GIT/geo-foundry/.omo/drafts/geo-foundry-development-plan.md`; this plan `Data ownership`; target `apps/cms/src/payload.config.ts`, `src/migrations/*`, `src/app/api/health/*`.
  Acceptance criteria: `pnpm --filter @geo/cms db:migrate && pnpm --filter @geo/cms test:integration` creates a fresh database, applies migrations twice idempotently, boots CMS, and returns ready only after DB/object storage checks; dependency versions are exact and identical.
  QA scenarios: happy: empty DB migrate/boot/readiness; failure: missing migration, mismatched Payload adapter patch, unavailable DB, and unavailable RustFS each produce non-zero readiness with typed dependency status. Evidence `<attemptDir>/task-9-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 初始化 Payload 与 PostgreSQL 迁移基线`

- [x] 10. Implement tenant identity, roles, and deny-by-default access controls
  What to do / Must NOT do: Add Tenants and Users collections, roles from the authorization baseline, tenant memberships, authenticated session/claims resolution, reusable collection/field access functions, service-account authentication, and audit actor extraction. Super-admin is the only cross-tenant role; every other query and mutation must include tenant scope server-side. Do not rely on admin UI filtering, client-supplied tenant IDs, or a default tenant.
  Parallelization: Wave 2 | Blocked by: 9 | Blocks: 11-16,38-40
  References: this plan `Authorization baseline`; target `apps/cms/src/collections/Tenants.ts`, `Users.ts`, `access/*`, `auth/*`.
  Acceptance criteria: a generated role/access matrix test exercises every role against every collection action; anonymous draft access is denied; authenticated requests cannot change tenant by body/query; `pnpm --filter @geo/cms test:integration -- tenant-access` exits 0.
  QA scenarios: happy: editor reads/updates own-tenant draft and publisher publishes own tenant; failure: ID enumeration, forged tenant field, cross-tenant media/version access, reviewer publish, and publisher edit all return 403 without existence leakage. Evidence `<attemptDir>/task-10-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 建立租户身份与角色授权矩阵`

- [x] 11. Model Site and Domain configuration with deterministic host resolution
  What to do / Must NOT do: Add Site and Domain collections with locale, timezone, status, Content Strategy, quality thresholds, publishing configuration, SEO defaults, canonical domain, aliases, and uniqueness. Domain normalization must use the shared URL package; one Domain belongs to one Site and tenant. Persist only validated settings and reject conflicting active domains. Do not embed deployment credentials or provider secrets in Site documents.
  Parallelization: Wave 2 | Blocked by: 9,10 | Blocks: 13-16,25-32,38-40
  References: this plan `Must have`, Site strategy and quality defaults; target `apps/cms/src/collections/Sites.ts`, `Domains.ts`, `packages/domain/src/site/*`.
  Acceptance criteria: migration creates indexed tenant/site/domain keys; integration tests create two sites with aliases and resolve host deterministically; duplicate normalized domain and invalid locale/timezone are rejected; exported sanitized Site config contains no secret fields.
  QA scenarios: happy: resolve `www.site-a.test` to Site A canonical host; failure: mixed-case duplicate, trailing-dot duplicate, cross-tenant reuse, unknown host, and disabled Site produce stable errors. Evidence `<attemptDir>/task-11-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 建立站点与域名配置模型`

- [x] 12. Model P0 Content and versioned Site Editions
  What to do / Must NOT do: Add Content and ContentEdition collections with shared topic/intent, tenant, Site, angle, title, summary, structured body, primary/secondary topics, optional citations/entities, creation origin, status, version links, and Payload drafts/versions. A Content may have one active Edition per Site/version lineage; editing published content creates a new draft version. Keep Source/Fact/Claim management and autonomous research outside P0; represent the operator-supplied research bundle only as immutable Operation input evidence.
  Parallelization: Wave 2 | Blocked by: 9,10 | Blocks: 16,18-28,38-40
  References: this plan `Must have` generation scope and Edition state machine; target `apps/cms/src/collections/Contents.ts`, `ContentEditions.ts`, shared block adapters.
  Acceptance criteria: integration tests create one Content with two differently angled Editions, verify version history and tenant scope, and prove published edits produce a new draft without changing the published record or URL; anonymous read returns no drafts.
  QA scenarios: happy: Site A technical angle and Site B operations angle coexist; failure: second active Edition for same Site/version lineage, direct published-row mutation, cross-tenant Content relation, and body failing shared block schema are rejected. Evidence `<attemptDir>/task-12-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 建立内容与站点版本模型`

- [x] 13. Secure tenant media and S3-compatible object paths
  What to do / Must NOT do: Add Media collection, image metadata/alt/caption, object storage adapter, tenant/site-prefixed keys, file type/size policy, private original versus published derivative policy, and signed/admin access. Compiler-visible media metadata must be immutable by release version. Do not expose raw private object URLs or permit a tenant to reference another tenant's media ID/key.
  Parallelization: Wave 2 | Blocked by: 4,9,10 | Blocks: 15,17-28,38-40
  References: this plan tenant isolation and artifact key rules; target `apps/cms/src/collections/Media.ts`, `src/storage/*`, `packages/schema/src/media/*`.
  Acceptance criteria: upload/read/delete tests run against RustFS; tenant prefix and access policy are asserted from object inventory; published derivative metadata parses through PageDocument; unsupported type/oversize/missing alt policy produces structured validation failure.
  QA scenarios: happy: editor uploads own-tenant image and compiler resolves a release-safe derivative; failure: cross-tenant ID/key, unsigned private access, path traversal filename, and deleted source referenced by a draft are denied. Evidence `<attemptDir>/task-13-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 增加租户隔离媒体存储`

- [x] 14. Persist URL Registry and enforce lifecycle transactions
  What to do / Must NOT do: Add UrlRecords collection/table and a transaction-bound service that reserves normalized `(siteId, locale, pathname)`, activates on publish, preserves active URLs on update, creates one-hop redirect on approved slug change, and marks gone. Add database uniqueness/indexes and audit fields. Do not call `slugify(title)` during runtime or bypass reservation in publish flows.
  Parallelization: Wave 2 | Blocked by: 5,9-11 | Blocks: 15,16,25-32,38-40
  References: `packages/domain/src/url/*` from Todo 5; this plan URL state machine; target `apps/cms/src/collections/UrlRecords.ts`, `src/services/url-registry.ts`.
  Acceptance criteria: shared PostgreSQL integration runs concurrent reservations in a project-owned test namespace and proves one winner; update retains URL; approved rename creates one redirect and new active record in one transaction; sitemap query returns active eligible records only.
  QA scenarios: happy: reserve/activate/update/rename/gone; failure: duplicate concurrent reserve, redirect loop/chain, cross-site target, invalid locale/path, and transaction interruption leave no partial active state. Evidence `<attemptDir>/task-14-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 持久化 URL 注册生命周期`

- [x] 15. Enforce editorial, quality, compile, and publish workflow guards
  What to do / Must NOT do: Implement Edition transition service, reviewer/publisher role checks, immutable assessment references, quality threshold snapshot, compile/publish preconditions, version supersession, and audit events. The CMS may record publish intent but must not perform compiler/AI work in request hooks. Manual quality override is not part of P0; any provider error or blocking issue prevents approval/publish.
  Parallelization: Wave 2 | Blocked by: 9-14 | Blocks: 16,17-32,38-40
  References: this plan Edition/Assessment/Release state machines and role matrix; target `apps/cms/src/services/edition-workflow.ts`, `audit/*`, collection hooks limited to validation/event enqueue.
  Acceptance criteria: state-transition integration tests prove only allowed roles/transitions; approved status requires a passed immutable assessment matching the current Edition input hash; publish intent requires compiled artifact metadata; audit log records actor, tenant, before/after, reason, timestamp.
  QA scenarios: happy: editor -> evaluator -> reviewer -> publisher flow; failure: stale assessment, changed body after assessment, provider error, critical issue, unauthorized actor, and direct status field mutation fail closed. Evidence `<attemptDir>/task-15-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 固化内容审核与发布门禁`

- [x] 16. Expose zero-trust CMS integration endpoints and event outbox
  What to do / Must NOT do: Create authenticated internal endpoints/SDK calls for reading immutable Edition input, writing generated draft versions/assessments, recording compile results, and requesting publish; validate Zod bodies, tenant/service scope, CORS, rate/size limits, and request IDs. Add PostgreSQL outbox rows in the same transaction as workflow changes, with a dispatcher that safely creates BullMQ jobs. Do not let workers write the Payload database directly or trust unsigned webhooks.
  Parallelization: Wave 2 | Blocked by: 9-15 | Blocks: 17-24,38-40
  References: this plan data ownership/idempotency/API requirements; target `apps/cms/src/endpoints/internal/*`, `src/outbox/*`, `packages/content-client/*`.
  Acceptance criteria: contract tests generate OpenAPI/typed client fixtures; DB change and outbox insert are atomic; duplicate dispatch uses stable jobId; endpoint access requires service identity tied to tenant/operation; sanitized response contains no internal secrets.
  QA scenarios: happy: create draft -> outbox -> one job -> service writes one version; failure: unsigned call, wrong tenant/operation, malformed body, duplicate event, dispatcher crash before/after enqueue, and Redis outage preserve recoverable outbox state. Evidence `<attemptDir>/task-16-geo-foundry-development-plan.json`.
  Commit: Y | `feat(cms): 提供安全集成接口与事务 Outbox`

- [x] 17. Persist asynchronous Operations and idempotency contracts
  What to do / Must NOT do: Add Operation and IdempotencyRecord persistence owned by PostgreSQL, including tenant, endpoint, key, canonical request hash, operation type, target IDs, state, current attempt, result/error envelope, provider/prompt/model versions, timestamps, and audit correlation. Enforce unique `(tenantId, endpoint, idempotencyKey)` and stable replay semantics; BullMQ jobId must derive from Operation ID and stage. Queue state must never be the only recovery source.
  Parallelization: Wave 3 | Blocked by: 2,3,13,16 | Blocks: 18-24,29,38-40
  References: this plan API/idempotency requirements and Operation state machine; target `apps/content-service/src/operations/*`, CMS migration/collection for Operations and IdempotencyRecords.
  Acceptance criteria: TDD plus PostgreSQL integration proves `202` creation, same-body replay returns same operation/result, different-body reuse returns 409, terminal state immutability, and recovery query can enumerate non-terminal operations after Redis loss.
  QA scenarios: happy: submit/replay one generate request; failure: concurrent identical inserts, same key/different body, stale attempt completion, cancelled operation completion, and Redis reset preserve one logical operation. Evidence `<attemptDir>/task-17-geo-foundry-development-plan.json`.
  Commit: Y | `feat(content): 建立操作与幂等事实账本`

- [x] 18. Implement the single OpenAI-compatible provider and deterministic fake
  What to do / Must NOT do: Create `apps/content-service/src/providers` with one narrow `LLMProvider` interface for structured chat generation and embeddings; implement an OpenAI-compatible HTTP adapter using `AI_BASE_URL`, `AI_API_KEY`, `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL`, bounded timeout, response-size limit, retry classification, request correlation, and no secret logging. Add a deterministic fake provider with versioned fixtures for CI. Do not add provider selection UI, fallback chains, or automatic retry after an unknown billable submission result.
  Parallelization: Wave 3 | Blocked by: 4,16,17 | Blocks: 21-24,38-40
  References: this plan single-provider guardrail and deterministic CI requirement; target `apps/content-service/src/providers/types.ts`, `openai-compatible.ts`, `fake.ts`.
  Acceptance criteria: contract tests run the same suite against fake and a local mock HTTP server; structured output parses through Zod; timeout/rate-limit/5xx/malformed/oversize responses map to typed retryable or terminal errors; logs contain request IDs but no key/content body.
  QA scenarios: happy: fake returns stable outline/draft/evaluation/embedding; failure: timeout, 429 with Retry-After, 500, invalid JSON, wrong vector dimension, and connection drop after submission produce defined classifications. Evidence `<attemptDir>/task-18-geo-foundry-development-plan.json`.
  Commit: Y | `feat(ai): 添加单一兼容 Provider 与确定性测试替身`

- [x] 19. Implement deterministic SEO/GEO and structural quality rules
  What to do / Must NOT do: Create `packages/quality-rules` pure rules for title/description, heading hierarchy, empty/malformed blocks, image alt, URL/canonical validity, publication/modified dates, link format, JSON-LD schema shape, content length, duplicate headings, slug collision input, sitemap eligibility, and citation completeness only when citations are present. Rules emit stable issue type/severity/location/message/recommendation and never call network/LLM.
  Parallelization: Wave 3 | Blocked by: 4,7,13 | Blocks: 22,24,38-40
  References: user PRD deterministic rules encoded in this plan; `packages/schema` contracts; target `packages/quality-rules/src/deterministic/*`.
  Acceptance criteria: table and property tests cover each rule's pass/fail/boundary cases; issue ordering and serialization are deterministic; `pnpm --filter @geo/quality-rules test --coverage` reaches 100% branches in rule dispatch and severity aggregation.
  QA scenarios: happy: valid article fixture yields no blocking issues; failure: missing canonical/title/alt, skipped heading level, broken internal link, invalid date order, malformed block, and ineligible sitemap each produce exact issue code/location. Evidence `<attemptDir>/task-19-geo-foundry-development-plan.json`.
  Commit: Y | `feat(quality): 实现确定性内容质量规则`

- [x] 20. Implement semantic similarity and Site-fit checks with pgvector
  What to do / Must NOT do: Add embedding persistence keyed by tenant/site/Edition version/model/dimension/input hash, pgvector indexes, cosine similarity queries, and pure threshold decisions. Compare within-site titles/content and cross-domain Editions; persist top matches and thresholds used. Default review/block thresholds are in Scope. Use the approved provider interface; CI uses fixed vectors. Do not create autonomous topic graphs, Knowledge Graph, or external vector database.
  Parallelization: Wave 3 | Blocked by: 2,4,7,13 | Blocks: 22,24,38-40
  References: this plan quality defaults and P0 cross-domain acceptance; target `packages/quality-rules/src/semantic/*`, `apps/content-service/src/embeddings/*`, PostgreSQL migration with vector dimension.
  Acceptance criteria: integration tests seed Site A/B vectors and assert exact nearest matches, tenant filters, review/block boundaries at 0.85/0.92 and same-site 0.90, and cache invalidation on input/model change; query plan uses the intended index above fixture scale threshold.
  QA scenarios: happy: distinct Editions pass and near-duplicate is review-required; failure: 0.92+ cross-domain duplicate blocks, wrong dimension, missing embedding, model-version mismatch, and cross-tenant candidate leakage fail safely. Evidence `<attemptDir>/task-20-geo-foundry-development-plan.json`.
  Commit: Y | `feat(quality): 增加语义重复与站点适配检查`

- [x] 21. Implement versioned LLM quality evaluation with fail-closed behavior
  What to do / Must NOT do: Define a versioned evaluation prompt/input/output schema for quality, originality, SEO, GEO, siteFit, unsupported claims, structure, audience fit, logic, risk, issues, and recommendations. Persist prompt version, provider/model, input hash, raw-response hash, parsed output, latency, and error classification. Provider timeout, malformed output, or unsupported claim risk must yield Assessment `error/failed`, never an optimistic score. CI must use the fake provider only.
  Parallelization: Wave 3 | Blocked by: 4,7,13,18 | Blocks: 22,24,38-40
  References: this plan quality gate and assessment immutability; target `packages/quality-rules/src/llm/*`, `apps/content-service/src/evaluation/*`.
  Acceptance criteria: golden fixtures validate prompt/output versioning and deterministic parsing; scores outside 0-100, missing dimensions, unknown severities, and unsupported schema versions fail; logs/evidence redact article body where configured while retaining hashes.
  QA scenarios: happy: fixed evaluation yields expected dimensions/issues; failure: timeout, malformed JSON, prompt-version mismatch, unsupported claim marked critical, and provider partial response all fail closed and block approval. Evidence `<attemptDir>/task-21-geo-foundry-development-plan.json`.
  Commit: Y | `feat(quality): 添加版本化 LLM 评估门禁`

- [x] 22. Aggregate deterministic, semantic, and LLM assessments into one gate
  What to do / Must NOT do: Build a pure aggregator that consumes all three layer results, applies the persisted Site threshold snapshot, calculates the PRD response shape, sorts issues deterministically, and returns `passed`, `review-required`, or `blocked`. Any missing required layer or `error` is blocked. Store the immutable aggregate against the exact Edition input hash; do not permit manual P0 overrides.
  Parallelization: Wave 3 | Blocked by: 18-21 | Blocks: 23-28,38-40
  References: this plan quality thresholds and workflow guards; target `packages/quality-rules/src/aggregate.ts`, shared assessment schema.
  Acceptance criteria: TDD covers every threshold boundary, severity precedence, missing layer, stale input hash, and deterministic output; `/evaluate` fixture matches `{overall, dimensions, issues, recommendations}` and includes gate decision/evidence IDs.
  QA scenarios: happy: all dimensions above threshold with no high issue passes; failure: overall 79, one dimension 74, high issue, semantic block, provider error, stale Edition hash, or absent layer blocks with stable reason. Evidence `<attemptDir>/task-22-geo-foundry-development-plan.json`.
  Commit: Y | `feat(quality): 汇总三层评估并输出发布判定`

- [x] 23. Expose generate/evaluate APIs and staged generation orchestration
  What to do / Must NOT do: Create `apps/content-service` HTTP API with `POST /v1/generate`, `POST /v1/evaluate`, `GET /v1/operations/:id`, OpenAPI, auth/service scopes, request limits, idempotency, and canonical request hashing. `generate` requires Content/Edition IDs, Site strategy snapshot, and an operator-supplied `GenerationBrief` containing topic, intent, approved source snippets/facts, and constraints; orchestrate outline, draft, Site adaptation, evaluation, one bounded revision, then review. Do not implement web research, `/plan`, `/research`, `/improve`, or synchronous long-running requests.
  Parallelization: Wave 3 | Blocked by: 17-22 | Blocks: 24,29,38-40
  References: this plan API contract, generation boundary, idempotency rules; target `apps/content-service/src/http/*`, `src/pipelines/generate.ts`, `packages/content-client/*`.
  Acceptance criteria: API contract tests assert status codes/headers/stable fields; new requests return 202 with operation URL, exact replay returns same operation, mismatched replay returns 409; generation cannot proceed without research bundle and records each stage/input/output hash.
  QA scenarios: happy: fixed bundle generates two angle-specific drafts and evaluation operation; failure: missing sources, invalid Site strategy, unauthorized tenant, oversized prompt, duplicate key mismatch, failed gate after one revision, and cancelled operation return defined results. Evidence `<attemptDir>/task-23-geo-foundry-development-plan.json`.
  Commit: Y | `feat(content): 提供分阶段生成与评估 API`

- [x] 24. Build resilient BullMQ flows and Worker recovery
  What to do / Must NOT do: Create `apps/worker` with BullMQ 6.1.2 queues/flows for generation, embedding, evaluation, compile trigger, and publish trigger; stable job IDs, attempts/backoff, concurrency by workload, progress events, graceful SIGTERM, outbox consumption, stalled/recovery reconciliation, and structured telemetry. External side effects must be idempotent around crashes. Do not infer completion from progress or automatically switch provider after an unknown paid submission.
  Parallelization: Wave 3 | Blocked by: 17-23 | Blocks: 25-29,38-40
  References: this plan Redis/BullMQ ownership and failure injection requirements; `/home/ubuntu/project/Binny-GIT/kling-eu/package.json:9-17,28-29`; target `apps/worker/src/queues/*`, `processors/*`, `reconcile/*`.
  Acceptance criteria: shared-service integration proves parent waits for children, failed child blocks downstream publish, retries preserve one logical result, SIGTERM drains, and reconciliation restores non-terminal Operations after Redis namespace cleanup; verify connection-level behavior only and do not inspect or mutate shared Redis global AOF/noeviction configuration.
  QA scenarios: happy: complete staged Flow with persisted timeline; failure: crash before side effect, crash after side effect/before acknowledgment, Redis disconnect, stalled CPU task, poison job, duplicate enqueue, and optional/critical child failure all converge to defined state. Evidence `<attemptDir>/task-24-geo-foundry-development-plan.jsonl`.
  Commit: Y | `feat(worker): 实现可恢复的内容任务编排`

- [x] 25. Implement a deterministic GEO Compiler for all P0 page types
  What to do / Must NOT do: Create `packages/compiler` pure compilation pipeline from immutable CMS Edition/Site/URL/media/assessment snapshots to PageDocument v1. Compile article, article-list, category, tag, redirect, and not-found documents; stable ordering, pagination, breadcrumbs, author/date, citations/entities if present, and release-scoped related links only when explicitly supplied. Inject clock/compiler version; never read current time, random values, network, CMS, or database inside pure compile functions.
  Parallelization: Wave 4 | Blocked by: 4,5,13,14,22,24 | Blocks: 26-32,38-40
  References: `packages/schema` and domain URL contracts; this plan P0 page types and deterministic evidence; target `packages/compiler/src/compile/*`.
  Acceptance criteria: each page type has golden fixtures; compiling identical shuffled inputs twice under UTC yields byte-identical canonical JSON and hash; unsupported schema/block/status fails typed; `pnpm --filter @geo/compiler test:determinism` writes two manifests and an empty diff.
  QA scenarios: happy: compile two Site Editions and list/category/tag pages; failure: draft Edition, failed assessment, missing active URL/media, unstable ordering, unsupported block, and timezone-dependent input are rejected. Evidence `<attemptDir>/task-25-geo-foundry-development-plan/`.
  Commit: Y | `feat(compiler): 实现确定性 PageDocument 编译器`

- [x] 26. Generate canonical metadata, robots, OpenGraph, and Schema.org data
  What to do / Must NOT do: Add compiler modules deriving absolute canonical URLs from Site canonical domain plus active UrlRecord; title/description, robots, OpenGraph/Twitter, published/modified dates, and valid Schema.org `Article|NewsArticle`, `Organization`, `Person`, `ImageObject`, and `BreadcrumbList`. Structured data must be deterministic, deduplicated, and consistent with visible content. Sites must not reimplement base SEO/GEO rules.
  Parallelization: Wave 4 | Blocked by: 4,5,25 | Blocks: 27-32,35-40
  References: this plan SEO/GEO output requirements; target `packages/compiler/src/seo/*`, `structured-data/*`.
  Acceptance criteria: schema fixtures validate JSON-LD shapes and absolute URLs; article HTML metadata values equal PageDocument values; modifiedAt cannot precede publishedAt; redirect/not-found receive correct robots/canonical behavior.
  QA scenarios: happy: Article and NewsArticle fixtures emit valid linked graph; failure: wrong-domain canonical, duplicate JSON-LD IDs, missing author/org/image fields when required, invalid date order, draft indexability, and redirect canonical mismatch fail compile. Evidence `<attemptDir>/task-26-geo-foundry-development-plan.json`.
  Commit: Y | `feat(compiler): 统一生成 SEO 与结构化数据`

- [x] 27. Compile route indexes, pagination, redirects, and sitemap artifacts
  What to do / Must NOT do: Build per-Site route index mapping normalized paths to PageDocument object keys/status, deterministic article-list/category/tag pagination, single-hop redirect entries, not-found metadata, and sitemap XML from active eligible URLs. Build an immutable global routing manifest mapping normalized host aliases to Site IDs and canonical hosts, ready for CAS publication. Do not include drafts, gone URLs, redirect targets as duplicate active entries, unknown hosts, or cross-site references.
  Parallelization: Wave 4 | Blocked by: 5,6,25,26 | Blocks: 28-32,38-40
  References: URL Registry from Todos 5/14; release schema Todo 6; target `packages/compiler/src/routes/*`, `sitemap/*`, `routing-manifest/*`.
  Acceptance criteria: deterministic tests assert page boundaries, route uniqueness, XML ordering/escaping, canonical host, lastmod values, and host alias mapping; generated sitemap URLs all resolve in the same route index and no draft/redirect/gone entry is included.
  QA scenarios: happy: compile two sites with separate lists/categories/tags/sitemaps; failure: path collision, pagination gap, redirect loop, unknown Site/domain, malformed XML character, and cross-site sitemap leak block release validation. Evidence `<attemptDir>/task-27-geo-foundry-development-plan/`.
  Commit: Y | `feat(compiler): 生成路由索引与站点地图`

- [x] 28. Build and verify complete immutable release directories
  What to do / Must NOT do: Implement artifact builder that writes canonical PageDocument JSON, route index, sitemap, media references, routing candidate, checksums, then `manifest.json` last into a staging directory. Verify path safety, object count, size, content type, SHA-256, source/assessment/URL versions, and schema/compiler compatibility before marking Release `validated`. Do not upload or switch pointers from incomplete/unverified staging output.
  Parallelization: Wave 4 | Blocked by: 6,24,27 | Blocks: 29-32,38-40
  References: release contracts Todo 6, compiler outputs Todos 25-27; target `packages/publisher/src/build-release.ts`, `verify-release.ts`.
  Acceptance criteria: `pnpm --filter @geo/publisher test -- release-build` creates two identical release directories from fixed input, verifies every object/hash, and outputs `artifact-manifest.json` plus `object-inventory.json`; tampering any byte fails verification.
  QA scenarios: happy: build/verify Site A and B releases; failure: missing object, extra unlisted object, traversal path, wrong hash/size/content type, unsupported schema/compiler version, and interrupted build never transition beyond `building/failed`. Evidence `<attemptDir>/task-28-geo-foundry-development-plan/`.
  Commit: Y | `feat(publisher): 构建并校验不可变发布产物`

- [ ] 29. Publish releases and routing manifests with conditional writes and CAS
  What to do / Must NOT do: Implement RustFS/S3 `ArtifactStore`, upload all immutable release objects with `If-None-Match:*`, verify remote HEAD/hash metadata, upload manifest last, then update Site `channels/current.json` using ETag/`If-Match`. Publish global routing manifest under `routing/releases/<id>/domains.json` and CAS its pointer only after all referenced Site pointers/releases exist. Persist Release metadata and publish receipt before returning success. Do not blind-overwrite, treat queue completion as publication, or switch routing before Site release.
  Parallelization: Wave 4 | Blocked by: 2,6,17,23,28 | Blocks: 30-32,38-40
  References: this plan immutable protocol and API idempotency; target `packages/publisher/src/s3-artifact-store.ts`, `publish.ts`, `routing-publish.ts`, Worker publish processor, `POST /v1/publish`.
  Acceptance criteria: integration tests against RustFS prove conditional create, remote verification, one CAS winner for concurrent releases, stable exact replay, receipt fields/ETags, and DB Release state consistency; publish endpoint follows 202/replay/409 contract.
  QA scenarios: happy: publish Site A v1 and routing manifest; failure: upload interruption, pre-existing object with different hash, manifest upload failure, stale ETag, concurrent v2/v3, DB receipt failure, and routing CAS conflict leave old pointer serving complete release. Evidence `<attemptDir>/task-29-geo-foundry-development-plan/`.
  Commit: Y | `feat(publisher): 实现条件写与原子发布切换`

- [ ] 30. Implement audited rollback to a verified prior release
  What to do / Must NOT do: Add rollback service/API/job that verifies target release manifest and objects, confirms same Site/tenant and schema compatibility, reads current pointer/ETag, CAS-switches to target, marks release states/audit receipt, and refreshes routing only if needed. Rollback does not compile, regenerate, overwrite, delete, or mutate target artifacts.
  Parallelization: Wave 4 | Blocked by: 6,28,29 | Blocks: 31,32,35-40
  References: release state machine and receipt schema; target `packages/publisher/src/rollback.ts`, Worker processor, `POST /v1/rollback`.
  Acceptance criteria: integration publishes v1/v2, rolls back to v1, verifies pointer/receipt/state/audit and byte-identical v1 artifact; exact idempotent replay returns same rollback Operation; unauthorized or incompatible target is rejected.
  QA scenarios: happy: rollback Site A while Site B remains on current; failure: missing/tampered target, stale ETag, concurrent publish/rollback, cross-site target, already-current target, and DB failure after CAS invoke deterministic reconciliation without recompilation. Evidence `<attemptDir>/task-30-geo-foundry-development-plan/`.
  Commit: Y | `feat(publisher): 支持可审计原子回滚`

- [ ] 31. Implement the lightweight host/path Runtime and L1 cache
  What to do / Must NOT do: Create `@geo/runtime` that loads the global routing pointer/manifest, resolves hostname to Site, loads Site current pointer, route index, and PageDocument from S3-compatible storage, validates schema/hash, handles active/redirect/gone/not-found, and maintains bounded TTL L1 caches keyed by routing release, Site release, and path. Expose `geo.resolve({hostname, pathname})`; include cache invalidation on pointer ETag change. Do not import or connect to CMS/PostgreSQL/Redis/BullMQ/AI/compiler/quality.
  Parallelization: Wave 4 | Blocked by: 4-6,27-30 | Blocks: 32,35-40
  References: package boundary Todo 8, release/routing contracts Todos 6/27/29; target `packages/runtime/src/*`.
  Acceptance criteria: contract/integration matrix resolves aliases, article/list/category/tag, redirect, gone, unknown host, and not-found; validates manifest/object hashes; cache hit/miss/invalidation and bounded eviction are deterministic; architecture test proves forbidden dependencies absent.
  QA scenarios: happy: resolve both sites across pointer update; failure: missing pointer/manifest/object, hash mismatch, unsupported schema, stale cached 404, unknown host, alias mismatch, and object-store timeout produce defined safe response/error without tenant fallback. Evidence `<attemptDir>/task-31-geo-foundry-development-plan.json`.
  Commit: Y | `feat(runtime): 实现独立站点路由与产物解析`

- [ ] 32. Prove Serving Plane independence under Control Plane failure
  What to do / Must NOT do: Add an integration fault harness that publishes both Site releases, warms/clears Runtime caches, then stops CMS, PostgreSQL, Redis, Worker, and fake LLM while keeping RustFS/runtime hosts up. Enforce egress/dependency allowlist and connection-attempt logging. Runtime may contact only object storage and local cache; do not mask forbidden calls with mocks or preloaded in-memory page objects.
  Parallelization: Wave 4 | Blocked by: 2,31 | Blocks: 38-40
  References: this plan Serving Plane isolation and failure injection; target `tests/integration/serving-plane-isolation.test.ts`, process/network policy scripts.
  Acceptance criteria: with project Control Plane processes stopped, uncached published article/list/sitemap requests for both sites return 200 and correct release IDs; redirect/404 still work; captured network/log report contains zero DNS/socket attempts to CMS/PG/Redis/LLM.
  QA scenarios: happy: cold Runtime reads only shared RustFS and serves both sites; failure: deny the Runtime's RustFS credentials/network path in its isolated test process and assert bounded 503/cache behavior, then restore access and recover without restarting Control Plane. Evidence `<attemptDir>/task-32-geo-foundry-development-plan/`.
  Commit: Y | `test(runtime): 验证控制面故障下持续服务`

- [ ] 33. Implement semantic framework-neutral render-core
  What to do / Must NOT do: Create `@geo/render-core` with typed render model helpers, block/slot registry contracts, heading hierarchy, breadcrumbs, author/date, figure/caption, references, FAQ, related list, pagination, category/tag lists, redirect/not-found models, metadata and JSON-LD pass-through. Keep it platform/React/DOM independent and require exhaustive handling of every PageDocument page/block discriminator. Themes cannot add schema node types.
  Parallelization: Wave 5 | Blocked by: 4,8,25,26 | Blocks: 34-40
  References: PageDocument Todo 4, compiler outputs Todos 25/26, package boundaries Todo 8; target `packages/render-core/src/*`.
  Acceptance criteria: exhaustive type/fixture tests cover all page and block variants; no React/DOM dependency appears; invalid heading nesting or missing required semantic field returns typed render error; package build/API extraction passes.
  QA scenarios: happy: transform each PageDocument fixture to stable render model; failure: unknown block/page type, malformed breadcrumb, missing image alt, and invalid pagination are rejected rather than silently omitted. Evidence `<attemptDir>/task-33-geo-foundry-development-plan.json`.
  Commit: Y | `feat(renderer): 建立共享语义渲染核心`

- [ ] 34. Implement React SSR renderer, slots, and Theme Adapter contract
  What to do / Must NOT do: Create `@geo/render-react` using React 19.2.8 peer dependencies and Node streaming/string SSR support. Implement `GeoProvider`, `GeoPage`, article/list/category/tag/redirect/not-found components, declared slots, default components, metadata/JSON-LD helpers, and theme tokens. First render must not read window/time/random/client locale; effects may enhance only after hydration. Do not couple to Next/Express internals or permit arbitrary schema mutation.
  Parallelization: Wave 5 | Blocked by: 8,33 | Blocks: 35-40
  References: render-core Todo 33, Theme/Slot constraints in Scope; target `packages/render-react/src/*`.
  Acceptance criteria: Vitest SSR tests cover string and `renderToPipeableStream`; hydration tests emit zero mismatch/error/warning; JavaScript-disabled output contains complete semantic content; React remains peerDependency and package tarball consumer passes.
  QA scenarios: happy: render/hydrate every page type with default theme; failure: slot throws, missing required slot context, unstable ID fixture, and client-only global access are caught by tests/error boundary policy. Evidence `<attemptDir>/task-34-geo-foundry-development-plan/`.
  Commit: Y | `feat(renderer): 实现 React SSR 与主题插槽契约`

- [ ] 35. Build Site A Next.js SSR host and technical theme
  What to do / Must NOT do: Using the `visual-engineering` category with `frontend` skill during execution, create `examples/site-a-next` on Next.js 16.3.1. It must call `@geo/runtime` on the server, render via packed `@geo/render-react`, provide Site A technical/editorial visual tokens and only approved slot overrides, expose host-aware article/list/category/tag/redirect/not-found routes, and emit full HTML without client JS. Do not duplicate compiler, SEO, JSON-LD, URL, or article-body logic in the host.
  Parallelization: Wave 5 | Blocked by: 26,30,31,34 | Blocks: 37-40
  References: package boundaries Todo 8, Runtime Todo 31, Renderer Todo 34; target `examples/site-a-next/*`.
  Acceptance criteria: production build/start succeeds; raw `curl -H 'Host: site-a.test'` HTML contains title/body/canonical/JSON-LD before hydration; architecture test confirms no CMS/compiler/quality import and no duplicated schema generation.
  QA scenarios: happy: desktop/mobile article and list with Site A theme; failure: unknown path, redirect, gone, object-store temporary failure, and JS disabled return defined semantic/status behavior. Evidence `<attemptDir>/task-35-geo-foundry-development-plan/`.
  Commit: Y | `feat(example): 添加 Site A Next SSR 主题站点`

- [ ] 36. Build Site B Express SSR host and distinct operational theme
  What to do / Must NOT do: Using `visual-engineering` + `frontend`, create `examples/site-b-express` with Express 5.2.1 and React streaming SSR, consuming the same packed Runtime/Renderer packages. Provide a visibly distinct operations/business theme through tokens and approved slots only, preserve response status/redirect/cache headers, and render all P0 page types. Do not fork renderer code, deep-import workspace source, or add a second content model.
  Parallelization: Wave 5 | Blocked by: 26,30,31,34 | Blocks: 37-40
  References: same as Todo 35; target `examples/site-b-express/*`.
  Acceptance criteria: production build/start succeeds; raw Host-header requests return complete SSR HTML and correct status/redirect/cache headers; dependency/API test proves both hosts consume identical tarball versions of `@geo/runtime` and `@geo/render-react`.
  QA scenarios: happy: Site B article/list/category/tag use distinct theme and content angle; failure: Site A host/path against Site B process, redirect, gone, not-found, and hydration mismatch tests produce no brand/content leakage. Evidence `<attemptDir>/task-36-geo-foundry-development-plan/`.
  Commit: Y | `feat(example): 添加 Site B Express SSR 主题站点`

- [ ] 37. Seed and automate the fixed two-site MVP scenario
  What to do / Must NOT do: Add deterministic seed/orchestration scripts creating one tenant with two Sites, `site-a.test` and `site-b.test`, distinct strategies/themes, one shared Content topic, fixed research bundle, two angle-specific Editions, media, users for each role, and quality fixtures where one first evaluation fails then bounded revision passes. Automate generate/evaluate/approve/publish/update/rename/rollback using public/internal APIs, not direct DB mutation.
  Parallelization: Wave 5 | Blocked by: 8,33-36 | Blocks: 38-40
  References: this plan fixed MVP fixture, authorization and API contracts; target `tests/fixtures/mvp/*`, `scripts/mvp-scenario.mjs`.
  Acceptance criteria: `pnpm mvp:seed && pnpm mvp:run --record <attemptDir>/task-37-...` is repeatable from reset infrastructure, produces stable IDs/operation timeline, two different Editions below review similarity threshold, release v1/v2, redirect, and rollback receipts; rerun does not duplicate logical entities.
  QA scenarios: happy: full scripted scenario reaches published Site A/B; failure: interrupt after generation, evaluation, upload, and pointer switch, then rerun and assert reconciliation/idempotency with no duplicates. Evidence `<attemptDir>/task-37-geo-foundry-development-plan/`.
  Commit: Y | `test(mvp): 固化双站点验收数据与流程`

- [ ] 38. Implement automated SSR, SEO, accessibility, and two-site E2E acceptance
  What to do / Must NOT do: Add Playwright projects for Site A/B desktop/mobile plus raw HTTP assertions. Verify complete no-JS HTML, heading semantics, brand isolation, content difference, canonical, robots, OpenGraph, valid JSON-LD, sitemap, active URL stability after update, old-slug 301, redirect target, 404, release header, and one shared renderer package version. Run axe checks and visual baselines for approved pages; do not approve snapshots without semantic assertions.
  Parallelization: Wave 5 | Blocked by: 2-37 | Blocks: 39,40,F1-F4
  References: Todos 25-37 and this plan Verification strategy; target `tests/e2e/*`, `playwright.config.ts`.
  Acceptance criteria: `pnpm test:e2e` passes against production builds; evidence includes HTML report, traces on failure/retry, screenshots/diffs, axe JSON, HAR, raw SSR HTML, sitemap, JSON-LD report, and per-URL release/canonical matrix.
  QA scenarios: happy: all 19 user PRD MVP acceptance steps are mapped to assertions; failure: deliberate brand leak, body rendered only after JS, wrong-domain canonical, draft in sitemap, broken JSON-LD, URL mutation, or shared-renderer version mismatch each fails a named test. Evidence `<attemptDir>/task-38-geo-foundry-development-plan/`.
  Commit: Y | `test(e2e): 覆盖双站点 SSR 与 SEO 验收`

- [ ] 39. Execute the cross-tenant, idempotency, release, and outage fault matrix
  What to do / Must NOT do: Create repeatable integration/E2E fault injection covering cross-tenant 403/no existence leak, duplicate generate/evaluate/publish/rollback, Worker crashes around side effects, Redis namespace cleanup/outage, provider timeout, embedding mismatch, Quality fail-closed, concurrent URL reserve, upload interruption, artifact tamper, manifest missing, CAS conflict, concurrent publish/rollback, stale cached 404, Control Plane shutdown, and isolated RustFS access denial/recovery. Never create or stop shared PostgreSQL/Redis/RustFS containers, use production targets, or use paid providers.
  Parallelization: Wave 5 | Blocked by: 2-38 | Blocks: 40,F1-F4
  References: negative scenarios from Todos 10,14,17-24,28-32,38; target `tests/faults/*`, process/network fault profiles.
  Acceptance criteria: `pnpm test:faults` executes every named case, records deterministic terminal state and recovery, and leaves no orphan current pointer, duplicate Edition/Release, cross-tenant object, or unreconciled non-terminal Operation; report links each failure injection to assertion/evidence.
  QA scenarios: happy: suite restores clean service state after each fault; failure: harness intentionally disables one reconciliation guard and must detect leaked duplicate/mixed release before the guard is restored. Evidence `<attemptDir>/task-39-geo-foundry-development-plan/`.
  Commit: Y | `test(system): 验证故障恢复与租户隔离`

- [ ] 40. Ship CI gates, architecture records, integration guide, and operator runbooks
  What to do / Must NOT do: Add GitHub Actions for toolchain/frozen install, format/lint/typecheck, contract/unit, deterministic compiler double-run, package tarball smoke, production builds, and evidence artifact upload. Shared-service integration/E2E/fault jobs run only on an approved protected runner with the existing service credentials/namespace policy; ordinary public CI must not create containers or receive shared-service credentials. Add `README.md` usage, `mydocs/260817-geo-foundry-PRD.md` preserving the supplied PRD, architecture records for Control/Serving boundary, PageDocument/versioning, tenancy, quality thresholds, and immutable release/CAS; package integration guide; shared-service environment, migration, publish, rollback, reconciliation, evidence, and incident runbooks. Keep credentials as placeholders and do not add deployment to a real cloud.
  Parallelization: Wave 5 | Blocked by: 1-39 | Blocks: F1-F4
  References: `/home/ubuntu/project/Binny-GIT/nkmed/.github/workflows/ci.yml:1-46`; all plan decisions and evidence requirements; target `.github/workflows/ci.yml`, `README.md`, `mydocs/*.md`, `mydocs/runbooks/*`, and package READMEs.
  Acceptance criteria: local `pnpm ci:verify` reproduces the non-secret CI gates with remote cache off; protected-runner shared-service jobs have least-privilege permissions, timeouts, concurrency cancellation, frozen lockfile, no secret echo, namespace cleanup, and upload every required evidence artifact on failure; all runbook commands execute against approved shared-service scripts.
  QA scenarios: happy: clean clone-equivalent run produces complete CI/evidence index; failure: missing report, dirty generated migration, non-frozen lockfile, forbidden dependency, secret-like fixture, or failed rollback smoke blocks CI. Evidence `<attemptDir>/task-40-geo-foundry-development-plan/`.
  Commit: Y | `ci(repo): 完成质量门禁与项目运行文档`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  Verify every Todo 1-40 acceptance command/evidence exists and passes from a clean workspace; map the 19 MVP acceptance steps, all five state machines, role matrix, API/idempotency contract, package matrix, and failure cases to implementation/tests. Reject missing evidence, skipped command, stale Turbo-only result, or worker self-report. Evidence `<attemptDir>/final-F1-plan-compliance.md`.
- [ ] F2. Code quality, architecture, and security review
  Run `review-work` plus focused dependency/security review over tenancy, service auth, custom endpoints, secret handling, SSR injection, URL normalization, object key safety, CAS/reconciliation, typed errors, package exports, module boundaries, migrations, and files over the 250 LOC ceiling. Run full diagnostics, tests, build, and dependency audit; all findings caused by the work must be fixed before APPROVE. Evidence `<attemptDir>/final-F2-quality-security.md`.
- [ ] F3. Real browser and operational QA
  Use the `kimi-webbridge` skill to open both production-built Site A/B hosts in the user's real browser; verify desktop/mobile article/list/category/tag, redirect/not-found, no-JS SSR evidence, distinct themes, canonical/JSON-LD/sitemap, update preserving URL, and Site A rollback without Site B change. Also execute the public API scenario with `curl` and inspect publish/rollback receipts. Evidence `<attemptDir>/final-F3-browser-operations/`.
- [ ] F4. Scope fidelity and serving-independence review
  Compare the delivered surface with Must have/Must NOT have: confirm P0 is complete, P1/P2 features were not implemented, there is one provider adapter, React-only renderer, no page builder/multilingual/static export/analytics, no production-request Control Plane dependency, and all `.omo`/user changes are preserved. Repeat Control Plane shutdown test and approve only if cold Runtime requests still serve artifacts. Evidence `<attemptDir>/final-F4-scope-fidelity.md`.

## Commit strategy

- Use semantic Chinese commit messages shown on each todo. The repository has no existing history, so the first commit establishes the convention; do not combine waves into a monolithic commit.
- Each Todo's implementation and direct tests stay in the same commit. Configuration plus its verification script may share one commit because either alone is unusable.
- Before each commit: inspect `git status`, staged diff, unstaged diff, recent log, and stage only the Todo's files; never include credentials, `.omo/evidence/`, local volumes, generated reports, or unrelated changes.
- Dependency order follows the Todo graph. Do not commit a consumer before its contract/package dependency. Failed hooks/tests are fixed in a new commit attempt, never bypassed or amended unless Mark explicitly requests amendment.
- No push, release, deployment, or PR unless the worker invocation explicitly includes the corresponding authorization (`--make-pr`/`--ship`).

## Success criteria

- A clean checkout with Node 24 and pnpm 11.22.0 can run `pnpm install --frozen-lockfile`, validate shared-service connectivity/isolation, migrate/seed its own namespace, execute the fixed MVP scenario, build all packages/apps, and pass all automated gates without external paid services.
- Two isolated Sites sharing one Content produce genuinely different Editions, pass/fail quality gates as designed, publish immutable releases, serve full SSR HTML through the same Runtime/Renderer, and maintain separate themes, domains, canonical data, JSON-LD, and sitemaps.
- Generate/evaluate/publish/rollback honor authentication, tenant scope, required idempotency keys, stable status/response fields, retries, crash recovery, and exactly one visible logical result under at-least-once execution.
- PageDocument v1, URL Registry, Artifact Manifest, current pointer, receipts, package exports, and renderer slots are versioned, strict, documented, contract-tested, and usable from packed external consumers without deep imports.
- Concurrent URL reservation and publication have one winner; failed upload/validation/CAS leaves the old complete release current; rollback moves only the pointer to a verified release and never recompiles or deletes artifacts.
- With CMS, PostgreSQL, Redis, Worker, and fake LLM stopped, cold Runtime requests for already published pages, redirects, not-found, and sitemap still succeed using only object storage; dependency logs prove no Control Plane connection attempts.
- Cross-tenant reads/writes/media/object keys are denied without existence leakage; anonymous reads expose only published release artifacts, not CMS drafts or versions.
- CI retains JUnit, coverage, provenance, compiler hash/diff, job timeline, manifests/inventories, publish/rollback receipts, raw SSR HTML, sitemap/JSON-LD reports, screenshots, axe results, HAR, and Playwright traces; missing evidence fails the gate.
- All four final-verification tasks return APPROVE, and Mark explicitly accepts their surfaced results before the worker declares the implementation complete.
