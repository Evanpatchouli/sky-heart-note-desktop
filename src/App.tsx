import { useEffect, useMemo, useState } from "react";
import useEmitter from "./utils/useEmitter";
import AppContainer from "./components/app-container";
import Views from "./views";
import ViewContainer from "./components/view-container";
import { Flex } from "antd";
import Loading from "./components/Loading";
import "./App.css";
import { invoke, sql } from "./utils";
import { useAsyncEffect } from "ahooks";
import useHomeStore from "./views/home/store";
import { App } from "./types";
import syncStore from "./store/syncStore";
import { Toaster } from "react-hot-toast";

const DDL = `
CREATE TABLE IF NOT EXISTS booking (
  id INTEGER PRIMARY KEY,
  sid INTEGER,
  title TEXT,
  date TEXT,
  banban TEXT,
  paipai TEXT,
  zhipai TEXT,
  status TEXT,
  total INTEGER,
  yingchu INTEGER,
  richu INTEGER,
  yichu INTEGER,
  jinriYichu INTEGER,
  jinriStatus TEXT,
  gongzi TEXT,
  yuqiJiesuan TEXT,
  shijiJiesuan TEXT,
  jiesuo INTEGER,
  yishan INTEGER,
  pingbi INTEGER,
  xiaoqun TEXT,
  remark TEXT,
  pinglun TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS songxinhao (
  id INTEGER PRIMARY KEY,
  name TEXT,
  candles INTEGER,
  remark TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TEXT,
  updated_at TEXT
);
`;

function useInit() {
  const [emitterInited, setEmitterInited] = useState(false);
  const [dbInited, dbSetInited] = useState(false);
  const emitter = useEmitter();
  const homestore = useHomeStore();
  const checkInited = async () => {
    if (!emitter) {
      return;
    }
    setEmitterInited(true);
  };
  const initDB = async () => {
    const db = await sql.load("sqlite:data.db");
    syncStore.db = db;
    await db.execute(DDL);
    const rows = await db.select<App.Booking[]>(`SELECT * FROM booking`, []);
    console.log(rows[0]);
    homestore.setBookings(rows);
    dbSetInited(true);
  };

  useEffect(() => {
    checkInited();
  }, [emitter]);
  useAsyncEffect(initDB, []);

  const inited = useMemo(() => {
    return emitterInited && dbInited;
  }, [emitterInited, dbInited]);
  return inited;
}

function app() {
  const inited = useInit();
  const emitter = useEmitter();
  emitter.useSubscription("REFRESH_BOOKINGS", async () => {
    const db = syncStore.db;
    if (!db) {
      return;
    }
    const rows = await db.select<App.Booking[]>(`SELECT * FROM booking`, []);
    const homestore = useHomeStore();
    homestore.setBookings(rows);
  });
  return (
    <AppContainer>
      {inited ? (
        <Views />
      ) : (
        <ViewContainer>
          <Flex flex={1} justify="center" align="center">
            <Loading on />
          </Flex>
        </ViewContainer>
      )}
      <Toaster />
    </AppContainer>
  );
}

export default app;
