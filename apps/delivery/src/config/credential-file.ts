/*
 * 只读凭据文件装配：约定与 apps/worker/src/config/credentials.ts 一致
 * （环境变量以 `<NAME>_FILE` 指向文件路径，文件内容即凭据，去首尾空白），
 * 但独立实现——两个 app 都在本批次的隔离范围内各自维护，不共享内部模块。
 *
 * 属主/权限校验与 worker 的差异：worker 在 `process.getuid` 缺失时一律判定
 * 为不安全（仅面向 Linux 容器部署）。交付服务这份实现把"非 POSIX 平台"和
 * "POSIX 平台但权限过松"分开处理——前者（如本机 Windows 开发机)跳过属主位
 * 校验，后者仍然拒绝——使同一份代码在 Windows 开发机上可测、在生产 Linux
 * 容器里仍然强制 owner-only（uid 匹配 + 0600 掩码）。真正的信任边界始终是
 * 部署层的只读 bind mount + 目录权限（deploy/ 由 B2 批次负责），这里只是
 * 应用层的防呆检查。
 */
import { readFileSync, statSync, type Stats } from "node:fs"

export class DeliveryCredentialError extends Error {
  override readonly name = "DeliveryCredentialError"

  constructor(readonly code: string) {
    super(code)
  }
}

const ownershipSecure = (metadata: Stats): boolean => {
  const ownerId = process.getuid?.()
  if (ownerId === undefined) {
    // 非 POSIX 平台（Windows 开发/测试机）：没有 uid/mode 语义可言，跳过。
    return true
  }
  return metadata.uid === ownerId && (metadata.mode & 0o077) === 0
}

/** 读取一份凭据文件：文件必须存在、属主安全（POSIX 平台）、内容非空。 */
export const readCredentialFile = (fileVariable: string, path: string): string => {
  let metadata: Stats
  try {
    metadata = statSync(path)
  } catch {
    throw new DeliveryCredentialError(`DELIVERY_CREDENTIAL_FILE_MISSING:${fileVariable}`)
  }
  if (!ownershipSecure(metadata)) {
    throw new DeliveryCredentialError(`DELIVERY_CREDENTIAL_FILE_INSECURE:${fileVariable}`)
  }
  let content: string
  try {
    content = readFileSync(path, "utf8").trim()
  } catch {
    throw new DeliveryCredentialError(`DELIVERY_CREDENTIAL_FILE_MISSING:${fileVariable}`)
  }
  if (content.length === 0) {
    throw new DeliveryCredentialError(`DELIVERY_CREDENTIAL_FILE_EMPTY:${fileVariable}`)
  }
  return content
}

/**
 * 解析一个凭据环境变量：只认 `<name>_FILE` 间接引用（与部署层的只读
 * bind mount 约定一致，见 deploy/compose.yaml 里其它服务的 `*_FILE` 用法）。
 * 不支持直传明文值——交付服务是新服务，不需要兼容旧的直传模式。
 */
export const requiredCredentialOf = (
  environment: Record<string, string | undefined>,
  name: string,
): string => {
  const fileVariable = `${name}_FILE`
  const path = environment[fileVariable]?.trim()
  if (path === undefined || path.length === 0) {
    throw new DeliveryCredentialError(`DELIVERY_CREDENTIAL_FILE_REQUIRED:${fileVariable}`)
  }
  return readCredentialFile(fileVariable, path)
}
