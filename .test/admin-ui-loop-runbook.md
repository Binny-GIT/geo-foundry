# 公网 Admin 逐页数据闭环 Runbook

本 runbook 配合 `.test/admin-ui-loop.mjs`、`.test/admin-page-source-registry.mjs` 和
`.test/admin-fixture-manifest.mjs` 使用。目标是让每个页面均有 **Rendering + Data + RBAC**
结论；只有三项共同满足时才是 `PASS_FULL`。

## 不可变安全规则

- 测试地址只能是 `https://geo-foundry-mk-dev.aixllent.com`，不可指向生产域名。
- 不在受 Git 跟踪的文件、evidence、HAR 或截图文件名中写入口令、API key、Bearer token、cookie。
- 账号标识与 credential-file 约定见 `.test/accounts.md`；循环从 owner-only 文件读取，不复制固定口令。
- 仅使用 `@geo-foundry.test` 和 `.test` 临时名称；run ID 必须匹配 `admin-ui-YYYYMMDD-<lowercase-random>`。
- 不使用 `mvp:seed`、integration reset、collection-wide delete、Redis flush 或 bucket-wide prefix delete。
- 不删除 `embed-*` 或其它原有记录。临时资源必须写进 manifest，cleanup 只能根据 manifest 的精确 ID/key 进行。
- 所有服务自有数据必须走合法 content-service 受保护流程；浏览器不得请求 `/api/internal/*`。

## 运行顺序

### 1. 无写入基线发现

```bash
TEST_BASE_URL=https://geo-foundry-mk-dev.aixllent.com \
ADMIN_UI_SUPER_ADMIN_EMAIL_FILE=/secure/path/email \
ADMIN_UI_SUPER_ADMIN_PASSWORD_FILE=/secure/path/password \
node .test/admin-ui-loop.mjs
```

执行器先校验 `/api/health` 和 `/api/readiness`；readiness 不是 ready 时立刻 `BLOCKED`，不得建立 fixture。
随后检查首页、登录、忘记密码、404、Dashboard、侧栏发现的 collection 路由、服务自有 404 路由，逐页输出。对于 Payload 动态 admin `notFound()`，Next App Router 可能以流式 `200` 返回语义 404；循环会验证 `Not Found` 标题、`Nothing found` 内容和无横向溢出，而不会把该框架行为误报为业务错误：

```json
{
  "rendering": "PASS | FAIL | BLOCKED",
  "data": "PASS | FAIL | EXPECTED_EMPTY | RESTRICTED",
  "rbac": "PASS | FAIL | NOT_APPLICABLE",
  "overall": "PASS_FULL | FAILED | BLOCKED"
}
```

运行产物放在 `.test/admin-ui-evidence/<run-id>/`（Git 忽略）。其中不保存认证请求头、cookie 或账号密码。

### 2. fixture 数据闭环（仅明确授权后）

新建临时 fixture 前，必须通过 manifest 记录每条 ID 与每个 S3 object key；标记字段值本身要包含 run ID。每个下游空态先依下列合法来源建立上游数据，再返回原页核验：

1. super-admin：Tenant；
2. tenant-admin：tenant 用户、Site、canonical/alias Domain；
3. editor：Content、browser-uploaded Media、Content Edition；
4. content-service：Quality Assessment、compile evidence、release receipt、operation、URL registry；
5. reviewer/publisher：审核、发布、归档、rollback intent 等人类动作。

不要把 `Restricted` 视为零数据。每次创建后均需用同一浏览器 session 的 `/api/<collection>` 读请求比对 UI 可见记录和 tenant scope。

### 3. Kimi WebBridge 验收

自动循环变绿之后，通过 Kimi WebBridge 在公网浏览器逐项执行：

1. super-admin Dashboard 与 Sites workspace（1440、768、390）；
2. tenant-admin 创建 Site / Domain 并回到 Dashboard 检查派生指标；
3. editor 建 Content、上传 Media、建 Edition；
4. reviewer 审核；publisher 发布、归档、创建 rollback intent；
5. foreign tenant 访问同一 fixture 的 list/detail，确认无泄露；
6. content-service 登录后台，确认仅见 restricted human panel，而非普通 Dashboard。

Kimi 找到的可复现缺陷必须补进自动循环，修复后依次执行 typecheck、focused tests、镜像构建、Docker `--force-recreate`、公网循环和 Kimi 复验。

## 精确 cleanup

只在 fixture manifest 已存在且所有条目都带有 run marker 时运行 coordinator。它拒绝未追踪对象、宽泛 where 条件、路径逃逸和未确认的运行目标。

清理依赖顺序：rollback intent / release / operation / outbox / assessment → URL record / edition / content → media DB row 与 exact S3 key → domain / site / user / tenant。

结束后必须确认：

- manifest 状态为 `cleaned`；
- 所有精确 ID 和 object key 已不存在；
- 以 run ID 查询不到残留；
- `embed-*` 账号与基线数据仍然存在；
- evidence 记录 cleanup 结论，不记录机密。
