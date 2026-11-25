import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startClubSystem } from './club-test-system.mjs';

test('提现在实付登记时扣账，审批、分次付款和双实例重试共享同一笔申请', { timeout: 120000 }, async t => {
  const { api, administrator, login, register, seedClub, runCommand, startPeer, restartServer } =
    await startClubSystem(t, { database: 'club_withdrawal_e2e', adminUsername: 'withdrawal_leader' });
  const leader = await login('employee', 'withdrawal_leader');
  const member = await register('withdrawal_sender', 'employee');
  const deputy = await register('withdrawal_deputy', 'employee');
  const finance = await register('withdrawal_finance', 'admin');
  const customer = await register('withdrawal_customer', 'client');
  await runCommand('dist/src/commands/club.js', 'init-leader', leader.id);
  await seedClub('member', leader.id, 'active', 'dispatcher');
  for (const actor of [member, deputy, finance]) await seedClub('member', actor.id, 'active', 'member');
  await seedClub('position', deputy.id, 'deputy');
  await seedClub('grant', finance.id, 'CLUB_FINANCE_READ');
  const call = (app, actor, path, body, method = body ? 'POST' : 'GET', status = method === 'POST' ? 201 : 200, server) =>
    api(app, '/' + app + path, { token: actor.token, body, method, status, server });
  const employee = (actor, path, ...args) => call('employee', actor, '/club' + path, ...args);
  const admin = (actor, path, ...args) => call('admin', actor, '/club' + path, ...args);
  const balance = () => employee(member, '/balance');
  const peer = await startPeer();

  // A completed 50-gift order pays this member exactly 20 yuan.
  await admin(administrator, '/commission-rule', { expectedVersion: 0, clubFeeCents: 5 }, 'PATCH');
  const order = await call('client', customer, '/orders', { requestId: randomUUID(), dispatcherUserId: leader.id,
    recipientGameAccount: '提现验收', requestedGiftTimes: 50 });
  const path = '/orders/' + order.id;
  await employee(leader, path + '/pricing', { expectedRevision: 0, ruleVersion: 1, dispatchFeeCents: 5,
    giftSegments: [{ period: 'normal', paidGiftTimes: 50, dailyGiftTimes: 50, unitPriceCents: 50 }] }, 'PATCH');
  await employee(leader, path + '/receipts', { requestId: randomUUID(), pricingRevision: 1,
    receivedAmountCents: 2500, receivedAt: '2026-11-01T00:00:00+08:00' });
  await employee(leader, path + '/publish', { requestId: randomUUID(), pricingRevision: 1, ruleVersion: 1,
    commissionReviewRevision: 0, giftDispatchSegments: [{ segmentIndex: 0, startDate: '2026-11-02',
      endDate: '2026-11-02', openToClaim: true, directed: [] }] });
  await call('employee', member, '/songxinhao', { name: '提现测试送心号' });
  const [account] = await call('employee', member, '/songxinhao/linkable');
  const { shareId } = await employee(member, '/gift-claims/' + order.id, {
    requestId: randomUUID(), kind: 'public', segmentIndex: 0, dailyGiftTimes: 50 });
  const accounts = path + '/shares/' + shareId + '/execution-accounts';
  const linked = await employee(member, accounts, { personalAccountId: account.id });
  await employee(member, accounts + '/' + linked.id + '/daily-reports', { requestId: randomUUID(), kind: 'daily',
    businessDate: '2026-11-02', lines: [{ giftTimes: 50, period: 'normal', receivedHearts: 50 }] });
  const settlement = await admin(finance, path + '/settlement');
  await employee(leader, path + '/settlement/close', { requestId: randomUUID(), calculationId: settlement.finalCalculation.id });
  const teamBefore = await admin(finance, '/balance');
  assert.equal((await balance()).balanceCents, 2000);

  const withdrawals = '/withdrawals';
  const competing = await Promise.all([undefined, peer].map(server =>
    employee(member, withdrawals, { requestId: randomUUID(), amountCents: 1500 }, 'POST', [201, 409], server)));
  const accepted = competing.filter(Boolean);
  assert.equal(accepted.length, 1);
  const rejected = await employee(leader, withdrawals + '/' + accepted[0].id + '/decision', { decision: 'rejected' }, 'PATCH');
  assert.equal(rejected.status, 'rejected');
  assert.equal((await balance()).balanceCents, 2000);
  const request = { requestId: randomUUID(), amountCents: 2000 };
  const [one, two] = await Promise.all([undefined, peer].map(server => employee(member, withdrawals, request, 'POST', 201, server)));
  assert.deepEqual(one, two);
  assert.equal(one.status, 'pending');
  assert.deepEqual((await employee(member, withdrawals)).items.filter(row => row.status === 'pending').map(row => row.id), [one.id]);
  assert.deepEqual((await employee(deputy, withdrawals)).items, []);
  await employee(member, withdrawals, { ...request, amountCents: 10 }, 'POST', 409);
  await employee(member, withdrawals, { requestId: randomUUID(), amountCents: 1 }, 'POST', 409);
  await employee(member, withdrawals + '/review', undefined, 'GET', 403);
  const decision = withdrawals + '/' + one.id + '/decision';
  const payments = withdrawals + '/' + one.id + '/payments';
  await employee(member, decision, { decision: 'approved' }, 'PATCH', 403);
  assert.equal((await balance()).balanceCents, 2000);
  assert.ok((await employee(leader, withdrawals + '/review')).items.some(row => row.id === one.id));
  const approved = await employee(deputy, decision, { decision: 'approved' }, 'PATCH');
  assert.equal(approved.decidedByUserId, deputy.id);
  assert.equal((await balance()).balanceCents, 2000);
  const pay = amountCents => ({ requestId: randomUUID(), amountCents, occurredAt: new Date().toISOString() });
  const firstPayment = { ...pay(1000), transferReference: '测试渠道-第一笔' };
  await admin(finance, payments, firstPayment, 'POST', 403);
  await seedClub('grant', finance.id, 'CLUB_WITHDRAWAL_PAY');
  assert.ok((await admin(finance, withdrawals)).items.some(item => item.id === one.id));
  const [first, repeat] = await Promise.all([undefined, peer].map(server => admin(finance, payments, firstPayment, 'POST', 201, server)));
  assert.deepEqual(first, repeat);
  assert.equal(first.status, 'approved');
  assert.equal((await balance()).balanceCents, 1000);
  await admin(finance, payments, { ...firstPayment, amountCents: 999 }, 'POST', 409);
  await admin(finance, payments, { ...firstPayment, requestId: randomUUID() }, 'POST', 409);
  await admin(finance, payments, pay(1001), 'POST', 409);
  const remaining = { ...firstPayment, requestId: randomUUID(), transferReference: '测试渠道-第二笔' };
  const completed = await admin(finance, payments, remaining);
  assert.equal(completed.status, 'paid');
  await restartServer();
  assert.deepEqual(await admin(finance, payments, remaining), completed);
  assert.deepEqual((await employee(member, withdrawals)).items[0], completed);
  const personal = await balance();
  const debits = personal.entries.filter(row => row.kind === 'withdrawal_payment');
  assert.equal(personal.balanceCents, 0);
  assert.deepEqual(debits.map(row => row.amountCents), [-1000, -1000]);
  assert.deepEqual(completed.payments.map(row => row.transferReference), [firstPayment.transferReference, remaining.transferReference]);
  assert.ok(debits.every(row => row.withdrawalId === one.id));
  assert.deepEqual((await admin(finance, '/balance/members/' + member.id)).entries, personal.entries);
  assert.deepEqual(await admin(finance, '/balance'), teamBefore);
});
