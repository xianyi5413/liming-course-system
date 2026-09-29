'use strict';

const DataWorkflows = (() => {
  let running = null, generation = 0;
  function resetSession() { generation++; running = null; backupState.task = null; backupState.busy = false; }
  function markup() {
    const task = backupState.task;
    if (!task) return '';
    const percent = Math.max(0, Math.min(100, Number(task.progress) || 0));
    return `<section class="band task-progress" role="status" aria-live="polite"><div>${escapeHtml(task.message || '任务已创建')} <strong>${percent}%</strong></div><progress max="100" value="${percent}" aria-label="数据处理进度"></progress><div class="muted-tip">${escapeHtml(formatBeijingTime(task.updated_at || task.started_at))}</div>${task.status === 'success' && task.kind === 'export' ? `<a class="btn" href="/api/data-center/jobs/${task.job_id}/download">导出完成，点击下载</a>` : ''}</section>`;
  }
  function repaint() { if (view === 'audit' && auth.user) render(); }
  function upload(file, current) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/data-center/jobs/preview'); xhr.responseType = 'json';
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && current()) {
          backupState.task = { kind: 'preview', status: 'running', stage: 'upload', progress: Math.floor(event.loaded / event.total * 10), message: '正在上传', updated_at: new Date().toISOString() }; repaint();
        }
      };
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(xhr.response?.error || '上传失败'));
      xhr.onerror = () => reject(new Error('上传连接失败，请重试'));
      const form = new FormData(); form.append('file', file, file.name); xhr.send(form);
    });
  }
  function run(kind, payload = {}, file = null) {
    if (running) return running;
    const owner = auth.user?.id;
    const started = generation, current = () => generation === started && auth.user?.id === owner;
    backupState.busy = true;
    backupState.task = { kind, status: 'pending', progress: 0, message: kind === 'preview' ? '准备上传' : '正在创建任务', updated_at: new Date().toISOString() }; repaint();
    running = (async () => {
      try {
        let job = file ? await upload(file, current) : await request('/api/data-center/jobs/' + kind, { method: 'POST', body: payload });
        while (true) {
          if (!current()) throw new Error('账号已切换，后台任务将继续执行');
          backupState.task = file ? { ...job, progress: Math.max(10, job.progress) } : job; repaint();
          if (job.status === 'success') return job;
          if (job.status === 'failed') throw new Error(job.error?.message || job.message || '后台任务失败');
          await new Promise(resolve => setTimeout(resolve, 400));
          const response = await fetch('/api/data-center/jobs/' + job.job_id, { cache: 'no-store', headers: { 'X-Task-Receipt': job.receipt } });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '任务状态读取失败，后台任务可能仍在执行');
          job = data;
        }
      } catch (error) {
        if (current()) backupState.task = { ...backupState.task, status: 'failed', message: error.message };
        throw error;
      } finally {
        if (current()) { running = null; backupState.busy = false; repaint(); }
      }
    })();
    return running;
  }
  return { markup, run, resetSession };
})();
