# 数据库备份、迁移与恢复流程

当前系统运行在本地 SQLite：`data/liming-local.sqlite`。正式上云前建议先保留 SQLite 备份流程，再决定云数据库目标。如果要迁到 PostgreSQL，需要同时改造服务端数据访问层；本仓库已提供数据导出脚本，便于迁移演练。

## 备份

```powershell
npm run db:backup
```

脚本会用 SQLite `VACUUM INTO` 生成一致性备份，输出到 `data/backups/manual_YYYYMMDDHHMMSS.sqlite`，并生成同名 `.json` 记录来源与时间。

## 导出迁移数据

导出 JSON：

```powershell
npm run db:export-json
```

生成 PostgreSQL 导入 SQL：

```powershell
npm run db:export-postgres
```

SQL 会输出到 `data/migrations/postgres_import_YYYYMMDDHHMMSS.sql`。上线前需要在测试库执行一遍，检查字段类型、主键、自增序列和索引。

## 恢复本地 SQLite

恢复会覆盖当前数据库。执行前先停止 Node 服务。

```powershell
node scripts/restore_sqlite_backup.js data/backups/manual_YYYYMMDDHHMMSS.sqlite
```

脚本会先把当前数据库复制到 `data/backups/pre_restore_YYYYMMDDHHMMSS.sqlite`，再替换为指定备份。

## 迁到云数据库的建议步骤

1. 在本地执行 `npm run db:backup`，保留迁移前备份。
2. 执行 `npm run db:export-json` 和 `npm run db:export-postgres`。
3. 在云端创建 PostgreSQL 测试库，导入生成的 SQL。
4. 校验关键表数量：课程、充值、学生、老师、账号、教师车票。
5. 改造服务端数据库适配层，把 `node:sqlite` 替换为 PostgreSQL 客户端，并把 SQL 占位符从 `?` 改成 `$1/$2` 风格。
6. 灰度上线：先只读访问云库，再开放写入。
7. 正式切换前再次备份 SQLite，导入云库，冻结本地写入。

生产环境必须额外配置：HTTPS、强密码策略、定期自动备份、数据库访问白名单、日志审计和恢复演练。
