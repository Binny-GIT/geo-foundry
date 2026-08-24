# 20 领域层：状态机 / URL 注册表 / 不变量（DOM）

覆盖 `packages/domain/src/*`。纯函数领域逻辑，以 `PASS_BACKEND` 计。已有自动化丰富（18 个测试文件），本文档确保每条合法边/非法边/守卫都有对应用例并映射到测试。

## 内容版本状态机 content-edition

状态：`draft, generating, review, approved, compiled, published, archived`。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-001 | P0 | draft→generating→review 合法链 | 允许 | 状态推进 | content-edition-transition |
| [ ] | DOM-P0-002 | P0 | reviewer: review→approved | 允许（角色守卫） | — | NOT_RUN |
| [ ] | DOM-P0-003 | P0 | quality passed: approved→compiled | 允许（质量守卫） | — | NOT_RUN |
| [ ] | DOM-P0-004 | P0 | publisher: compiled→published / →archived | 允许 | — | NOT_RUN |
| [ ] | DOM-P0-005 | P0 | reviewer: review→draft 回退 | 允许 | — | NOT_RUN |
| [ ] | DOM-P0-006 | P0 | 非法跳变（如 draft→published、published→generating） | `CONTENT_EDITION_*` 拒绝 | 状态不变 | 已有自动化 |
| [ ] | DOM-P0-007 | P0 | 错误角色执行迁移 | 守卫拒绝 | — | NOT_RUN |
| [ ] | DOM-P0-008 | P0 | `createDraftEditionFromPublished` | 从 published 派生 draft | 新聚合、来源引用 | NOT_RUN |
| [ ] | DOM-P1-009 | P1 | 陈旧聚合状态迁移 | `StaleAggregateStateError` | — | NOT_RUN |

## 发布状态机 release

状态：`building, validated, uploaded, current, failed, rolled_back, superseded`。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-020 | P0 | building→validated→uploaded→current 合法链 | 允许 | — | release-transition |
| [ ] | DOM-P0-021 | P0 | 守卫 `manifestVerified` 未满足 | 拒绝 | — | NOT_RUN |
| [ ] | DOM-P0-022 | P0 | 守卫 `pointerCasMatched` 未满足 | 拒绝 | CAS 冲突 | NOT_RUN |
| [ ] | DOM-P0-023 | P0 | current→rolled_back / →superseded | 允许 | — | NOT_RUN |
| [ ] | DOM-P0-024 | P0 | 各状态角色映射校验 | 错误角色拒绝 | — | NOT_RUN |
| [ ] | DOM-P0-025 | P0 | 非法迁移 | `RELEASE_*` 拒绝 | — | 已有自动化 |

## 操作状态机 operation

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-030 | P0 | `transitionOperation` 合法序列 | 允许 | — | operation-transition |
| [ ] | DOM-P0-031 | P0 | `createOperationRetry` 源非 failed | 守卫拒绝 | — | NOT_RUN |
| [ ] | DOM-P0-032 | P0 | 非法迁移 | 拒绝 | — | NOT_RUN |

## 质量评估状态机 quality-assessment

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P1-040 | P1 | `transitionQualityAssessment` 合法/非法 | 相应允许/拒绝 | QualityIssue/Evidence 结构 | quality-assessment-transition |

## URL 记录状态机 + 注册表

状态：`reserved, active, redirected, gone`。

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-050 | P0 | `transitionUrlRecord` 合法链 reserved→active→redirected/gone | 允许 | — | url-record-transition |
| [ ] | DOM-P0-051 | P0 | 非法迁移 | `URL_*` 拒绝 | — | url-transition-errors |
| [ ] | DOM-P0-052 | P0 | `normalization` hostname/locale/pathname/canonical + 唯一键 | 规范化确定 | 唯一键稳定 | url-normalization |
| [ ] | DOM-P0-053 | P0 | `reserveUrl`/`publishUrl`/`retainActiveUrlForContentUpdate` | 状态正确 | — | url-lifecycle |
| [ ] | DOM-P0-054 | P0 | `renameUrl`/`markUrlGone` | 状态正确 | — | url-lifecycle |
| [ ] | DOM-P0-055 | P0 | `validateRedirectGraph` 环/链/跨站/跨租户 | 检出并拒绝 | 无环 | url-graph |
| [ ] | DOM-P1-056 | P1 | `requireSitemapEligible` | 仅合规入 sitemap | — | NOT_RUN |
| [ ] | DOM-P1-057 | P1 | URL 边界错误 `UrlBoundaryError`/`UrlInvariantError` | 正确抛出 | — | url-boundaries |
| [ ] | DOM-P2-058 | P2 | URL 迁移穷尽性（exhaustive） | 所有分支覆盖 | assertNever | url-exhaustive |

## 站点 host 解析 site/host-resolution

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-060 | P0 | `resolveSiteHost` 正常/别名 host | 命中站点 | — | site-host |
| [ ] | DOM-P0-061 | P0 | host 冲突/未知/禁用/canonical 缺失 | `classifySiteHostFailure` 分类正确 | — | NOT_RUN |
| [ ] | DOM-P1-062 | P1 | `validateTimezone` | 合法通过/非法拒绝 | — | NOT_RUN |

## 不变量与原语

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | DOM-P0-070 | P0 | `ids.ts` 10 种 id 解析器合法/非法 | 相应通过/`InvalidIdentifierError` | — | domain-primitives |
| [ ] | DOM-P0-071 | P0 | `job-ids.operationJobIdOf` 阶段模式 | 生成稳定 job id | — | job-ids |
| [ ] | DOM-P0-072 | P0 | `ownership.freezeOwnership` | 冻结不可变 | isFrozen | NOT_RUN |
| [ ] | DOM-P1-073 | P1 | `result.ts` DomainResult ok/err | 正确分支 | — | NOT_RUN |
| [ ] | DOM-P1-074 | P1 | Instant/Hash 非法值 | `InvalidInstantError`/`InvalidHashError` | — | NOT_RUN |
| [ ] | DOM-P2-075 | P2 | 迁移契约穷尽性 transition-contracts | 每状态机 assertNever 覆盖 | — | transition-contracts |
| [ ] | DOM-P2-076 | P2 | `errors.ts` 约 48 错误码枚举完整 | 无遗漏/无重复 | — | NOT_RUN |
