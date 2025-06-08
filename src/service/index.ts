import Songxinhao from "#/model/Songxinhao";
import { App } from "#/types";
import dayjs from "dayjs";
import syncStore from "../store/syncStore";

export async function createSongsinhao(
  hao: {
    name: string;
    candles?: number;
  }
) {
  const { name, candles } = hao;
  const songxinhao = new Songxinhao(name);
  songxinhao.candles = candles || 0;
  const rst = await syncStore.db?.execute(
    `INSERT INTO songxinhao (name, candles, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [
      songxinhao.name,
      songxinhao.candles,
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );
  if (rst?.lastInsertId) {
    songxinhao.id = rst.lastInsertId;
  }
  return songxinhao.id;
}

export async function updateSongsinhao(
  id: number,
  hao: {
    name?: string;
    candles?: number;
  }
) {
  const { name, candles } = hao;
  const songxinhao = new Songxinhao(name || "");
  songxinhao.id = id;
  songxinhao.candles = candles || 0;
  const rst = await syncStore.db?.execute(
    `UPDATE songxinhao SET name = ?, candles = ?, updated_at = ? WHERE id = ?`,
    [songxinhao.name, songxinhao.candles, new Date().toISOString(), id]
  );
  if (rst?.rowsAffected) {
    return true;
  } else {
    return false;
  }
}

export async function deleteSongsinhao(id: number) {
  const rst = await syncStore.db?.execute(`DELETE FROM songxinhao WHERE id = ?`, [id]);
  return rst?.rowsAffected ? true : false;
}

export async function getAllSongsinhao() {
  const rows = await syncStore.db?.select<Songxinhao[]>(`SELECT * FROM songxinhao`, []);
  return rows || [];
}

// CREATE TABLE IF NOT EXISTS booking (
//   id INTEGER PRIMARY KEY,
//   sid INTEGER,
//   title TEXT,
//   date TEXT,
//   banban TEXT,
//   paipai TEXT,
//   zhipai TEXT,
//   status TEXT,
//   total INTEGER,
//   yingchu INTEGER,
//   richu INTEGER,
//   yichu INTEGER,
//   jinriYichu INTEGER,
//   jinriStatus TEXT,
//   gongzi NUMBER,
//   yuqiJiesuan NUMBER,
//   shijiJiesuan NUMBER,
//   jiesuo INTEGER,
//   yishan INTEGER,
//   pingbi INTEGER,
//   xiaoqun TEXT,
//   remark TEXT,
//   pinglun TEXT,
//   created_at TEXT,
//   updated_at TEXT
// );
export async function createBooking(
  booking: Omit<App.Booking, "id" | "sid">
): Promise<number | undefined> {
  const rst = await syncStore.db?.execute(
    `INSERT INTO booking (title, date, banban, paipai, zhipai, status, total, yingchu, richu, yichu, jinriYichu, jinriStatus, gongzi, yuqiJiesuan, shijiJiesuan, jiesuo, yishan, pingbi, xiaoqun, remark, pinglun, created_at, updated_at) VALUES (?,
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      booking.title,
      booking.date,
      booking.banban,
      booking.paipai,
      booking.zhipai,
      booking.status,
      booking.total,
      booking.yingchu,
      booking.richu,
      booking.yichu,
      booking.jinriYichu,
      booking.jinriStatus,
      booking.gongzi,
      booking.yuqiJiesuan,
      booking.shijiJiesuan,
      booking.jiesuo,
      booking.yishan,
      booking.pingbi,
      booking.xiaoqun,
      booking.remark,
      booking.pinglun,
      dayjs().format("YYYY-MM-DD HH:mm:ss"),
      dayjs().format("YYYY-MM-DD HH:mm:ss")
    ]
  );
  if (rst?.lastInsertId) {
    return rst.lastInsertId;
  } else {
    return undefined;
  }
}

const generateSets = (record: Record<string, any>, filter: string[]): {
  sets: string;
  values: any[];
} => {
  const fields = Object.keys(record).filter((field) => filter.includes(field));
  if (fields.length === 0) {
    throw new Error("No fields to update");
  }
  const sets = fields.map((field) => `${field} = ?`).join(", ");
  const values = fields.map((field) => record[field]);
  return { sets, values };
}

const generateWhere = (condition: {
  [field: string]: any;
}): {
  where: string;
  values: any[];
} => {
  const conditions = Object.entries(condition).map(([field, value]) => {
    if (Array.isArray(value)) {
      return `${field} IN (${value.map(() => "?").join(", ")})`;
    } else {
      return `${field} =?`;
    }
  });
  const values = Object.values(condition).flat();
  return { where: conditions.join(" AND "), values };
}

const generateWherePro = (condition: {
  type: "AND" | "OR";
  children: {
    [field: string]: any;
  }[]
}): {
  where: string;
  values: any[];
} => {
  const conditions = Object.entries(condition).map(([field, value]) => {
    if (Array.isArray(value)) {
      return `${field} IN (${value.map(() => "?").join(", ")})`;
    } else {
      return `${field} =?`;
    }
  });
  const values = Object.values(condition).flat();
  return { where: conditions.join(" AND "), values };
}

export async function updateBooking(
  id: number,
  booking: App.Booking
): Promise<boolean> {
  const rst = await syncStore.db?.execute(
    `UPDATE booking SET title =?, date =?, banban =?, paipai =?, zhipai =?, status =?, total =?, yingchu =?, richu =?, yichu =?, jinriYichu =?, jinriStatus =?, gongzi =?, yuqiJiesuan =?, shijiJiesuan =?, jiesuo =?, yishan =?, pingbi =?, xiaoqun =?, remark =?, pinglun =?, updated_at =? WHERE id =?`,
    [
      booking.title,
      booking.date,
      booking.banban,
      booking.paipai,
      booking.zhipai,
      booking.status,
      booking.total,
      booking.yingchu,
      booking.richu,
      booking.yichu,
      booking.jinriYichu,
      booking.jinriStatus,
      booking.gongzi,
      booking.yuqiJiesuan,
      booking.shijiJiesuan,
      booking.jiesuo,
      booking.yishan,
      booking.pingbi,
      booking.xiaoqun,
      booking.remark,
      booking.pinglun,
      dayjs().format("YYYY-MM-DD HH:mm:ss"),
      id,
    ]
  );
  console.log(booking);
  console.log(rst);
  return rst?.rowsAffected ? true : false;
}

export async function updateBookingDynamic(
  id: number,
  booking: Partial<App.Booking>
): Promise<boolean> {
  const { sets, values } = generateSets(booking, [
    "title",
    "date",
    "banban",
    "paipai",
    "zhipai",
    "status",
    "total",
    "yingchu",
    "richu",
    "yichu",
    "jinriYichu",
    "jinriStatus",
    "gongzi",
    "yuqiJiesuan",
    "shijiJiesuan",
    "jiesuo",
    "yishan",
    "pingbi",
    "xiaoqun",
    "remark",
    "pinglun"
  ]);
  const rst = await syncStore.db?.execute(
    `UPDATE booking SET ${sets}, updated_at = ? WHERE id = ?`,
    [...values, dayjs().format("YYYY-MM-DD HH:mm:ss"), id]
  );
  return rst?.rowsAffected ? true : false;
}

export async function deleteBooking(id: number): Promise<boolean> {
  const rst = await syncStore.db?.execute(`DELETE FROM booking WHERE id = ?`, [id]);
  return rst?.rowsAffected ? true : false;
}

export async function getAllBooking(): Promise<App.Booking[]> {
  const rows = await syncStore.db?.select<App.Booking[]>(`SELECT * FROM booking`, []);
  return rows || [];
}

