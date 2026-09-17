import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ScreenshotOverlay } from "./components/ScreenshotOverlay";
import "./styles.css";

const isCaptureWindow = new URLSearchParams(window.location.search).get("capture") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isCaptureWindow ? <ScreenshotOverlay /> : <App />}
  </StrictMode>,
);
