import { useLoaderData } from "react-router";
import HeartExpressTimeline from "../templates/heart-express-timeline";
import HeartExpressDataGrid from "../templates/heart-express-datagrid";
import HeartExpressList from "../templates/heart-express-list";
import HeartExpressKanban from "../templates/heart-express-kanban";

export default function Home() {
  const { vtype } = useLoaderData();
  switch (vtype) {
    case "timeline":
      return <HeartExpressTimeline />;
    case "datagrid":
      return <HeartExpressDataGrid />;
    case "list":
      return <HeartExpressList />;
    case "kanban":
      return <HeartExpressKanban />;
    default:
      return <HeartExpressTimeline />;
  }
}
