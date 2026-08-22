# Runbook：evidence 收集与验证

## 公共、无密钥 evidence

使用一次性 attempt 目录；路径必须在 `.omo/evidence/<attempt>` 下：

```sh
pnpm test:harness -- --fresh --seed 260817 --output-dir .omo/evidence/<attempt>
pnpm evidence:verify -- --output-dir .omo/evidence/<attempt>
```

`evidence:verify` 验证 manifest、required reports、hash、mtime、test seed、provenance 与 parent receipt。缺失报告、cache-only 执行、路径 traversal、symlink、receipt 篡改或内容 hash 不匹配都会失败。

`pnpm ci:verify` 会生成 `.omo/evidence/ci-<attempt>/evidence-manifest.json` 及 `.omo/evidence/.receipts/ci-<attempt>.json`；两者共同构成权威完整性链。

## E2E / fault evidence

`pnpm test:e2e` 和 `pnpm test:faults` 只在批准共享服务 runner 运行。证据只能写入 caller-provided 或忽略目录，且不得包含 credential value。上传 artifact 前确认路径不包含 `.env`、credential 文件、local volumes、`.zcode` 或 build caches。

## 故障处理

- `EVIDENCE_PATH_*`：使用工作区内、非 symlink 的 `.omo/evidence/<attempt>` 路径。
- `EVIDENCE_REPORT_MISSING`：不要伪造 report；重新执行缺失的 direct command。
- receipt mismatch：删除该失败 attempt 并使用新的 attempt name；不要覆盖既有 receipt。
- artifact 含敏感信息：停止上传，限制 artifact 访问，移除泄露源并重新执行。
