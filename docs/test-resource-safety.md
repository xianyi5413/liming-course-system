# 隔离测试资源安全规范

## 事故记录

2026-07-19 在承载正式教务系统的 Linux 服务器上运行了没有 CPU、内存、PID、tmpfs 和总时间限制的 P1A 故障注入回归测试。事故表现为宿主机 CPU 升高、网站与 SSH 不可用，最终通过阿里云控制台重启 ECS 恢复。

当前证据只支持以下结论：

- 事故类型是生产服务器资源耗尽导致的可用性事故；
- 触发操作是在正式业务服务器运行无资源上限的 P1A 故障注入测试；
- 最后完成的用例是 `killing Online Backup leaves no final target and cleanup recognizes residue`，直接卡点位于后续 VACUUM INTO 中断测试阶段附近；
- 没有证据把事故精确归因到某一个 VACUUM 用例或某一行代码；
- P2 的 48 项测试已先行正常完成，不是事故直接原因；系统日志也没有 OOM、lockup、EXT4、I/O 或磁盘写满证据；
- 没有挂载正式 Volume，也没有读取正式数据库；
- 正式数据库重启后的 `quick_check` 与 `foreign_key_check` 正常。

代码审计确认旧测试存在安全缺口：超时只拒绝 Promise 而不回收子进程、部分故障注入 worker 缺少 `finally`、IPC 断开未触发 worker 退出、writer 以 1ms 间隔无限提交、锁定测试入口使用没有总期限的 `spawnSync()`。同步 `VACUUM INTO` 执行期间 JavaScript 事件循环无法及时处理信号，因此父进程必须在宽限期后使用 `SIGKILL` 兜底。

## 测试分级

### A 类：安全功能验收

包括运行时能力、Online Backup 与 VACUUM INTO 正常快照、校验、目标保护、路径和权限、受限并发写入等功能测试。锁定 Docker 镜像默认只运行 `safe` profile。

A 类即使在承载正式业务的服务器运行，也必须使用下方全部资源限制，并且只能使用合成数据、镜像内代码和容器 tmpfs；不得挂载 Compose Volume、正式数据库或正式备份目录。

### B 类：故障注入、压力和进程生命周期测试

包括强杀 Online Backup/VACUUM worker、VACUUM 写入中断、父进程异常退出、SIGINT、IPC 断开、worker 硬超时、P1B 打包中断和大文件流式测试。

B 类不得在承载正式业务的服务器运行。它们只能在本地 Linux 虚拟机、GitHub Actions、独立临时测试 ECS 或其他无正式业务负载的环境运行。默认本地 `npm run test:p1a` 和 `npm run test:p1b` 会运行完整 profile。

## 安全验收容器命令

下面命令只运行已经在非生产环境构建并传入服务器的测试镜像。不得在正式业务服务器临时构建或拉取镜像。

P1A：

```bash
bash <<'P1A_SAFE'
set -u
CONTAINER_NAME='liming-p1a-safe-acceptance'
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM HUP
cleanup

set +e
timeout --signal=TERM --kill-after=10s 120s \
  docker run --name "$CONTAINER_NAME" --rm --init \
  --cpus=0.50 \
  --memory=384m \
  --memory-swap=384m \
  --memory-swappiness=0 \
  --pids-limit=64 \
  --blkio-weight=100 \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --stop-timeout=10 \
  --env P1A_TEST_PROFILE=safe \
  --env P1A_LOCKED_SUITE_TIMEOUT_MS=90000 \
  liming-p1a-test
status=$?
set -e
exit "$status"
P1A_SAFE
```

P1B：

```bash
bash <<'P1B_SAFE'
set -u
CONTAINER_NAME='liming-p1b-safe-acceptance'
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM HUP
cleanup

set +e
timeout --signal=TERM --kill-after=10s 120s \
  docker run --name "$CONTAINER_NAME" --rm --init \
  --cpus=0.50 \
  --memory=384m \
  --memory-swap=384m \
  --memory-swappiness=0 \
  --pids-limit=64 \
  --blkio-weight=100 \
  --network none \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=256m \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --stop-timeout=10 \
  --env P1B_TEST_PROFILE=safe \
  --env P1B_LOCKED_SUITE_TIMEOUT_MS=90000 \
  liming-p1b-test
status=$?
set -e
exit "$status"
P1B_SAFE
```

资源上限适配当前 1.8GiB ECS：最多 0.5 CPU、384MiB 内存且禁止额外 swap、64 个 PID、256MiB tmpfs、低块设备权重、单套测试 90 秒内部期限、容器 120 秒外部期限。`--init` 用于回收孤儿进程，固定容器名和 shell `trap` 保证成功、失败、Ctrl+C、SIGTERM 或 `timeout` 后都会执行清理。

若终端异常断开，可人工执行：

```bash
docker rm -f liming-p1a-safe-acceptance 2>/dev/null || true
docker rm -f liming-p1b-safe-acceptance 2>/dev/null || true
```

执行前后可只读确认没有测试容器残留：

```bash
docker ps -a --filter name=liming-p1a-safe-acceptance --filter name=liming-p1b-safe-acceptance \
  --format 'table {{.Names}}\t{{.Status}}'
```

在事故修复获得人工确认前，不应在正式服务器执行上述命令；文档仅定义后续可审核的安全边界。
