// CREATE TABLE IF NOT EXISTS songxinhao (
//   id INTEGER PRIMARY KEY,
//   name TEXT,
//   candles INTEGER,
//   remark TEXT,
//   created_at TEXT,
//   updated_at TEXT

import dayjs from "dayjs";

// );
export default class Songxinhao {
  id: number = 0; // 主键id
  name: string = ""; // 账号名称
  candles: number = 0; // 蜡烛数
  remark: string = ""; // 备注
  createdAt: string = ""; // 创建时间
  updatedAt: string = ""; // 更新时间
  constructor(name?: string) {
    if (name) {
      this.name = name;
    }
    this.createdAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
    this.updatedAt = dayjs().format("YYYY-MM-DD HH:mm:ss");
  }
}