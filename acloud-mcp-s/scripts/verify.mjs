// 校验模拟数据：三条线索与 1024 号工单必须严格成立，迁移文件必须与生成脚本一致。
import { generate, AS_OF, FIRST_ID } from './generate.mjs';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { sql, rows } = generate();
const t = rows.map((r) => ({ id: r[0], at: r[1], customer: r[2], level: r[3], category: r[5], status: r[8], first: r[9], sla: r[10] }));
assert.equal(readFileSync(new URL('../migrations/0001_seed.sql', import.meta.url), 'utf8'), sql, '迁移必须与生成脚本一致，请运行 npm run seed');
assert.equal(t.length, 200);
assert.deepEqual(t.map((x) => x.id), Array.from({ length: 200 }, (_, i) => FIRST_ID + i));
for (let i = 1; i < t.length; i++) assert.ok(Date.parse(t[i].at) >= Date.parse(t[i - 1].at), '编号按提交时间递增');
// 线索一：登录失败按天
const login = Array.from({ length: 7 }, (_, d) => t.filter((x) => x.at.startsWith('2026-11-' + String(d + 2).padStart(2, '0')) && x.category === '登录失败').length);
assert.deepEqual(login, [2, 2, 12, 11, 9, 6, 5]);
// 线索二：超时未回复的恰好 3 张，全是 VIP
const asOf = Date.parse(AS_OF);
const overdue = t.filter((x) => x.first === null && asOf - Date.parse(x.at) > x.sla * 3600e3);
assert.deepEqual(overdue.map((x) => x.id), [1024, 1074, 1091]);
assert.ok(overdue.every((x) => x.level === 'VIP'));
for (const x of t) if (x.first) assert.ok(Date.parse(x.first) - Date.parse(x.at) <= x.sla * 3600e3, '已回复的都在时限内');
// 线索三：星河物流 4 张，其他客户最多 2 张
const counts = {};
for (const x of t) counts[x.customer] = (counts[x.customer] || 0) + 1;
assert.equal(counts['星河物流'], 4);
assert.ok(Object.entries(counts).every(([k, v]) => k === '星河物流' || v <= 2));
// 1024 号
const s = t.find((x) => x.id === 1024);
assert.deepEqual([s.customer, s.level, s.category, s.at], ['晨光制造', 'VIP', '登录失败', '2026-11-04T08:41:00+08:00']);
console.log('模拟数据核验通过', JSON.stringify({ login, overdue: overdue.map((x) => x.id), 星河物流: counts['星河物流'] }));
