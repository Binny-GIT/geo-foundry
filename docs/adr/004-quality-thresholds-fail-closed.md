# ADR 004：质量阈值与 fail-closed 发布

- **状态**：已采纳
- **日期**：2026-08-22

## 决策

质量决策由确定性规则、语义相似度和 LLM 评价组成。每层产出的输入 hash、模型/阈值、issue 与 aggregate decision 都会被持久化。除显式 `passed` 外，所有缺失、provider 超时、embedding dimension 不匹配、不可解释的 LLM 返回或阈值失败都阻止批准/发布。

生成只写入可审查 draft；evaluate 是独立 operation；reviewer 显式批准后，publisher 才能触发编译和发布。Worker 不能用生成阶段的成功替代质量通过。

## 后果

- 质量 provider 的不确定性不会使 release 进入 partial 或 unknowable 状态。
- 测试替身必须确定性，且质量回归可以在公共 CI 运行而不调用付费外部 provider。
- publish gate 遇到确定性编译或 CAS 错误时写入可审计 terminal failure；临时 storage 错误仍可重试。

## 实现依据

- `packages/quality-rules/`
- `packages/content-pipeline/src/evaluation/`
- `apps/worker/src/processors/pipeline-processors.ts`
- `apps/worker/src/processors/triggers.ts`
