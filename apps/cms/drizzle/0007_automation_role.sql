/* users_role 枚举新增 automation：外部 AI/自动化工具的投稿身份。
 *
 * 不可逆：PostgreSQL 不支持从枚举中删除值。此迁移之前回滚镜像即可，
 * 之后回滚必须恢复数据库备份。
 *
 * 事务安全性：PostgreSQL 12+ 允许在事务块内 ADD VALUE，限制是同一事务内
 * 不得引用新值。本迁移只加值、不引用，且后续迁移不使用该值，故安全。
 */

ALTER TYPE "geo_foundry"."enum_users_role" ADD VALUE IF NOT EXISTS 'automation';
