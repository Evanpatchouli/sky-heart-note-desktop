import { createRoot } from "react-dom/client";
import { registerPwa } from "@webapp-template/common/pwa";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
registerPwa("admin");
