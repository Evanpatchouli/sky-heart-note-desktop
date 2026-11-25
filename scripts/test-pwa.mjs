import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const apps = [
  { name: "admin", port: 5173, label: "管理端" },
  { name: "employee", port: 5174, label: "团员端" },
  { name: "client", port: 5175, label: "客户端" },
];

function loadWorker(code, origin) {
  const listeners = new Map();
  const storage = new Map();
  const notifications = new Map();
  const opened = [];
  let online = true;

  const fetch = async (request, options) => {
    if (!online) throw new TypeError("网络已断开");
    return new Response(request.url, { headers: { "Cache-Control": options?.cache || "public" } });
  };
  const caches = {
    open: async key => {
      if (!storage.has(key)) storage.set(key, new Map());
      return {
        match: async request => storage.get(key).get(new URL(request.url ?? request, origin).href)?.clone(),
        put: async (request, response) => storage.get(key).set(new URL(request.url ?? request, origin).href, response.clone()),
        delete: async request => storage.get(key).delete(new URL(request.url ?? request, origin).href),
        keys: async () => [...storage.get(key).keys()].map(href => new Request(href)),
        addAll: async requests => {
          for (const request of requests) {
            assert.equal(request.method, "GET");
            assert.equal(request.credentials, "omit");
            assert.equal(request.redirect, "error");
          }
          const responses = await Promise.all(requests.map(async request => [request.url, await fetch(request)]));
          storage.set(key, new Map(responses));
        },
      };
    },
    match: async (request, { cacheName }) => storage.get(cacheName)?.get(request.url)?.clone(),
    keys: async () => [...storage.keys()],
    delete: async key => storage.delete(key),
  };

  runInNewContext(code, {
    self: {
      location: new URL(origin),
      addEventListener: (name, fn) => listeners.set(name, fn),
      skipWaiting: () => assert.fail("更新必须等旧窗口关闭"),
      clients: {
        claim: () => assert.fail("不能接管正在打开的旧页面"),
        matchAll: async () => [],
        openWindow: async href => opened.push(href),
      },
      registration: {
        getNotifications: async ({ tag }) => notifications.has(tag) ? [notifications.get(tag)] : [],
        showNotification: async (title, options) => notifications.set(options.tag, {
          title, ...options, close: () => notifications.delete(options.tag),
        }),
      },
    },
    URL, Request, Response, caches, fetch,
  });

  return {
    storage,
    notifications,
    opened,
    setOnline: value => { online = value; },
    dispatch(name, data = {}) {
      let result;
      listeners.get(name)({ ...data, waitUntil: promise => { result = promise; } });
      return result;
    },
    request(path, { method = "GET", mode = "cors", destination = "", headers } = {}) {
      let result;
      listeners.get("fetch")({
        request: { url: new URL(path, origin).href, method, mode, destination, headers: new Headers(headers) },
        respondWith: promise => { result = promise; },
      });
      return result;
    },
  };
}

for (const { name, port, label } of apps) {
  const dist = new URL(`../${name}/dist/`, import.meta.url);
  const read = (file, encoding) => readFileSync(new URL(file, dist), encoding);
  const origin = `http://localhost:${port}`;

  test(`${name} 生产入口和安装清单`, () => {
    const html = read("index.html", "utf8");
    const manifest = JSON.parse(read("manifest.webmanifest", "utf8"));
    assert.equal(manifest.id, `/?app=${name}`);
    assert.equal(manifest.name, `Sky Club · ${label}`);
    assert.equal(manifest.short_name, `Sky Club ${label}`);
    assert.equal(new URL(manifest.start_url, origin).href, origin + "/");
    assert.equal(new URL(manifest.scope, origin).href, origin + "/");
    assert.equal(manifest.display, "standalone");
    assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
    assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/pwa\/icon-180.png"/);

    for (const size of [180, 192, 512]) {
      if (size !== 180) {
        const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
        assert.equal(icon.src, `/pwa/icon-${size}.png`);
        assert.equal(icon.type, "image/png");
        assert.ok(icon.purpose.includes("maskable"));
      }
      const png = read(`pwa/icon-${size}.png`);
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  });

  test(`${name} 发布缓存、离线恢复及网络请求隔离`, async () => {
    const worker = loadWorker(read("service-worker.js", "utf8"), origin);
    const previous = `sky-club:pwa:${name}:previous`;
    worker.storage.set(previous, new Map());
    worker.storage.set("unrelated", new Map());
    await worker.dispatch("install");

    const published = [...worker.storage.keys()].find(key => key.startsWith(`sky-club:pwa:${name}:`) && key !== previous);
    assert.match(published, /:[a-f0-9]{16}$/);
    const staticAssets = readdirSync(new URL("assets/", dist)).sort();
    assert.deepEqual([...worker.storage.get(published).keys()], staticAssets.map(file => `${origin}/assets/${file}`));
    assert.ok(worker.storage.has(previous), "新版本安装后，旧缓存应继续服务已打开的页面");
    await worker.dispatch("activate");
    assert.deepEqual([...worker.storage.keys()], ["unrelated", published]);

    const navigation = { mode: "navigate", destination: "document" };
    const entry = staticAssets.find(file => file.startsWith("index-") && file.endsWith(".js"));
    assert.equal((await worker.request("/", navigation)).headers.get("Cache-Control"), "no-store");
    worker.setOnline(false);
    const offline = await worker.request("/?vtype=list", navigation);
    assert.equal(offline.status, 503);
    assert.equal(offline.headers.get("Cache-Control"), "no-store");
    assert.match(await offline.text(), new RegExp(`Sky Club · ${label}[\\s\\S]*当前无法连接`));
    assert.equal((await worker.request(`/assets/${entry}`, { destination: "script" })).status, 200);

    for (const path of ["/club/dispatch", "/club/operations", "/claim-board/?orderId=example"]) {
      if (name === "employee") {
        const offlineRoute = await worker.request(path, navigation);
        assert.equal(offlineRoute.status, 503);
        assert.equal(offlineRoute.headers.get("Cache-Control"), "no-store");
        assert.match(await offlineRoute.text(), /当前无法连接/);
      } else {
        assert.equal(worker.request(path, navigation), undefined);
      }
    }

    const clientOrderRoutes = ["/order", "/order-detail/?order=example"];
    for (const path of clientOrderRoutes) {
      if (name === "client") {
        const route = await worker.request(path, navigation);
        assert.equal(route.status, 503);
        assert.equal(route.headers.get("Cache-Control"), "no-store");
        assert.match(await route.text(), /当前无法连接/);
      } else {
        assert.equal(worker.request(path, navigation), undefined);
      }
    }

    assert.equal(worker.request("/api/employee/bookings"), undefined);
    assert.equal(worker.request("/api/employee/bookings", navigation), undefined);
    assert.equal(worker.request("/api/employee/bookings", { method: "POST" }), undefined);
    assert.equal(worker.request("/api/employee/club/claim-board", navigation), undefined);
    assert.equal(worker.request("/api/employee/club/claim-board/example/claims", { method: "POST" }), undefined);
    assert.equal(worker.request("/api/employee/club/authorizations", navigation), undefined);
    assert.equal(worker.request("/api/client/club/order-options", navigation), undefined);
    assert.equal(worker.request("/api/client/orders", { method: "POST" }), undefined);
    assert.equal(worker.request("/", { ...navigation, method: "POST" }), undefined);
    assert.equal(worker.request(`/assets/${entry}`), undefined);
    assert.equal(worker.request(`/assets/${entry}`, { destination: "script", headers: { Authorization: "Bearer example" } }), undefined);
    assert.equal(worker.request(`/assets/${entry}?business=1`, { destination: "script" }), undefined);
    assert.equal(worker.request(`https://api.example.test/assets/${entry}`, { destination: "script" }), undefined);

    worker.setOnline(true);
    const recovered = await worker.request("/?vtype=list", navigation);
    assert.equal(recovered.status, 200);
    assert.equal(await recovered.text(), origin + "/?vtype=list");
    if (name === "employee") {
      for (const path of ["/club/dispatch", "/club/operations", "/claim-board?orderId=example"]) {
        const route = await worker.request(path, navigation);
        assert.equal(route.status, 200);
        assert.equal(await route.text(), origin + path);
      }
    }
    if (name === "client") {
      for (const path of clientOrderRoutes) {
        const route = await worker.request(path, navigation);
        assert.equal(route.status, 200);
        assert.equal(await route.text(), origin + path);
      }
    }
    assert.equal(worker.storage.get(published).size, staticAssets.length);
  });

  test(`${name} 仅展示本端当前会话的重要和系统通知，且点击只打开规定路由`, async () => {
    const worker = loadWorker(read("service-worker.js", "utf8"), origin);
    const key = origin + "/__pwa_notification_session__";
    const binding = "a".repeat(43);
    const cache = new Map([[key, new Response(binding)]]);
    worker.storage.set(`sky-club:notification:${name}`, cache);
    const notice = {
      type: "app-notification", version: 1, targetApp: name, noticeType: "important",
      notificationId: "1".repeat(24), noticeId: "2".repeat(24), target: "inbox",
      title: "设备提醒", message: "在本端打开", deviceBinding: binding, expiresAt: Date.now() + 900000,
    };
    const deliver = payload => worker.dispatch("push", { data: { json: () => payload } });
    await deliver({ ...notice, noticeType: "normal" });
    await deliver({ ...notice, targetApp: name === "client" ? "admin" : "client" });
    await deliver({ ...notice, target: "https://example.invalid/" });
    await deliver({ ...notice, notificationId: [notice.notificationId] });
    await deliver({ ...notice, deviceBinding: "b".repeat(43) });
    assert.equal(worker.notifications.size, 0);
    await deliver(notice);
    const [shown] = worker.notifications.values();
    assert.equal(shown.title, notice.title);
    await worker.dispatch("notificationclick", { notification: shown });
    assert.equal(worker.opened.at(-1), origin + "/?noticeId=" + notice.noticeId);
    await deliver(notice);
    assert.equal(worker.notifications.size, 0);

    cache.set(key, new Response("c".repeat(43)));
    const system = { ...notice, noticeType: "system", notificationId: "3".repeat(24), noticeId: "4".repeat(24) };
    await deliver(system);
    assert.equal(worker.notifications.size, 0);
    await deliver({ ...system, deviceBinding: "c".repeat(43) });
    await worker.dispatch("notificationclick", { notification: [...worker.notifications.values()][0] });
    assert.equal(worker.opened.at(-1), origin + "/?notifications=1");

    const businessNotice = {
      ...notice, target: "client-order-assigned", notificationId: "5".repeat(24), noticeId: "6".repeat(24),
      deviceBinding: "c".repeat(43),
    };
    await deliver(businessNotice);
    if (name === "employee") {
      await worker.dispatch("notificationclick", { notification: [...worker.notifications.values()][0] });
      assert.equal(worker.opened.at(-1), origin + "/club/dispatch?notificationId=" + businessNotice.noticeId);
      const dispatch = {
        type: "club-dispatch", version: 1, message: "有新派单，点击进入接单区",
        publicationId: "7".repeat(24), noticeId: "8".repeat(24),
        deviceBinding: "c".repeat(43), expiresAt: Date.now() + 900000,
      };
      await deliver(dispatch);
      await worker.dispatch("notificationclick", { notification: [...worker.notifications.values()][0] });
      assert.equal(worker.opened.at(-1), origin + "/claim-board?noticeId=" + dispatch.noticeId);
    }
    assert.equal(worker.notifications.size, 0);
  });
}

test("三端图标可区分，官网构建独立", () => {
  const iconBytes = apps.map(({ name }) => readFileSync(new URL(`../${name}/dist/pwa/icon-512.png`, import.meta.url)));
  assert.equal(new Set(iconBytes.map(bytes => bytes.toString("base64"))).size, apps.length);
  const site = readdirSync(new URL("../site/dist/", import.meta.url));
  assert.ok(!site.includes("service-worker.js") && !site.includes("manifest.webmanifest"));
});
