#!/usr/bin/env bash
# A1 部署：git 同步 → image-build → IMAGE_TAG 切换 → deploy-mk-dev（一次性脚本，不入库）
set -euo pipefail
# 非交互 ssh 不加载 .profile，显式指定 node 24 + pnpm 11.22.0
export PATH=/home/ubuntu/.n/bin:$PATH
cd /home/ubuntu/project/Binny-GIT/geo-foundry

echo "=== git sync ==="
git fetch origin
if [[ -n "$(git status --porcelain | grep -v '^??' || true)" ]]; then
  echo "WORKTREE_DIRTY"
  git status --short
  exit 1
fi
CUR="$(git rev-parse --short HEAD)"
echo "HEAD: $CUR"
if [[ "$CUR" != "746a3ab" ]]; then
  git pull --ff-only origin main
  CUR="$(git rev-parse --short HEAD)"
  echo "after pull: $CUR"
fi

echo "=== image-build (mk-dev-$CUR) ==="
make image-build

SHA="$(git rev-parse --short HEAD)"
echo "=== IMAGE_TAG -> mk-dev-$SHA ==="
sudo sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=mk-dev-$SHA/" /opt/geo-foundry/mk-dev.env
sudo grep '^IMAGE_TAG=' /opt/geo-foundry/mk-dev.env

echo "=== deploy-mk-dev ==="
sudo env PATH="$PATH" make deploy-mk-dev

echo "=== docker ps ==="
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
echo "DEPLOY_DONE"
