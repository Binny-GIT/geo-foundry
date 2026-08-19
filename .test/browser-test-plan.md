# geo-foundry-mk-dev 浏览器测试文档

- 目标站点:`https://geo-foundry-mk-dev.aixllent.com`(Cloudflare 共享隧道 → 容器 `geo-foundry-cms-mk-dev`,127.0.0.1:3090)
- 浏览器引擎:Playwright 驱动的真实 Chromium(headless;曾用 xvfb 有头模式交叉验证)
- 执行入口:`node .test/browser-checks.mjs`(从仓库根运行;结果写回本目录)
- 约定:每次检查最多重试 3 次,单次超时 45s(见"链路基线")

## 链路基线(为什么超时给得很宽)

共享隧道单请求延迟 2-7 秒(nkmed 同 profile,属主机到 Cloudflare 边缘的链路特征),
偶发 20 秒级超时需要重试。管理端 SPA 一次加载几十个 chunk,经隧道完整水合可能超过
一分钟。**"页面慢"不是缺陷,"不可达"才是。**

## 用例清单

| # | 用例 | 期望 | 结果 |
|---|------|------|------|
| 1 | 根路径 `/` | 307 跳转 `/admin`,跟随跳转后 200 | PASS(final=/admin) |
| 2 | `/admin` | 200,标题含 Payload | PASS(title=Dashboard - Payload) |
| 3 | `/admin/login` | 200;登录表单是否渲染记录为已知缺陷观察项 | PASS(title=Login - Payload;表单未渲染=已知缺陷) |
| 4 | `/api/health` | 200 `{"status":"alive"}` | PASS |
| 5 | `/api/readiness` | 200,postgres 与 rustfs 均 ready | PASS |
| 6 | 未知路径 `/definitely-not-a-page` | 404 | PASS |
| 7 | 截图存档 | `.test/artifacts/*.png` | PASS(admin.png、admin-login.png) |

## 已知缺陷(非连通性问题)

- **admin 登录表单空白**:`/admin/login` 在真实浏览器(headless/有头、本地/公网、
  dev/prod)均不渲染登录表单;资源全部 200、无控制台错误、SSR 只含空 Suspense 壳。
  证据:`.omo/evidence/260819-cms-admin-blank/`。API 面不受影响。

## 运行记录

| 日期 | 执行 | 结果摘要 |
|------|------|---------|
| 2026-08-19 | browser-checks.mjs(真实 Chromium) | 7/7 PASS,0 FAIL;机器可读结果见 latest-run.json;单请求延迟 2-7 秒(与 nkmed 同 profile,隧道链路特征) |
