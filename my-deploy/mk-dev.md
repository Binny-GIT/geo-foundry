# Geo Foundry CMS — mk-dev 部署运行手册

人类可读运行手册。权威基础设施事实见知识库 Operations/Infrastructure 文档；
凭据不落仓库，保存在 `/opt/geo-foundry/mk-dev.env`（root:root 600）。

## 拓扑

- 容器：`geo-foundry-cms-mk-dev`，镜像 `geo-foundry-cms:mk-dev-<git-sha>`，
  端口 `127.0.0.1:3090->3090`，非 root（uid 1001），restart `unless-stopped`。
- 公网入口：`https://geo-foundry-mk-dev.aixllent.com`（共享隧道 `opencode-mk-dev`）。
- 共享服务（本项目不新增基础设施容器）：
  - PostgreSQL：`pg_default` 网络别名 `pg-server:5432`（数据库/Schema `geo_foundry`）
  - RustFS：`rustfs-shared` 网络别名 `rustfs-server:9000`（prefix `geo-foundry/objects/`）
- 健康检查：容器内 `/api/health`（30s）；就绪（PG+RustFS）`/api/readiness`。
- 监控：Watchtower Target「Geo Foundry mk-dev」，每分钟 GET 公网 `/api/health`。

## 一次性准备（已完成）

```sh
docker network create rustfs-shared
docker network connect rustfs-shared rustfs-server
sudo install -d -m 700 /opt/geo-foundry
# 编辑 /opt/geo-foundry/mk-dev.env：IMAGE_TAG / COMPOSE_ENV / GEO_FOUNDRY_PG_* /
# GEO_FOUNDRY_S3_*（ENDPOINT=rustfs-server）/ PAYLOAD_SECRET，权限 root:root 600
```

## 语义命令（仓库根 Makefile）

```sh
make image-build        # 宿主机构建 + 打包镜像（容器内无法访问 npm registry）
make container-smoke    # verify 栈起容器 + 本机健康冒烟 + 清理
make deploy-mk-dev      # mk-dev 栈 up --wait + 本机/公网 smoke
make rollback-mk-dev    # 改 /opt/geo-foundry/mk-dev.env 的 IMAGE_TAG 后重跑
```

底层等价命令：

```sh
docker compose --env-file /opt/geo-foundry/mk-dev.env \
  -f deploy/compose.yaml -f deploy/compose.mk-dev.yaml up -d --no-build --wait
```

## 数据库迁移

mk-dev 迁移仍在宿主机执行（expand-only；容器只负责服务）：

```sh
/home/ubuntu/.local/bin/geo-foundry-cms-secure pnpm --filter @geo/cms db:migrate
```

迁移后无需重启容器（连接池自动感知）。破坏性 contract 迁移须等回滚窗口关闭。

## 已知问题

- `/admin/login` 管理界面在真实浏览器中渲染空白（本地/公网、dev/prod 均复现），
  证据：`.omo/evidence/260819-cms-admin-blank/`。API 面不受影响。
- 共享隧道单请求延迟 1-3s 属主机链路特征（nkmed 相同），非本项目问题。

## 回滚

1. `sudoedit /opt/geo-foundry/mk-dev.env` 将 `IMAGE_TAG` 改回上一 `mk-dev-<sha>`。
2. `make rollback-mk-dev`。
3. 验证 watchtower 目标恢复 healthy。
