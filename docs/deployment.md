# 云端部署说明

## 当前建议路径

第一阶段先 Docker 化部署应用，并把数据目录挂载到 Docker volume。这样不会依赖本机 `F:\...` 路径，也便于备份和迁移。

第二阶段再迁移到 MySQL 或 PostgreSQL。当前后端使用 `node:sqlite` 的同步 API，MySQL 不是改一个连接串就能用，需要把数据库访问层抽出来，并处理 `ON CONFLICT`、`PRAGMA`、事务和返回值差异。

## 服务器准备

1. 准备一台云服务器，推荐 Ubuntu 22.04/24.04。
2. 安装 Docker 和 Docker Compose。
3. 放行安全组端口：`80`、`443`。
4. 域名解析添加 `A` 记录到服务器公网 IP，例如：
   - 主机记录：`course`
   - 记录类型：`A`
   - 记录值：服务器公网 IP

## 首次部署

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f app
```

浏览器打开服务器 IP。如果域名已经解析，也可以打开域名。

## 数据导入

本地 SQLite 数据不要放进 Git。上线前先备份：

```bash
npm run db:backup
```

把 `data/liming-local.sqlite` 上传到服务器，再放入容器的数据卷对应目录。更稳妥的做法是在服务器上临时启动容器后复制：

```bash
docker compose up -d
docker cp data/liming-local.sqlite liming-course-app:/app/data/liming-local.sqlite
docker compose restart app
```

## HTTPS

生产环境必须启用 HTTPS。可以用云厂商证书、宝塔/Nginx 面板，或在服务器上用 Certbot 申请 Let's Encrypt 证书。

证书放到：

```text
deploy/certs/fullchain.pem
deploy/certs/privkey.pem
```

然后按 `deploy/nginx.conf` 里的注释启用 443 配置，并重启：

```bash
docker compose restart nginx
```

## 备份

SQLite 阶段至少每天备份一次 `data/liming-local.sqlite`。建议服务器定时执行：

```bash
docker compose exec app npm run db:backup
```

备份文件需要定期复制到对象存储或另一台机器，不能只放在同一台服务器。

## MySQL 迁移说明

可以迁移到 MySQL，但需要做这些开发工作：

1. 新增数据库访问适配层，替换当前 `DatabaseSync` 直接调用。
2. 安装并接入 `mysql2`。
3. 把 SQLite 专用 SQL 改为 MySQL 语法：
   - `ON CONFLICT` 改为 `ON DUPLICATE KEY UPDATE`
   - `PRAGMA table_info` 改为 `INFORMATION_SCHEMA`
   - `INTEGER PRIMARY KEY`、`TEXT`、`REAL` 等类型重审
   - `lastInsertRowid` 改为 `insertId`
4. 增加 MySQL 建表迁移脚本。
5. 增加从 SQLite 导出并导入 MySQL 的迁移脚本。
6. 改造备份：MySQL 使用 `mysqldump` 或云数据库自动备份。

如果要多人在线长期使用，建议优先做数据库迁移，再正式开放外部用户。
