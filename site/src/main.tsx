import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function Site() {
  const [name, setName] = useState("送心手记");
  useEffect(() => {
    const controller = new AbortController();
    const api = (import.meta.env.VITE_APP_API_BASE_URL || "/api").replace(/\/$/, "");
    fetch(`${api}/site`, { signal: controller.signal })
      .then(async (res) => { if (res.ok) setName((await res.json()).name); })
      .catch(() => { /* 静态首页在 API 暂时离线时仍可访问。 */ });
    return () => controller.abort();
  }, []);
  return <main><h1>{name}</h1></main>;
}

createRoot(document.getElementById("root")!).render(<Site />);
