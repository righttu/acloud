import { DurableObject } from 'cloudflare:workers';
import { Files, DirectoryBackup, type DirectoryBackupRecord } from '@cloudflare/sandbox';
// 保留 SDK 规定的导出名，内部网关不接受公网路由。
export { DirectoryBackupGateway } from '@cloudflare/sandbox';
import { page } from './page';
import { samples, loadMcp } from './tickets';

type AcloudEnv = Env & { ACLOUD_SANDBOX_TOKEN?: string; ACLOUD_MCP_TOKEN?: string; MCP_URL?: string };
export interface AcloudInput { week: number; tickets: Record<string, unknown>[] }

export class AcloudSandbox extends DurableObject<AcloudEnv> {
  private queue: Promise<unknown> = Promise.resolve();
  // 手册 6.5：序列化分析、备份、恢复，避免归档时仍有写入。
  run(action: string, input?: AcloudInput): Promise<unknown> {
    const task = this.queue.then(() => this.perform(action, input));
    this.queue = task.catch(() => {});
    return task;
  }
  private stage = '';
  private async perform(action: string, input?: AcloudInput): Promise<unknown> {
    try { return await this.performInner(action, input); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('acloud-sandbox stage failed', this.stage, e);
      // 把失败阶段和原因带回页面，便于排查；不含密钥。
      throw new Error(`[${this.stage}] ${msg}`.slice(0, 500));
    }
  }
  private async performInner(action: string, input?: AcloudInput): Promise<unknown> {
    this.stage = '准备容器';
    const c = this.ctx.container!;
    if (!c) throw new Error('这个 Durable Object 没有绑定容器');
    const files = new Files(c);
    // 手册 6.5、9.x；https://developers.cloudflare.com/sandbox/reference/directory-backups/
    const backups = new DirectoryBackup(c, this.ctx.exports.DirectoryBackupGateway, { binding: 'BACKUPS', prefix: 'acloud-workspaces/' });
    const record = await this.ctx.storage.get<DirectoryBackupRecord>('backup');
    if (action === 'restore') {
      if (!record) return { error: '还没有备份，请先运行分析并备份。' };
      await c.destroy();
    }
    const cold = !c.running;
    const start = Date.now();
    // 手册 5.5、11：禁止公网出站，SDK 仅为备份对象添加特定内部路由，无 R2 凭据进入容器。
    // https://developers.cloudflare.com/containers/api/durable-object-container/#start
    this.stage = '启动容器';
    if (!c.running) c.start({ image: c.images['acloud-python'], enableInternet: false });
    await c.setInactivityTimeout(120_000);
    this.stage = '创建工作目录（等待容器就绪）';
    await files.mkdir('/workspace', { recursive: true });
    if (action === 'restore') {
      this.stage = '从备份恢复';
      await backups.restore(record!);
      const result = await (await files.readFile('/workspace/work/result.json')).json();
      return { restored: true, backup: record, result, elapsed_ms: Date.now() - start, cold_start: cold };
    }
    await files.mkdir('/workspace/work', { recursive: true });
    if (action === 'backup') {
      // 不以冷启动后的空目录覆盖有结果的备份；请先分析或恢复。
      this.stage = '检查分析结果（请先点「分析」）';
      await files.stat('/workspace/work/result.json');
      this.stage = '备份到 R2';
      const saved = await backups.backup({ dir: '/workspace/work', name: 'acloud-week-45' });
      await this.ctx.storage.put('backup', saved);
      if (record) await backups.delete(record);
      return { backup: saved };
    }
    this.stage = '写入工单';
    await files.writeFile('/workspace/work/tickets.json', JSON.stringify(input));
    this.stage = '运行 Python';
    // 固定 argv，不把工单或请求字段拼成命令。https://developers.cloudflare.com/sandbox/commands/run-python-code/
    const process = await c.exec(['timeout', '--kill-after=5', '30', 'python3', '/opt/acloud/analyze.py']);
    const out = await process.output();
    if (out.exitCode !== 0) throw new Error('Python 分析失败，退出码 ' + out.exitCode + '：' + new TextDecoder().decode(out.stderr).slice(-300));
    this.stage = '读取结果';
    const result = await (await files.readFile('/workspace/work/result.json')).json<Record<string, unknown>>();
    return { ...result, stdout: new TextDecoder().decode(out.stdout), cold_start: cold, elapsed_ms: Date.now() - start };
  }
}
function validate(value: unknown): AcloudInput {
  const v = value as AcloudInput;
  // 接受 45 或 "2026-W45" 两种写法（acloud-agent 传后者），内部统一为 45。
  if (v && (v.week as unknown) === '2026-W45') v.week = 45;
  if (!v || v.week !== 45 || !Array.isArray(v.tickets) || v.tickets.length > 1000) throw new Error('仅支持第 45 周，最多 1000 条工单');
  const ids = new Set();
  for (const t of v.tickets) {
    if (!t || !['created_at','customer','level','category','status'].every(k => typeof t[k] === 'string') || !Number.isFinite(Date.parse(String(t.created_at))) || !Number.isFinite(Number(t.sla_hours)) || Number(t.sla_hours) <= 0 || !Number.isInteger(t.id) || ids.has(t.id) || !(t.first_reply_at === null || typeof t.first_reply_at === 'string')) throw new Error('工单字段或编号不合法');
    const time = Date.parse(String(t.created_at));
    if (time < Date.parse('2026-11-02T00:00:00+08:00') || time >= Date.parse('2026-11-09T00:00:00+08:00')) throw new Error('工单不在第 45 周内');
    ids.add(t.id);
  }
  return v;
}
export default {
  async fetch(req: Request, env: AcloudEnv): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === 'GET' && path === '/') return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" } });
    if (!['/analyze','/demo','/backup','/restore'].includes(path) || req.method !== 'POST') return new Response('未找到', { status: 404 });
    if (!env.ACLOUD_SANDBOX_TOKEN) return Response.json({ error: '尚未配置访问令牌' }, { status: 503 });
    if (req.headers.get('Authorization') !== `Bearer ${env.ACLOUD_SANDBOX_TOKEN}`) return Response.json({ error: '需要访问令牌' }, { status: 401 });
    try {
      let input: AcloudInput | undefined;
      let source: string | undefined;
      if (path === '/analyze') {
        const text = await req.text();
        if (text.length > 2_000_000) return new Response('请求过大', { status: 413 });
        input = validate(JSON.parse(text));
      }
      if (path === '/demo') {
        input = validate({ week: 45, tickets: env.MCP_URL ? await loadMcp(env.MCP_URL, env.ACLOUD_MCP_TOKEN) : samples });
        source = env.MCP_URL ? 'MCP 第 45 周工单' : '内置少量示例，非完整 200 条数据';
      }
      const result = await env.SANDBOX.getByName('acloud-demo').run(path === '/backup' ? 'backup' : path === '/restore' ? 'restore' : 'analyze', input);
      return Response.json({ ...(result as object), source }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      console.error('acloud-sandbox operation failed', e);
      const detail = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      return Response.json({ error: '操作失败，不会自动降级为示例。', detail }, { status: 500 });
    }
  }
} satisfies ExportedHandler<AcloudEnv>;
