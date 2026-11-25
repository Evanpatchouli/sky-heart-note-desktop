import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { clearPendingClaim, readPendingClaims, savePendingClaim } from '../src/views/claim-board/pending-claims.ts';

class BrowserStorage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = value; }
  removeItem(key) { delete this[key]; }
}

function mockBrowserStorage(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new BrowserStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  return storage;
}

const club = 'sky-heart.employee.pending-claim.v1:0001:main:';
const otherClub = 'sky-heart.employee.pending-claim.v1:0001:other:';
const otherMember = 'sky-heart.employee.pending-claim.v1:0002:main:';
const order = '000000000000000000000001';
const otherOrder = '000000000000000000000002';
const request = (kind, hearts) => ({ requestId: randomUUID(), kind, hearts });

test('同单的不同领取独立保留，按账号、俱乐部和订单读取', (t) => {
  const storage = mockBrowserStorage(t);
  const first = request('public', 20);
  const second = request('directed', 50);
  const elsewhere = request('public', 30);
  savePendingClaim(club, order, first);
  savePendingClaim(club, order, second);
  savePendingClaim(club, otherOrder, elsewhere);
  savePendingClaim(otherClub, order, elsewhere);
  savePendingClaim(otherMember, order, elsewhere);

  const byOrder = readPendingClaims(club);
  assert.deepEqual(byOrder.get(order), [{ input: first, persistent: true }, { input: second, persistent: true }]);
  assert.deepEqual(byOrder.get(otherOrder), [{ input: elsewhere, persistent: true }]);
  assert.deepEqual(readPendingClaims(otherClub).get(order), [{ input: elsewhere, persistent: true }]);
  assert.deepEqual(readPendingClaims(otherMember).get(order), [{ input: elsewhere, persistent: true }]);

  clearPendingClaim(club, order, first.requestId);
  assert.deepEqual(readPendingClaims(club).get(order), [{ input: second, persistent: true }]);
  assert.equal(Object.keys(storage).length, 4);
});

test('本地存储无法写入时，当前页面仍能恢复原请求', (t) => {
  const storage = mockBrowserStorage(t);
  t.mock.method(storage, 'setItem', () => { throw new Error('storage quota'); });
  const input = request('public', 30);
  savePendingClaim(club, order, input);
  assert.deepEqual(readPendingClaims(club).get(order), [{ input, persistent: false }]);
  assert.equal(readPendingClaims(otherMember).size, 0);
  clearPendingClaim(club, order, input.requestId);
  assert.equal(readPendingClaims(club).size, 0);
});
