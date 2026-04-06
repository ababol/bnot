import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import NotchContent from "./components/notch-content";
import { SessionProvider, useSession } from "./context/session-context";
import { useTauriEvents } from "./hooks/use-tauri-events";

interface NotchGeometry {
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
}

function AppInner() {
  const [geometry, setGeometry] = useState<NotchGeometry | null>(null);
  const { dispatch } = useSession();

  // Listen for sidecar events
  useTauriEvents(dispatch);

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
