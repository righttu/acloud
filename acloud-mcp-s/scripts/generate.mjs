// 远帆软件第 45 周模拟工单（示意数据）。固定种子，结果可复现。
// 运行：node scripts/generate.mjs  → 重写 migrations/0001_seed.sql
// 设计（演示时可核对，scripts/verify.mjs 会逐条校验）：
//   - 200 条工单，编号 961–1160，按提交时间递增；时间均为 Asia/Shanghai（+08:00）。
//   - 线索一：周二 22:00 发布 v3.8.0 后，「登录失败」从周三起明显增多（每天 2/2/12/11/9/6/5）。只是时间重合，因果待查。
//   - 线索二：恰好 3 张 VIP 工单超过 4 小时承诺时限仍未回复：1024（晨光制造，周三）、周四海川零售、周五北辰金融。
//   - 线索三：「星河物流」一周 4 张工单（都和同一张发票有关），其余客户每周最多 2 张。
//   - 1024 号：晨光制造（VIP）周三 08:41 的登录失败工单，发布后的第二张工单。
import { writeFileSync } from 'node:fs';

export const AS_OF = '2026-11-08T23:59:00+08:00';
export const FIRST_ID = 961;

export function generate() {
  let seed = 20261102;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const q = (v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replaceAll("'", "''") + "'");
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (ms) => { const d = new Date(ms + 8 * 3600e3); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':00+08:00'; };
  const at = (day, h, m) => Date.parse('2026-11-' + pad(2 + day) + 'T' + pad(h) + ':' + pad(m) + ':00+08:00');
  const asOf = Date.parse(AS_OF);
  const release = Date.parse('2026-11-03T22:00:00+08:00');

  // ---- 客户：20 家 VIP，其余为普通客户 ----
  const prefixes = ['远山', '海川', '青禾', '晨光', '云帆', '北辰', '南峰', '东岳', '西岭', '金桥', '银杉', '明德', '华章', '恒信', '安途', '博远', '嘉禾', '锦程', '立方', '启明', '瑞丰', '盛达', '泰和', '万象', '新航', '翠湖', '长风', '朗星'];
  const suffixes = [['科技', '软件'], ['零售', '零售'], ['教育', '教育'], ['制造', '制造'], ['医疗', '医疗'], ['物流', '物流'], ['传媒', '传媒'], ['金融', '金融']];
  const managers = ['李静', '王磊', '陈晨', '赵敏', '周航', '吴悦'];
  const customers = new Map();
  const addCustomer = (name, level, industry) => customers.set(name, { name, level, industry, account_manager: managers[customers.size % managers.length], count: 0 });
  addCustomer('星河物流', '普通', '物流');
  for (const [n, i] of [['晨光制造', '制造'], ['海川零售', '零售'], ['北辰金融', '金融'], ['远山科技', '软件'], ['明德教育', '教育'], ['恒信医疗', '医疗'], ['锦程物流', '物流'], ['华章传媒', '传媒'], ['瑞丰制造', '制造'], ['泰和金融', '金融'], ['启明科技', '软件'], ['万象零售', '零售'], ['金桥金融', '金融'], ['安途物流', '物流'], ['博远科技', '软件'], ['嘉禾医疗', '医疗'], ['立方制造', '制造'], ['盛达零售', '零售'], ['新航传媒', '传媒'], ['长风教育', '教育']]) addCustomer(n, 'VIP', i);
  for (const p of prefixes) for (const [s, ind] of suffixes) { const n = p + s; if (!customers.has(n)) addCustomer(n, '普通', ind); }
  const vipNames = [...customers.values()].filter((c) => c.level === 'VIP').map((c) => c.name);
  const normalNames = [...customers.values()].filter((c) => c.level === '普通' && c.name !== '星河物流').map((c) => c.name);

  // ---- 文本模板 ----
  const T = {
    '登录失败_前': [['重置密码邮件收不到', '员工{u}申请重置密码，等了半小时没有收到邮件，垃圾箱也没有。'], ['新员工账号无法登录', '新入职同事的账号提示「用户不存在」，管理员后台能看到这个账号。']],
    '登录失败_后': [['登录后反复跳回登录页', '今天开始，我们多名员工输入账号密码后又被跳回登录页，清缓存也不行。'], ['提示「会话已过期」', '刚登录进去几秒就提示会话已过期，需要重新登录，反复多次。'], ['SSO 登录失败', '通过企业 SSO 登录时报错 401，之前一直正常，影响{n}个人。'], ['移动端无法保持登录', '手机端每次切到后台再回来就要求重新登录，最近才出现。'], ['登录页一直转圈', '点击登录后一直转圈，过一会儿提示网络错误，但其他网站正常。']],
    '账单疑问': [['发票金额与合同不符', '本月发票金额比合同多了一部分，请核对计费明细。'], ['自动续费扣款疑问', '没有收到续费提醒就被扣款了，想确认续费周期。'], ['座席数计费不对', '我们只开通了{n}个座席，账单按更多座席计费。']],
    '数据导出': [['导出 Excel 中文乱码', '导出的报表用 Excel 打开中文是乱码。'], ['导出任务一直排队', '发起导出两个小时了还在排队中。'], ['导出数据缺少字段', '导出的客户列表里没有「最近联系时间」字段。']],
    '性能慢': [['报表页面加载很慢', '打开月度报表要等一分钟以上，以前十几秒。'], ['搜索响应慢', '在工单列表里搜索客户名要等很久。']],
    '权限配置': [['如何设置只读角色', '想给外部审计人员开一个只读账号，不知道怎么配。'], ['子管理员看不到部门数据', '给部门主管设了子管理员，但他看不到本部门的数据。']],
    '功能建议': [['希望支持批量编辑', '希望工单可以批量修改负责人。'], ['希望增加深色模式', '员工晚上值班，希望界面有深色模式。'], ['希望开放 Webhook', '希望工单状态变化时能推送到我们的系统。']],
    '集成对接': [['API 调用返回 429', '我们的同步脚本调用 API 经常返回 429，想了解限额。'], ['企业微信集成收不到通知', '绑定企业微信后收不到工单提醒。'], ['钉钉单点登录配置', '想把钉钉作为身份源，求配置文档。']],
  };
  const fill = (s) => s.replace('{u}', pick(['张伟', '刘洋', '孙丽', '马超'])).replace('{n}', String(10 + Math.floor(rnd() * 60)));
  const otherCats = ['账单疑问', '账单疑问', '数据导出', '数据导出', '性能慢', '权限配置', '功能建议', '集成对接', '集成对接'];

  // ---- 每天的工单量与登录失败数 ----
  const perDay = [32, 30, 34, 32, 30, 22, 20]; // 合计 200
  const loginPerDay = [2, 2, 12, 11, 9, 6, 5]; // 合计 47
  const planted = [
    { key: 'xh1', day: 0, h: 10, m: 12, customer: '星河物流', category: '账单疑问', title: '发票金额与合同不符', body: '十月发票金额比合同多了 2,400 元，请核对计费明细。' },
    { key: 'xh2', day: 1, h: 15, m: 30, customer: '星河物流', category: '账单疑问', title: '发票问题还没解决', body: '昨天反馈的发票金额问题还没有结论，财务月底要结账。' },
    { key: 'xh3', day: 3, h: 11, m: 5, customer: '星河物流', category: '数据导出', title: '导出的对账单缺少十月数据', body: '为了核对发票，我们导出对账单，结果缺少十月的记录。' },
    { key: 'xh4', day: 5, h: 16, m: 40, customer: '星河物流', category: '账单疑问', title: '第三次反馈：发票仍未更正', body: '这是本周第三次反馈发票问题，希望有专人跟进并给出处理时间。' },
    { key: 'vip1024', day: 2, h: 8, m: 41, customer: '晨光制造', category: '登录失败', title: '登录后反复跳回登录页', body: '今天早上开始，我们车间主管登录后马上又跳回登录页，影响早班交接，请尽快处理。', overdue: true },
    { key: 'vip2', day: 3, h: 14, m: 20, customer: '海川零售', category: '数据导出', title: '导出任务一直排队', body: '门店销售数据导出排队三个小时了，下午要给区域经理汇报。', overdue: true },
    { key: 'vip3', day: 4, h: 10, m: 5, customer: '北辰金融', category: '账单疑问', title: '自动续费扣款疑问', body: '没有收到续费提醒就被扣款了，需要今天给财务一个说明。', overdue: true },
    // 周三 08:41 之前只有这一张，保证 1024 号是周三第二张
    { key: 'wed1', day: 2, h: 8, m: 12, category: '登录失败' },
  ];
  const drafts = planted.map((p) => ({ ...p, ms: at(p.day, p.h, p.m) }));
  for (let day = 0; day < 7; day++) {
    const already = drafts.filter((d) => d.day === day);
    const logins = loginPerDay[day] - already.filter((d) => d.category === '登录失败').length;
    const total = perDay[day] - already.length;
    const weekend = day >= 5;
    for (let i = 0; i < total; i++) {
      const isLogin = i < logins;
      let ms;
      do {
        let h = weekend ? 9 + Math.floor(rnd() * 11) : 8 + Math.floor(rnd() * 14);
        if (day === 1 && isLogin) h = 9 + Math.floor(rnd() * 10); // 周二的登录问题都在发布之前
        ms = at(day, h, Math.floor(rnd() * 60));
      } while ((day === 2 && ms <= at(2, 8, 41)) || drafts.some((d) => d.ms === ms));
      drafts.push({ day, ms, category: isLogin ? '登录失败' : pick(otherCats) });
    }
  }
  drafts.sort((a, b) => a.ms - b.ms);

  // ---- 分配客户与文本 ----
  for (const p of planted) if (p.customer) customers.get(p.customer).count++;
  const reserved = new Set(['晨光制造', '海川零售', '北辰金融']);
  const takeCustomer = (wantVip) => {
    let pool = (wantVip ? vipNames : normalNames).filter((n) => customers.get(n).count < 2 && !reserved.has(n));
    if (pool.length === 0) pool = normalNames.filter((n) => customers.get(n).count < 2);
    const n = pick(pool);
    customers.get(n).count++;
    return n;
  };
  const rows = [];
  drafts.forEach((d, idx) => {
    const id = FIRST_ID + idx;
    const customer = d.customer || takeCustomer(rnd() < 0.12);
    const level = customers.get(customer).level;
    let title = d.title, body = d.body;
    if (!title) {
      const key = d.category === '登录失败' ? (d.ms > release ? '登录失败_后' : '登录失败_前') : d.category;
      const [t, b] = pick(T[key]);
      title = t;
      body = fill(b);
    }
    const sla = level === 'VIP' ? 4 : 24;
    let first = null, status = '未回复';
    if (!d.overdue) {
      const delayH = level === 'VIP' ? 0.3 + rnd() * 3.2 : 1 + rnd() * 19;
      const reply = d.ms + delayH * 3600e3;
      if (reply <= asOf) {
        first = fmt(reply);
        status = asOf - d.ms > 36 * 3600e3 && rnd() < 0.75 ? '已解决' : '处理中';
      }
    }
    if (d.key && d.key.startsWith('xh')) status = d.key === 'xh4' ? '处理中' : '已解决';
    rows.push([id, fmt(d.ms), customer, level, pick(['电话', '邮件', '在线']), d.category, title, body, status, first, sla]);
  });

  let sql = '-- 自动生成：node scripts/generate.mjs（固定种子，示意数据，请勿手改）\n';
  sql += 'CREATE TABLE customers(name TEXT PRIMARY KEY, level TEXT NOT NULL, industry TEXT NOT NULL, account_manager TEXT NOT NULL);\n';
  sql += 'CREATE TABLE tickets(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, customer TEXT NOT NULL REFERENCES customers(name), level TEXT NOT NULL, channel TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, first_reply_at TEXT, sla_hours INTEGER NOT NULL);\n';
  sql += 'CREATE TABLE releases(id INTEGER PRIMARY KEY, released_at TEXT NOT NULL, version TEXT NOT NULL, notes TEXT NOT NULL);\n';
  sql += 'CREATE TABLE replies(id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id), body TEXT NOT NULL, approver TEXT NOT NULL, sent_at TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE);\n';
  sql += 'CREATE INDEX tickets_filters ON tickets(created_at,category,status);\n';
  sql += "INSERT INTO releases VALUES(1,'2026-11-03T22:00:00+08:00','v3.8.0','登录组件升级：调整会话令牌刷新逻辑，新增企业 SSO 配置项');\n";
  for (const c of customers.values()) if (c.count > 0 || c.level === 'VIP') sql += 'INSERT INTO customers VALUES(' + [c.name, c.level, c.industry, c.account_manager].map(q).join(',') + ');\n';
  for (const r of rows) sql += 'INSERT INTO tickets VALUES(' + r.map(q).join(',') + ');\n';
  return { sql, rows };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  writeFileSync(new URL('../migrations/0001_seed.sql', import.meta.url), generate().sql);
  console.log('已生成 migrations/0001_seed.sql');
}
