import { useEffect, useRef, useState } from "react";
import { Alert, Button, Flex } from "antd";
import { Link } from "react-router";
import Header from "#/components/Header";
import Loading from "#/components/Loading";
import ViewContainer from "#/components/view-container";
import { getAllBooking } from "#/service";
import useEmitter from "#/utils/useEmitter";
import Home from "./home";
import useHomeStore from "./home/store";

export default function Root() {
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

  return <>
    <Header />
    <Link to="/club/dispatch" style={{ padding: "8px 16px", alignSelf: "flex-start" }}>派单准备</Link>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={load}>重试</Button>} />}
    {ready ? <ViewContainer><Home /></ViewContainer>
      : !error && <Flex flex={1} justify="center" align="center"><Loading on /></Flex>}
  </>;
}
