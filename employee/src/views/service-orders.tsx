import { useSearchParams } from "react-router";
import { useAuthSession } from "@sky-club/common/web-auth";
import { ServiceOrders } from "@sky-club/common/service-orders";
import type { ServiceOrderScope } from "@sky-club/common";
import Header from "#/components/Header";

export default function ServiceOrderPage({ scope }: { scope: ServiceOrderScope }) {
  const { id, token } = useAuthSession();
  const [params, setParams] = useSearchParams();
  return <><Header /><main className="club-claim-page"><ServiceOrders key={`${id}:${scope}`} app="employee" userId={id} token={token} scope={scope} orderId={params.get("serviceOrder")} onOpen={order => {
    const next = new URLSearchParams(params); if (order) next.set("serviceOrder", order); else next.delete("serviceOrder"); setParams(next);
  }} /></main></>;
}
