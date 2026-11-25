/* P1 设计评审的虚构订单。金额统一为分，仅存放在此浏览器中。 */
(() => {
  "use strict";
  const lead = "青禾";
  const customer = "知夏";
  const defaultDispatchers = ["青禾", "鹿鸣"];
  const members = [...defaultDispatchers, "云岫", "阿澄", "禾川"];
  const storageKey = "sky-club.design-review.p1.v1";
  const fixtureVersion = 3;
  const initialRules = () => ({basis: "到账颗数", clubFee: 5, version: 1});
  function ruleSnapshot(rules) {
    return {basis: rules.basis, clubFee: rules.clubFee, ruleVersion: rules.version};
  }
  const sampleId = "HX-1124-07";
  function example(values) {
    return {
      source: "直接派单", dispatcher: "鹿鸣", assignee: null,
      delivered: 0, times: 0, claims: [], status: "published", change: "none", period: "normal",
      reason: "", date: "11月24日", scheduleStart: null, scheduleEnd: null,
      dispatchFee: 5, ...ruleSnapshot(initialRules()),
      ...values,
    };
  }
  // 已派发并分完份额的历史样单。从个人承接和派发记录仍能查看。
  function assignmentExamples() {
    const orders = [
      { id: "HX-1119-A", title: "山岚 · 十日送心", customer: "山岚", date: "11月19日",
        scheduleStart: "2026-11-20", scheduleEnd: "2026-11-29", total: 100, unit: 50,
        delivered: 35, times: 35, claims: [{name: lead, qty: 50, delivered: 20}, {name: "云岫", qty: 50, delivered: 15}] },
      { id: "HX-1123-A", title: "溪月 · 跨月送心", customer: "溪月", date: "11月23日",
        scheduleStart: "2026-11-27", scheduleEnd: "2026-12-03", total: 42, unit: 50,
        assignee: lead, claims: [{name: lead, qty: 42}] },
      { id: "HX-1117-A", title: "浮光 · 三日送心", customer: "浮光", date: "11月17日",
        scheduleStart: "2026-11-18", scheduleEnd: "2026-11-20", total: 24, unit: 50,
        delivered: 16, times: 16, claims: [{name: lead, qty: 12, delivered: 12}, {name: "阿澄", qty: 12, delivered: 4}] },
      { id: "HX-1115-A", title: "雨禾 · 双倍送心", customer: "雨禾", date: "11月15日",
        scheduleStart: "2026-11-16", scheduleEnd: "2026-11-27", total: 40, unit: 35,
        period: "double", change: "refunded", changeQty: 10, reason: "老板拒绝补差，剩余 10 颗已停送并退款。",
        delivered: 30, times: 15, claims: [{name: lead, qty: 40, delivered: 30}] },
      { id: "HX-1123-B", title: "晚星 · 单日送心", customer: "晚星", date: "11月23日",
        scheduleStart: "2026-11-24", scheduleEnd: "2026-11-24", total: 8, unit: 50,
        delivered: 2, times: 2, claims: [{name: lead, qty: 8, delivered: 2}] },
      { id: "HX-1123-C", title: "栀白 · 常规送心", customer: "栀白", date: "11月23日",
        total: 24, unit: 50, claims: [{name: lead, qty: 24}] },
    ];
    return orders.map(order => example({
      ...order, boardArchived: true, status: "active", paid: order.total * order.unit,
    }));
  }
  function initial(scenario = "review") {
    const orders = [
      example({ id: "HX-1124-12", title: "常规送心 · 100 颗", customer: "星野", total: 100, unit: 50, paid: 5000, claims: [{ name: "云岫", qty: 50 }] }),
      example({ id: "HX-1124-11", title: "定向送心 · 40 颗", customer: "雾岛", total: 40, unit: 50, paid: 2000, assignee: lead }),
      example({ id: "HX-1124-10", title: "常规送心 · 60 颗", customer: "晚舟", total: 60, unit: 50, paid: 3000, assignee: "阿澄" }),
      example({ id: "HX-1124-09", title: "双倍送心 · 80 颗", customer: "鹿屿", period: "double", total: 80, unit: 35, paid: 2800, claims: [{name: "禾川", qty: 80}] }),
      example({ id: sampleId, title: "双倍送心 · 200 颗", source: "客户端下单", customer,
        dispatcher: lead, period: "double", total: 200, unit: 35, paid: 7000, delivered: 190, times: 95, changeQty: 10,
        claims: [{ name: "云岫", qty: 200, delivered: 190 }], status: "active",
        change: scenario === "before-change" ? "draft" : "proposed",
        reason: scenario === "before-change" ? "" : "双倍活动已结束，剩余 10 颗需按普通期单价继续送达。",
      }),
      example({ id: "HX-1124-05", title: "常规送心 · 60 颗", source: "客户端下单", customer,
        dispatcher: lead, total: 60, unit: 50, paid: 0, status: "pending", ruleVersion: null }),
      ...assignmentExamples(),
    ];
    return { fixtureVersion, orders, notices: [notice(orders[0])], serial: 13, memberName: lead,
      rules: initialRules(), dispatchers: [...defaultDispatchers] };
  }
  function notice(order) {
    return { id: "pub-" + order.id, orderId: order.id, title: "有新派单", readBy: [], recipients: [...members] };
  }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(value?.orders) && Array.isArray(value?.notices) && Number.isInteger(value.serial)) {
        if ((value.fixtureVersion ?? 1) < fixtureVersion) {
          if ((value.fixtureVersion ?? 1) < 2) {
            const existing = new Set(value.orders.map(order => order.id));
            value.orders = value.orders.map(order => ({ scheduleStart: null, scheduleEnd: null, ...order }));
            value.orders.push(...assignmentExamples().filter(order => !existing.has(order.id)));
          }
          value.rules ??= initialRules();
          value.dispatchers ??= [...defaultDispatchers];
          for (const o of value.orders) o.ruleVersion ??= o.status === "pending" ? null : 1;
          value.fixtureVersion = fixtureVersion;
          save(value);
        }
        return value;
      }
    } catch { /* 本地文件可能关闭存储，仍可在当前页联动。 */ }
    return initial();
  }
  let state = read();
  function save(value = state) {
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* 保留内存中的演示。 */ }
    window.dispatchEvent(new Event("club-demo-change"));
  }
  const find = id => {
    const order = state.orders.find(item => item.id === id);
    if (!order) throw Error("订单已不存在，请返回列表。");
    return order;
  };
  const available = o => o.total - o.claims.reduce((sum, claim) => sum + claim.qty, 0);
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  function checkedFee(fee, unit, period) {
    const perUnitRevenue = unit * (state.rules.basis === "赠送次数" && period === "double" ? 2 : 1);
    if (!Number.isSafeInteger(fee) || fee < 0 || fee + state.rules.clubFee > perUnitRevenue) throw Error("本例的派抽、团抽合计超过每计量单位收入，或派抽金额无效");
    return fee;
  }
  function create(input) {
    const direct = input.source === "直接派单";
    if (!direct && input.source !== "客户端下单") throw Error("请选择订单来源");
    if (!Number.isSafeInteger(input.total) || input.total < 1 || !Number.isSafeInteger(input.unit) || input.unit < 1 ||
      !Number.isSafeInteger(input.total * input.unit)) throw Error("请填写有效的数量和单价");
    const title = text(input.title, 70), owner = direct ? text(input.customer, 32) : customer;
    if (!owner || !title) throw Error("请填写客户和订单信息");
    const pool = state.dispatchers;
    const dispatcher = direct ? state.memberName : input.dispatcher || pool[Math.floor(Math.random() * pool.length)];
    if (!direct && !dispatcher) throw Error("当前演示没有带派单标记的团员，请先在管理端设置候选人");
    if (!direct && !pool.includes(dispatcher)) throw Error("请选择本例的派单人");
    const assignee = direct ? input.assignee || null : null;
    if (assignee && !members.includes(assignee)) throw Error("请选择有效的定向团员");
    const dispatchFee = direct ? checkedFee(input.dispatchFee ?? 5, input.unit, input.period) : 5;
    const id = "HX-1124-" + state.serial++;
    const order = example({ id, title, customer: owner, gameAccount: text(input.gameAccount, 32), source: input.source,
      total: input.total, unit: input.unit, period: input.period === "double" ? "double" : "normal", dispatcher, dispatchFee, assignee,
      ...ruleSnapshot(state.rules), ruleVersion: direct ? state.rules.version : null,
      paid: direct ? input.total * input.unit : 0, status: direct ? "published" : "pending" });
    state.orders.unshift(order);
    if (direct) state.notices.unshift(notice(order));
    save();
    return id;
  }
  function publish(id, assignee = null, dispatchFee) {
    const order = find(id);
    if (order.dispatcher !== state.memberName || order.status !== "pending") throw Error("仅本单派单人可发布待派订单");
    if (assignee && !members.includes(assignee)) throw Error("请选择有效的定向团员");
    Object.assign(order, { ...ruleSnapshot(state.rules), status: "published", assignee,
      dispatchFee: checkedFee(dispatchFee ?? order.dispatchFee, order.unit, order.period), paid: order.total * order.unit });
    state.notices.unshift(notice(order)); save();
  }
  function claim(id, qty) {
    const order = find(id);
    const member = state.memberName;
    if (!["published","active"].includes(order.status) || (order.assignee && order.assignee !== member) || order.dispatcher === member) throw Error("此份额当前不可领取");
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > available(order)) throw Error("请输入剩余范围内的领取数量");
    const prior = order.claims.find(c => c.name === member);
    if (prior) prior.qty += qty;
    else order.claims.push({name: member, qty});
    save();
  }
  const multiplier = order => order.period === "double" && order.change !== "paid" ? 2 : 1;
  function isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function setSchedule(id, start, end) {
    const shares = find(id).claims.filter(share => share.name === state.memberName);
    if (!shares.length) throw Error("仅能调整本人的承接排期");
    if (!(start === null && end === null) && (!isDate(start) || !isDate(end) || end < start)) {
      throw Error("请填写完整排期，结束日期应在开始日期当天或之后");
    }
    for (const share of shares) share.schedule = { start, end };
    save();
  }
  function report(id, count) {
    const order = find(id);
    const share = order.claims.find(c => c.name === state.memberName);
    if (!share || !["published", "active"].includes(order.status) || !["none", "paid"].includes(order.change)) {
      throw Error("当前订单或份额暂不可填报");
    }
    const prior = share.delivered ?? 0;
    const arrived = count * multiplier(order);
    if (!Number.isSafeInteger(count) || count < 1 || arrived > share.qty - prior || arrived > order.total - order.delivered) {
      throw Error("到账数须在本人待送份额内");
    }
    share.delivered = prior + arrived; order.delivered += arrived; order.times += count;
    order.status = "active"; save(); return arrived;
  }
  // 此演示对应 190 颗双倍到账、剩余 10 颗跨期的已确认业务算例。
  function change(id, from, to, actor) {
    const order = find(id);
    if (id !== sampleId || order.change !== from ||
      (actor === "member" ? order.dispatcher !== state.memberName : order.customer !== customer)) throw Error("订单状态已变化，请查看最新进度");
    order.change = to;
    return order;
  }
  function propose(id, reason) {
    const explanation = text(reason, 180);
    if (!explanation) throw Error("请填写改价原因");
    change(id, "draft", "proposed", "member").reason = explanation; save();
  }
  function receive(id) { const order = change(id,"agreed","paid","member"); order.paid += 150; save(); }
  function refund(id) { change(id,"refundDue","refunded","member"); save(); }
  window.ClubDemo = {
    get member() { return state.memberName; }, customer, get dispatchers() { return state.dispatchers; }, members, sampleId, get state() { return state; },
    setDispatcher(name, enabled) {
      if (!members.includes(name)) throw Error("团员不存在");
      state.dispatchers = members.filter(n => n === name ? enabled : state.dispatchers.includes(n));
      save();
    },
    saveRules(basis, clubFee) {
      if (!["到账颗数","赠送次数"].includes(basis) || !Number.isSafeInteger(clubFee) || clubFee < 0) throw Error("请检查计量口径和团抽金额");
      if (basis === state.rules.basis && clubFee === state.rules.clubFee) return;
      state.rules = {basis, clubFee, version: state.rules.version + 1};
      save();
    },
    available, multiplier, create, publish, claim, report, propose, receive, refund, setSchedule,
    agree(id) { change(id,"proposed","agreed","client"); save(); },
    decline(id) { change(id,"proposed","refundDue","client"); save(); },
    markRead(id) { const n=state.notices.find(n=>n.id===id); if(n && !n.readBy.includes(state.memberName)){n.readBy.push(state.memberName); save();} },
    switchMember(name) { if (!members.includes(name)) throw Error("请选择演示团员"); state.memberName=name; save(); },
    reset(scenario) { state=initial(scenario); save(); },
  };
  addEventListener("storage", event => {
    if (event.key !== storageKey) return;
    state=read(); window.dispatchEvent(new Event("club-demo-change")); window.ClubUI?.refresh();
  });
})();
