const data = [
  {
    title: "a1521",
    yingchu: 20,  // 总共应送出多少爱心
    richu: 5, // 每日应送出多少爱心
    zhipai: "清,易,华,元,莞",
    yichu: 5, // 已送出多少爱心
    sentToday: 1, // 今日是否已送出
  },
  {
    title: "a1627小号",
    yingchu: 35,
    richu: 5,
    zhipai: "清,易,华,元,莞",
    yichu: 10,
    sentToday: 1,
  },
  {
    title: "g12",
    yingchu: 50,
    richu: 5,
    zhipai: "清,易,华,元,莞",
    yichu: 15,
    sentToday: 1,
  },
  {
    title: "a787",
    yingchu: 50,
    richu: 5,
    zhipai: "虚,柏,玖,阮,露",
    yichu: 20,
    sentToday: 1,
  },
  {
    title: "a1643",
    yingchu: 20,
    richu: 2,
    zhipai: "阮,露",
    yichu: 10,
    sentToday: 1,
  },
  {
    title: "芸板",
    yingchu: 75,
    richu: 5,
    zhipai: "兰,虚,柏,玖,阮",
    yichu: 50,
    sentToday: 1,
  },
  {
    title: "a1362",
    yingchu: 80,
    richu: 4,
    zhipai: "兰,虚,柏,玖",
    yichu: 48,
    sentToday: 1,
  },
  {
    title: "a1546",
    yingchu: 220,
    richu: 5,
    zhipai: "清,易,华,元,莞",
    yichu: 70,
    sentToday: 1,
  },
  {
    title: "a1573",
    yingchu: 60,
    richu: 3,
    zhipai: "易,华,莞",
    yichu: 42,
    sentToday: 1,
  },
  {
    title: "a1489无翼",
    yingchu: 40,
    richu: 2,
    zhipai: "阮,露",
    yichu: 26,
    sentToday: 1,
  },
  {
    title: "长102",
    yingchu: 100,
    richu: 5,
    zhipai: "清,易,华,元,莞",
    yichu: 85,
    sentToday: 1,
  },
  {
    title: "a1627",
    yingchu: 92,
    richu: 4,
    zhipai: "兰,虚,柏,玖",
    yichu: 88,
    sentToday: 1,
  },
  {
    title: "a1482",
    yingchu: 110,
    richu: 5,
    zhipai: "清,易,华,元,莞",
    yichu: 90,
    sentToday: 1,
  },
  {
    title: "痕板",
    yingchu: 80,
    richu: 2,
    zhipai: "易,莞",
    yichu: 58,
    sentToday: 1,
  },
]

const haos = [
  {
    name: "清",
    lazhu: 314,
    xiaohao: 0,
  },
  {
    name: "易",
    lazhu: 152,
    xiaohao: 0,
  },
  {
    name: "华",
    lazhu: 256,
    xiaohao: 0,
  },
  {
    name: "元",
    lazhu: 394,
    xiaohao: 0,
  },
  {
    name: "莞",
    lazhu: 124,
    xiaohao: 0,
  },
  {
    name: "兰",
    lazhu: 153,
    xiaohao: 0,
  },
  {
    name: "虚",
    lazhu: 319,
    xiaohao: 0,
  },
  {
    name: "柏",
    lazhu: 414,
    xiaohao: 0,
  },
  {
    name: "玖",
    lazhu: 411,
    xiaohao: 0,
  },
  {
    name: "阮",
    lazhu: 218,
    xiaohao: 0,
  },
  {
    name: "露",
    lazhu: 361,
    xiaohao: 0,
  },
]

function check() {

  let day = 1;

  let max_DAY = -Infinity; // 初始化最大值为负无穷

  data.forEach(item => {
    let value = (item.yingchu - item.yichu) / item.richu;
    if (value > max_DAY) {
      max_DAY = value;
    }
  });

  while (data.some(order => order.yingchu > order.yichu)) {
    if (day > max_DAY) {
      // console.log('无法完成');
      break;
    }
    const today = [];
    const today_orders = data.filter(order => order.yingchu > order.yichu && !(!order.sentToday && day === 1));
    today_orders.forEach((order) => {
      order.zhipai.split(',').forEach(name => {
        const hao = haos.find(hao => hao.name === name);
        hao.xiaohao += 3;
        hao.needBoost = hao.lazhu - hao.xiaohao < 0 ? hao.xiaohao - hao.lazhu : 0;
        if (hao.needBoost) {
          hao.boostK = hao.boostK ?? 0;
          let boostK = (hao.needBoost / day).toFixed(2);
          hao.boostK = Number(Number(boostK) >= Number(hao.boostK) ? boostK : hao.boostK);
        }
      });
      order.yichu += order.richu;
    });
    day++;
  }

  console.log(haos);
}

check();