import { useSession } from "../context/session-context";
import type { NotchGeometry } from "../context/types";
import CompactView from "./compact-view";
import ContextMenu from "./context-menu";
import OverviewView from "./overview-view";

export default function NotchContent({ geometry }: { geometry: NotchGeometry }) {
  const { state } = useSession();

  const renderView = () => {
    switch (state.panelState) {
      case "compact":
      case "alert":
        return <CompactView notchWidth={geometry.notchWidth} />;
      case "overview":
      case "approval":
      case "ask":
        return <OverviewView notchHeight={geometry.notchHeight} />;
    }
  };

  return (
    <>
      {renderView()}
      <ContextMenu />
    </>
  );
}
