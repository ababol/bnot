import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import NotchContent from "./components/notch-content";
import { SessionProvider, useSession } from "./context/session-context";
import type { NotchGeometry } from "./context/types";
import { useTauriEvents } from "./hooks/use-tauri-events";

function AppInner() {
  const [geometry, setGeometry] = useState<NotchGeometry | null>(null);
  const { state, dispatch } = useSession();

  // Listen for sidecar events + auto-collapse on blur
  useTauriEvents(dispatch, state.panelState);

  useEffect(() => {
    invoke<NotchGeometry | null>("get_notch_geometry").then((g) => {
      setGeometry(g ?? { centerX: 0, topY: 0, notchWidth: 200, notchHeight: 32 });
    });
  }, []);

  if (!geometry) return null;

  return <NotchContent geometry={geometry} />;
}

export default function App() {
  return (
    <SessionProvider>
      <AppInner />
    </SessionProvider>
  );
}
