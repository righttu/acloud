import { OAuthProvider, type OAuthHelpers, AuthorizationError } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
interface Env { TICKETS_DB: D1Database; OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers; ACLOUD_MCP_TOKEN?: string }
const scopes = ['tickets:read','replies:write'];
const escape = (s: string) => s.replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
const page = (s: string) => '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>远帆工单</title><main>'+s+'</main></html>';
// requiredScopes 仅声明，每一个工具都在执行前检查实际 scope。
// https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/
function serve(request: Request, env: Env, ctx: ExecutionContext, granted: string[]) {
  return createMcpHandler(() => {
    const server = new McpServer({name:'acloud-mcp-s',version:'1.0.0'});
    const guard = (scope: string) => { if(!granted.includes(scope)) throw new Error('权限不足，需要 '+scope); };
    const result = (value: unknown) => ({content:[{type:'text' as const,text:JSON.stringify(value)}]});
    const rows = async (sql: string, args: (string|number)[] = []) => {guard('tickets:read');return (await env.TICKETS_DB.prepare(sql).bind(...args).all()).results;};
    server.registerTool('list_tickets',{description:'分页查询工单。第45周为2026-11-02至11-08，Asia/Shanghai。返回 {tickets:[工单], total, next_offset, as_of}，分析全部工单时循环读取 next_offset 直至 null。可按类别、状态、等级、客户精确筛选。',inputSchema:z.object({week:z.number().int().default(45),category:z.string().optional(),status:z.enum(['未回复','处理中','已解决']).optional(),level:z.enum(['VIP','普通']).optional(),customer:z.string().optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(200).default(50)})},async a=>{
      guard('tickets:read'); if(a.week!==45)return result({tickets:[],total:0,next_offset:null});
      const where=['created_at >= ?','created_at < ?'];const args:(string|number)[]=['2026-11-02','2026-11-09'];
      for(const k of ['category','status','level','customer'] as const)if(a[k]){where.push(k+' = ?');args.push(a[k]!);}
      const clause=where.join(' AND ');const total=await env.TICKETS_DB.prepare('SELECT count(*) AS n FROM tickets WHERE '+clause).bind(...args).first<number>('n')??0;
      const rows=await env.TICKETS_DB.prepare('SELECT * FROM tickets WHERE '+clause+' ORDER BY id LIMIT ? OFFSET ?').bind(...args,a.limit,a.offset).all();
      return result({tickets:rows.results,total,next_offset:a.offset+a.limit<total?a.offset+a.limit:null,timezone:'Asia/Shanghai',as_of:'2026-11-08T23:59:00+08:00'});
    });
    server.registerTool('get_ticket',{description:'按编号查工单及历史回复，例如1024。编号范围961–1160。返回 {ticket:{id,created_at,customer,level,channel,category,title,body,status,first_reply_at,sla_hours}, replies:[]}，ticket 为 null 代表不存在。',inputSchema:z.object({id:z.number().int()})},async({id})=>{guard('tickets:read');return result({ticket:await env.TICKETS_DB.prepare('SELECT * FROM tickets WHERE id=?').bind(id).first(),replies:(await env.TICKETS_DB.prepare('SELECT * FROM replies WHERE ticket_id=? ORDER BY id').bind(id).all()).results});});
    server.registerTool('search_tickets',{description:'按标题和正文关键词搜索，最多返回100条。返回 {tickets:[工单], count}。完整周报用 list_tickets。',inputSchema:z.object({query:z.string().min(1).max(100)})},async({query})=>{const t=await rows('SELECT * FROM tickets WHERE instr(title,?)>0 OR instr(body,?)>0 ORDER BY id LIMIT 100',[query,query]);return result({tickets:t,count:t.length});});
    server.registerTool('get_customer',{description:'按客户全名查等级、行业和客户经理，例如星河物流。返回 {customer:{name,level,industry,account_manager}}，不存在时 customer 为 null。',inputSchema:z.object({name:z.string()})},async({name})=>result({customer:(await rows('SELECT * FROM customers WHERE name=?',[name]))[0]??null}));
    server.registerTool('list_releases',{description:'查询版本发布时间及说明。返回 {releases:[{id,released_at,version,notes}]}。与工单增多时间重合不代表因果，需要进一步调查。',inputSchema:z.object({})},async()=>result({releases:await rows('SELECT * FROM releases ORDER BY released_at')}));
    // 调用方须先取得人工批准；request_id 防止重试产生重复回复。
    // 只新增回复记录，不改工单原始状态，演示可以反复运行。
    server.registerTool('submit_reply',{description:'需要 replies:write。仅在人工明确批准草稿后调用，填写批准人、工单号、正文和稳定唯一 request_id。仅记录模拟回复，不发邮件。相同 request_id 只能用于同一份回复。',inputSchema:z.object({ticket_id:z.number().int(),body:z.string().trim().min(1).max(10000),approver:z.string().trim().min(1).max(100),request_id:z.string().min(8).max(100)})},async a=>{
      guard('replies:write');const db=env.TICKETS_DB;
      if(!await db.prepare('SELECT id FROM tickets WHERE id=?').bind(a.ticket_id).first())throw new Error('工单不存在');
      const old=await db.prepare('SELECT * FROM replies WHERE request_id=?').bind(a.request_id).first();
      if(old&&(old.ticket_id!==a.ticket_id||old.body!==a.body||old.approver!==a.approver))throw new Error('request_id 已用于不同的回复');
      await db.prepare('INSERT INTO replies(ticket_id,body,approver,sent_at,request_id) VALUES(?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING').bind(a.ticket_id,a.body,a.approver,new Date().toISOString(),a.request_id).run();
      return result({simulated:true,reply:await db.prepare('SELECT * FROM replies WHERE request_id=?').bind(a.request_id).first()});
    });return server;
  },{allowedHostnames:['acloud-mcp-s.righttu.uk'],allowedOriginHostnames:['acloud-mcp-s.righttu.uk','acloud-mcp-p.righttu.uk'],legacy:'stateless'})(request,env,ctx);
}
// 单 Worker OAuth 2.1 + DCR，使用官方浏览器绑定 consent handle 防 CSRF。
// https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/
// https://github.com/cloudflare/workers-oauth-provider/blob/main/docs/consent-page.md
const provider = new OAuthProvider<Env>({
  apiRoute:'/mcp',apiHandler:{fetch(request,env,ctx){return serve(request,env,ctx,(ctx as ExecutionContext & { auth: { scope: string[] } }).auth.scope);}},
  authorizeEndpoint:'/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
  scopesSupported:[...scopes,'offline_access'],requiredScopes:['tickets:read'],clientIdMetadataDocumentEnabled:true,
  resourceMetadata:{resource:'https://acloud-mcp-s.righttu.uk/mcp',authorization_servers:['https://acloud-mcp-s.righttu.uk']},
  defaultHandler:{async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/')return new Response(page('<h1>远帆工单系统</h1><p>虚构客服场景，200条工单，编号961–1160，第45周，Asia/Shanghai。</p><p>MCP 地址：/mcp。支持 OAuth 和程序侧 Bearer 认证。</p><p>工具：list_tickets、get_ticket、search_tickets、get_customer、list_releases、submit_reply。</p><p>授权页为角色自选演示，不是真实身份验证。回复只写数据库，不发邮件。</p>'),{headers:{'Content-Type':'text/html; charset=utf-8'}});
    if(url.pathname!=='/authorize')return new Response('未找到',{status:404});
    const oauth=env.OAUTH_PROVIDER;
    try {
      if(request.method==='GET'){
        const auth=await oauth.parseAuthRequest(request),details=await oauth.describeConsent(auth),consent=await oauth.beginConsent(auth);
        consent.headers.set('Content-Type','text/html; charset=utf-8');
        return new Response(page(`<h1>远帆演示授权</h1><p>仅模拟身份，请勿用于真实客户数据。</p><p>客户端：${escape(details.clientName)}，${details.clientDomain?escape(details.clientDomain):'名称由客户端自报，未经验证'}。</p><p>回调主机：${escape(details.redirectHost)}</p>${details.redirectIsLoopback?'<p>将授权给本机程序，请确认由你发起。</p>':''}<p>请求权限：${escape(details.scope.join(' '))}。客服专员授予 tickets:read；客服主管额外授予 replies:write。</p><form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}"><select name="role"><option value="reader">客服专员（只读）</option><option value="manager">客服主管（读写）</option></select><button name="decision" value="approve">批准授权</button><button name="decision" value="deny">拒绝</button></form>`),{headers:consent.headers});
      }
      if(request.method!=='POST')return new Response('方法不支持',{status:405});
      const form=await request.formData(),handle=String(form.get('handle'));
      if(form.get('decision')!=='approve'){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
      const granted=form.get('role')==='manager'?scopes:['tickets:read'];
      const approved=await oauth.approveConsent(request,handle,{scope:granted});
      const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:crypto.randomUUID(),metadata:{demo:true},scope:approved.request.scope,props:{demo:true}});
      approved.headers.set('Location',redirectTo);return new Response(null,{status:302,headers:approved.headers});
    }catch(error){if(error instanceof AuthorizationError)return new Response('授权无效或已过期，请从客户端重新开始。',{status:400});throw error;}
  }}
});
export default {fetch(request: Request,env: Env,ctx: ExecutionContext){
  // 静态密钥只在服务器端匹配，绝不进入工具输出或模型上下文。
  if(new URL(request.url).pathname==='/mcp' && env.ACLOUD_MCP_TOKEN && request.headers.get('Authorization')===`Bearer ${env.ACLOUD_MCP_TOKEN}`)return serve(request,env,ctx,scopes);
  return provider.fetch(request,env,ctx);
}};
