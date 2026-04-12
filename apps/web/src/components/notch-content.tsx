import { useSession } from "../context/session-context";
import CompactView from "./compact-view";
import ContextMenu from "./context-menu";
import JumpView from "./jump-view";
import OverviewView from "./overview-view";

interface NotchGeometry {
  centerX: number;
  topY: number;
  notchWidth: number;
  notchHeight: number;
}

export default function NotchContent({ geometry }: { geometry: NotchGeometry }) {
  const { state } = useSession();

  const renderView = () => {
    switch (state.panelState) {
      case "compact":
      case "alert":
        return <CompactView notchWidth={geometry.notchWidth} />;
      case "jump":
        return <JumpView notchHeight={geometry.notchHeight} />;
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
