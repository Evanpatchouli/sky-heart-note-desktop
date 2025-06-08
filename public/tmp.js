// const delta = 1111 + 1111 * 2 + 1111 * 12 + 111 * 40 + 1111 * 4 + 1111 * 6 + 1111 * 6 + 1111 * 4 + 1111 * 6 + 1111 * 4 + 100 * 180 + 11 * 360;
// console.log(delta);

const all = [
  {
    "name": "一袋彩绫",
    "price": 1360,
    "value": 5 * 9200
  },
  {
    "name": "一袋云纱X3",
    "price": 280 * 3,
    "value": 2400 * 14 * 3
  },
  {
    "name": "招财元宝X3",
    "price": 320 * 3,
    "value": 2400 * 14,
    remark: "12000元宝，约等于14云纱"
  },
  {
    "name": "彩绫X3",
    "price": 288 * 3,
    "value": 9200 * 3,
  },
  {
    "name": "云纱X14",
    "price": 60 * 14,
    "value": 2400 * 14,
  },
  {
    "name": "至尊时装X6",
    "price": 130 * 6,
    "value": 4200 * 6,
  },
  {
    "name": "超额惊喜X4",
    "price": 0,
    "value": 2400 * 9,
    remark: "8000元宝，约等于9云纱"
  },
  {
    "name": "聚宝盆",
    "price": 0,
    "value": 2400 * 18,
    remark: "16600元宝，约等于18云纱"
  },
  // {
  //   "name": "雪绒X25",
  //   "price": 30 * 25,
  //   "value": 600 * 25,
  // }
]

const value = all.reduce((acc, cur) => {
  return acc + cur.value;
}, 0);
const price = all.reduce((acc, cur) => {
  return acc + cur.price;
}, 0);

console.log("value:", value);
console.log("price:", price);
console.log("ratio:", value / price);