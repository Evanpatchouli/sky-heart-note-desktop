import { Toaster } from "react-hot-toast";
import AppContainer from "./components/app-container";
import Views from "./views";
import "./App.css";

export default function App() {
  return (
    <AppContainer>
      <Views />
      <Toaster />
    </AppContainer>
  );
}
