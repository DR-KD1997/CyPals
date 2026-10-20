import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/400-italic.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "./styles/app.css";
import { initPlatform } from "./platform";
import { useStore } from "./state/store";
import { App } from "./ui/App";
import { OverlayApp } from "./ui/OverlayApp";

const isOverlay = new URLSearchParams(location.search).has("overlay");

(async () => {
  const p = await initPlatform();
  await useStore.getState().load();
  if (!isOverlay) {
    const opened = (await p.startupFiles?.().catch(() => [])) ?? [];
    if (opened.length) await useStore.getState().importFiles(opened);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>{isOverlay ? <OverlayApp /> : <App />}</StrictMode>,
  );
})().catch((e) => {
  document.getElementById("root")!.textContent = `CyPals couldn't start: ${(e as Error).message}`;
});
