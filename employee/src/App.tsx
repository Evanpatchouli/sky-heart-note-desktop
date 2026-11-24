import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex } from "antd";
import { Toaster } from "react-hot-toast";
import useEmitter from "./utils/useEmitter";
import AppContainer from "./components/app-container";
import Loading from "./components/Loading";
import Views from "./views";
import useHomeStore from "./views/home/store";
import { getAllBooking } from "./service";
import "./App.css";

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError("");
    try {
      const rows = await getAllBooking(controller.signal);
      if (!controller.signal.aborted) {
        useHomeStore.getState().setBookings(rows);
        setReady(true);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "订单加载失败");
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current?.abort();
      useHomeStore.getState().clearBookings();
    };
  }, []);
  useEmitter().useSubscription("REFRESH_BOOKINGS", load);

  return (
    <AppContainer>
      {error && <Alert type="error" showIcon title={error} action={<Button onClick={load}>重试</Button>} />}
      {ready ? <Views /> : !error && <Flex flex={1} justify="center" align="center"><Loading on /></Flex>}
      <Toaster />
    </AppContainer>
  );
}
