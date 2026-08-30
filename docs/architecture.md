# Geo Foundry 架构说明

- **状态**：现行架构基线
- **日期**：2026-08-27

本文件说明技术栈、模块边界、数据模型和明确不采用的技术。产品方向见[产品说明](product.md)。

## 1. 规模定位

Geo Foundry 是**单团队维护的内部产品**，服务少数几个自有品牌，不是对外销售的平台。

所有架构决策都遵循一条原则：

> **能用一个应用、一个数据库解决的问题，不引入第二个服务。**

技术选型不追求前沿，只要求单人可维护、可排障、可长期演进。

## 2. 技术栈

| 层次 | 选型 | 职责 |
| --- | --- | --- |
| 应用框架 | Next.js 16 App Router | 控制台界面、服务端渲染、Route Handler、Webhook |
| 前端 | React 19、TypeScript、Tailwind CSS 4、Radix UI | 运营界面 |
| 编辑器 | Lexical + PageDocument Blocks | 结构化正文 |
| 后端底座 | Payload 3.88 | 数据模型、认证、RBAC、租户范围、媒体、草稿与版本、迁移 |
| 数据库 | PostgreSQL | 唯一事实源 |
| 任务队列 | BullMQ + 共享 Redis | 抓取、生成、评估、编译、发布、定时任务 |
| 事件边界 | Transactional Outbox | 数据库事务与异步任务之间的可靠衔接 |
| 对象存储 | S3 兼容（开发与 mk-dev 使用 RustFS） | 媒体、稿源快照、不可变发布产物 |
| 校验 | Zod | 接口、任务参数、AI 输出、页面文档 |
| 测试 | Vitest、Playwright | 单元、集成、浏览器 |

### 2.1 允许新增的前端依赖

只在确有需要时引入这三项：

- **TanStack Table**：稿源箱、任务队列、内容库。
- **TanStack Query**：版本历史、审批、发布等交互型请求。
- **React Hook Form**：字段较多的表单，配合已有 Zod 校验。

### 2.2 明确不采用

| 技术 | 不采用理由 |
| --- | --- |
| Temporal | 当前流程用数据库状态加任务队列即可表达，引入独立工作流服务会产生第二套事实源 |
| Keycloak | Payload 已提供登录、会话、API Key 和角色，独立身份服务对内部产品过重 |
| 独立 Fastify / NestJS API | Next Route Handler 足够，独立服务只会增加部署、鉴权和契约同步成本 |
| Drizzle 直接建模 | Payload 已封装 PostgreSQL 访问与迁移，绕开它等于重写数据层 |
| Better Auth 等替代认证 | 会重写登录、会话、API Key、权限和用户数据迁移，收益为零 |
| Tiptap | Lexical 与现有区块结构、预览和版本历史已打通，替换只有迁移成本 |
| Hocuspocus / Yjs / 实时协作 | 单团队串行编辑，用乐观锁与版本历史即可 |
| Kafka / Redpanda | Outbox 加 BullMQ 已满足当前吞吐 |
| ClickHouse / OpenSearch | PostgreSQL 全文检索足够，等数据量和查询复杂度真正超出后再评估 |
| FullCalendar | 发布计划先用按日或按周列表 |
| Recharts | 等有真实表现数据后再引入 |
| next-intl | 用一个集中的中文/英文字典模块即可 |

## 3. 部署结构

```text
Next 应用（控制台 + 接口）
Worker 进程（后台任务）
PostgreSQL
Redis（宿主机共享）
S3 兼容存储
```

Web 与 Worker **使用同一个镜像**，通过启动命令区分角色，不是两个独立服务。mk-dev Compose 同时运行 `cms` 与 `worker`：CMS 的 transactional Outbox 负责把数据库事实投递到 Redis，Worker 使用同一个 FILE-only 凭据目录和 tenant keyring 消费后台任务。`worker-smoke` 验证容器、keyring、Redis 与 CMS 连通；`worker-business-smoke` 额外验证一次 append-only CMS mutation → Outbox → BullMQ → Worker consumer 链路。

## 4. 模块边界

### 4.1 控制面

`apps/cms` 承担控制台与业务逻辑，内部按能力划分模块：

```text
访问控制    租户、用户、角色、会话
稿源接入    连接器、稿源条目、快照、去重
内容        文章、版本、来源关联
审核        审核请求、决定、意见
发布        发布计划、编译、发布、回滚
系统        操作记录、诊断
```

`apps/worker` 执行异步任务，通过内部接口回写结果，不直接操作数据库。

### 4.2 服务面

已发布网站只读取不可变产物，不访问控制台、数据库、队列或模型服务。这条边界不放宽，详见 [ADR 001](adr/001-control-plane-serving-plane.md)。

### 4.3 工作区包

`packages/` 下的包全部是**内部包**，不对外发布：

| 包 | 职责 |
| --- | --- |
| `schema` | 页面文档与发布清单结构 |
| `domain` | 状态机、标识、URL 与领域错误 |
| `compiler` | 内容版本编译为页面文档 |
| `publisher` | 不可变发布、指针切换、回滚 |
| `runtime` | 服务面解析已发布产物 |
| `render-core` / `render-react` | 页面渲染 |
| `quality-rules` | 质量检查 |
| `content-pipeline` | 生成与评估流程 |
| `content-client` | 控制面内部接口客户端 |
| `testing` | 测试辅助 |

包之间仍通过声明的入口互相引用，不做深层路径导入。但不再维护对外发布契约，详见第 7 节。

## 5. 数据模型

### 5.1 现有实体

```text
tenants        安全边界
users          账号与角色
sites          品牌与站点
domains        访问域名
contents       内容主题
content-editions  品牌版本与正文
media          图片与附件
url-records    页面地址
quality-assessments  质量证据
releases       不可变发布
rollback-intents  回滚请求
operations     异步任务记录
```

### 5.2 需要新增的实体

```text
connectors            采集渠道：手工 / URL / Webhook / RSS
intake-items          稿源条目：状态、重复标记、建议品牌、负责人
source-snapshots      原始响应与正文快照、内容哈希
article-sources       文章版本与稿源的关联
review-comments       审核意见
publication-plans     计划发布时间、时区、状态
performance-snapshots 页面表现（后期阶段）
```

### 5.3 刻意不新增的抽象

| 未引入 | 替代做法 |
| --- | --- |
| 独立 Brand 实体 | 品牌档案字段直接挂在 `sites` 上。Xllent AI、Dianordic、NKMed 各自就是一个站点 |
| 独立任务实体 | 负责人、优先级、截止时间直接放在稿源条目和内容版本上 |
| 完整 Fact / Claim 知识图谱 | 先用文章版本与稿源快照的关联表 |
| 独立任务账本 | 复用现有 `operations` 记录异步执行 |

只有当「一稿多任务」「一个品牌多站点」等需求真实出现时，才拆出新实体。

### 5.4 品牌与站点的关系

```text
Tenant   安全与数据隔离边界
Site     品牌 + 发布目的地 + 品牌档案
Domain   实际访问地址
```

品牌档案字段：目标读者、专业领域、语气、禁止表达、内容角度、CTA。

## 6. 关键约束

1. **PostgreSQL 是唯一事实源。** Redis 与 BullMQ 只保存临时执行状态，丢失后可由数据库恢复。
2. **工作流写入必须走领域服务与受保护接口**，不允许前端用通用 CRUD 修改状态字段。
3. **权限在服务端强制**，所有读取以当前会话身份执行，界面隐藏不构成安全边界。
4. **发布产物不可覆盖**，切换当前版本使用条件写；回滚只切指针，不重编译。
5. **文章更新默认不改 URL**，改动 slug 必须留下重定向。
6. **异步任务必须幂等**，携带幂等键并容忍重复投递。
7. **审核绑定具体版本**，批准后再编辑会使原批准失效。

## 7. 已移除的平台化设计

以下机制按内部产品规模评估后移除，不影响产品能力：

| 移除项 | 原因 |
| --- | --- |
| 包对外发布契约、API Extractor、tarball 消费者验证 | 这些包没有外部使用者 |
| 逐任务证据与回执体系 | 用常规 CI 测试产物即可 |
| 大量一次性浏览器循环脚本与需求矩阵 | 合并为少量 Playwright 用例 |
| 完整故障注入矩阵 | 只保留发布、回滚与幂等相关的契约测试 |
| `apps/content-service` 独立服务 | 仅 595 行转发逻辑且从未部署，并入控制面接口 |
| Payload 自定义产品视图 | 控制台已接管界面，避免两套实现 |

`/admin/_emergency` 保留为超级管理员的应急入口，成本低且排障时有用。

`examples/site-a-next` 与 `examples/site-b-express` 保留为多站点隔离测试的 Fixture，不是产品的一部分。

## 8. 版本基线

当前工作区已统一为：

| 依赖 | 当前版本 |
| --- | --- |
| Zod | `4.4.3` |
| React / React DOM | `19.2.8` |
| Next.js | `16.3.1` |

工具链基线：Node.js 24、pnpm 11.22.0、TypeScript 5.9.3、Turborepo、Biome。依赖升级仍须通过工作区 typecheck、测试、CMS build 与 Worker build 后才能部署。

## 相关文档

- [产品说明](product.md)
- [开发计划](development-plan.md)
- [运行手册](operations.md)
- [ADR 001：控制面与服务面分离](adr/001-control-plane-serving-plane.md)
- [ADR 006：控制台负责界面，Payload 作为后端](adr/006-console-owns-ui-payload-headless.md)
- [ADR 007：内容运营领域模型](adr/007-content-operations-domain-model.md)
