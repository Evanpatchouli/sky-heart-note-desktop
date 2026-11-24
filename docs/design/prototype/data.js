/* P1 设计评审的虚构订单。金额统一为分，仅存放在此浏览器中。 */
(() => {
  "use strict";
  const lead = "青禾";
  const customer = "知夏";
  const dispatchers = ["青禾", "鹿鸣"];
  const members = [...dispatchers, "云岫", "阿澄", "禾川"];
  const storageKey = "sky-heart.design-review.p1.v1";
  const sampleId = "HX-1124-07";
  function example(values) {
    return {
      source: "直接派单", dispatcher: "鹿鸣", assignee: null,
      delivered: 0, times: 0, claims: [], status: "published", change: "none", period: "normal",
      reason: "", date: "11月24日", dispatchFee: 5, clubFee: 5, basis: "到账颗数",
      ...values,
    };
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
        dispatcher: lead, total: 60, unit: 50, paid: 0, status: "pending" }),
    ];
    return { orders, notices: [notice(orders[0])], serial: 13, memberName: lead };
  }
  function notice(order) {
    return { id: "pub-" + order.id, orderId: order.id, title: "有新派单", readBy: [], recipients: [...members] };
  }
  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(value?.orders) && Array.isArray(value?.notices) && Number.isInteger(value.serial)) return value;
    } catch { /* 本地文件可能关闭存储，仍可在当前页联动。 */ }
    return initial();
  }
  let state = read();
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* 保留内存中的演示。 */ }
  }
  const find = id => {
    const order = state.orders.find(item => item.id === id);
    if (!order) throw Error("订单已不存在，请返回列表。");
    return order;
  };
  const available = o => o.total - o.claims.reduce((sum, claim) => sum + claim.qty, 0);
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  function checkedFee(fee, unit) {
    if (!Number.isSafeInteger(fee) || fee < 0 || fee + 5 > unit) throw Error("派抽与团抽合计须在本例单价范围内");
    return fee;
  }
  function create(input) {
    const direct = input.source === "直接派单";
    if (!direct && input.source !== "客户端下单") throw Error("请选择订单来源");
    if (!Number.isSafeInteger(input.total) || input.total < 1 || !Number.isSafeInteger(input.unit) || input.unit < 1 ||
      !Number.isSafeInteger(input.total * input.unit)) throw Error("请填写有效的数量和单价");
    const title = text(input.title, 70), owner = direct ? text(input.customer, 32) : customer;
    if (!owner || !title) throw Error("请填写客户和订单信息");
    const dispatcher = direct ? state.memberName : input.dispatcher || dispatchers[Math.floor(Math.random() * dispatchers.length)];
    if (!direct && !dispatchers.includes(dispatcher)) throw Error("请选择本例的派单人");
    const assignee = direct ? input.assignee || null : null;
    if (assignee && !members.includes(assignee)) throw Error("请选择有效的定向团员");
    const dispatchFee = direct ? checkedFee(input.dispatchFee ?? 5, input.unit) : 5;
    const id = "HX-1124-" + state.serial++;
    const order = example({ id, title, customer: owner, gameAccount: text(input.gameAccount, 32), source: input.source,
      total: input.total, unit: input.unit, period: input.period === "double" ? "double" : "normal", dispatcher, dispatchFee, assignee,
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
    Object.assign(order, { status: "published", assignee, dispatchFee: checkedFee(dispatchFee ?? order.dispatchFee, order.unit), paid: order.total * order.unit });
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
    get member() { return state.memberName; }, customer, dispatchers, members, sampleId, get state() { return state; },
    available, multiplier, create, publish, claim, report, propose, receive, refund,
    agree(id) { change(id,"proposed","agreed","client"); save(); },
    decline(id) { change(id,"proposed","refundDue","client"); save(); },
    markRead(id) { const n=state.notices.find(n=>n.id===id); if(n && !n.readBy.includes(state.memberName)){n.readBy.push(state.memberName); save();} },
    switchMember(name) { if (!members.includes(name)) throw Error("请选择演示团员"); state.memberName=name; save(); },
    reset(scenario) { state=initial(scenario); save(); },
  };
  addEventListener("storage", event => {
    if (event.key !== storageKey) return;
    state=read(); window.ClubUI?.refresh();
  });
})();
