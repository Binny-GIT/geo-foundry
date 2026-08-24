# 90 横切质量基线（XC）

跨模块的确定性、审计不可变、错误契约、可访问性、响应式、性能与隔离。已有自动化：`testing/*`（determinism、evidence、architecture）、`packages/schema/*`（contracts）、`packages/quality-rules/*`、`tests/faults/*`。

## 确定性

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P0-001 | P0 | 编译/评估/序列化在相同输入下字节一致 | 无非确定性差异 | canonicalJson/hash 稳定 | 关联 CMP/CPL |
| [ ] | XC-P0-002 | P0 | 质量规则 issue 排序确定 | 顺序稳定 | quality-rules determinism | determinism |
| [ ] | XC-P1-003 | P1 | vitest 种子洗牌下全绿 | 顺序无关通过 | vitest.workspace seed | NOT_RUN |

## 审计与不可变

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P0-010 | P0 | 所有 immutable 列拒绝更新 | editions/releases/operations/assessments/outbox 一致 | 值不变 | 关联 COL |
| [ ] | XC-P0-011 | P0 | 写操作记录真实 audit actor | 审计不可伪造 | actor 序列化正确 | 关联 RBAC/SVC |
| [ ] | XC-P1-012 | P1 | ownership 冻结不可变 | freezeOwnership 生效 | isFrozen | 关联 DOM |

## 错误码契约

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P1-020 | P1 | domain/compiler/provider/内部端点错误码集合无遗漏无重复 | 枚举完整 | assertNever 穷尽 | 关联各模块 |
| [ ] | XC-P1-021 | P1 | schema 严格契约（page-document.red、release-contract） | 违规被拒 | schema 测试 | schema |
| [ ] | XC-P1-022 | P1 | 故障注入契约 tests/faults | 各故障路径符合契约 | — | faults |

## 隔离

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P0-030 | P0 | 租户隔离贯穿 CMS/编译/服务面 | 无跨租户泄露 | 关联 RBAC/SITE | NOT_RUN |
| [ ] | XC-P0-031 | P0 | 服务面站点隔离 serving-plane-isolation | 站点间不串制品 | runtime integration | NOT_RUN |

## 可访问性 / 响应式（UI）

| 已测 | ID | 优先级 | 场景/操作 | 可见断言/期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P2-040 | P2 | 公开首页 a11y（axe，已引入 @axe-core/playwright） | 无严重违规 | — | NOT_RUN |
| [ ] | XC-P2-041 | P2 | 后台关键页 a11y | 无严重违规 | — | NOT_RUN |
| [ ] | XC-P2-042 | P2 | 首页/站点 4 视口响应式 | 布局正常 | 375/768/1280/1440 | 关联 API/SITE |

## 性能 / 稳定性

| 已测 | ID | 优先级 | 场景/操作 | 期望 | 后端/数据断言 | 证据/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| [ ] | XC-P2-050 | P2 | mk-dev 公网单请求延迟 | 2-7s 属隧道特征，非缺陷；不可达才算失败 | 重试后可达 | 手册基线 |
| [ ] | XC-P2-051 | P2 | worker 大批量操作稳定性 | 无泄漏/死锁 | reconcile 恢复 | NOT_RUN |
