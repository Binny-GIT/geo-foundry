#!/usr/bin/env bash
# 0b 部署：git pull + 构建 mk-dev-404f0ce 镜像 + 更新 IMAGE_TAG + 部署 + 健康检查
set -euo pipefail
cd /home/ubuntu/project/Binny-GIT/geo-foundry
export PATH="/home/ubuntu/.n/bin:$PATH"

git pull --ff-only origin main
TAG="mk-dev-$(git rev-parse --short HEAD)"
echo "=== building image ${TAG} ==="
make image-build

echo "=== updating IMAGE_TAG ==="
sudo sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" /opt/geo-foundry/mk-dev.env
sudo grep '^IMAGE_TAG=' /opt/geo-foundry/mk-dev.env

echo "=== deploy ==="
sudo env PATH="$PATH" make deploy-mk-dev
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep geo-foundry
