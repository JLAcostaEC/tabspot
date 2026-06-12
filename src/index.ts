export { tabspot, tabspotObserver } from "./core.ts";
export {
  getTabspotAttributes,
  setTabspotAttributes,
  setTabspotAttributesBatch,
  unsetTabspotSection,
} from "./attributes.ts";
export { tabspotVirtual } from "./virtual.ts";
export type { VirtualAdapter } from "./virtual.ts";

export type {
  Activation,
  ActivationMode,
  ActiveMark,
  DebugLevel,
  Dir,
  EnterExitDirections,
  GridCell,
  GridFlow,
  GridRowStrategy,
  ManagedKey,
  MoverAxis,
  MoverLayout,
  RtlMode,
  SetAttributesArgs,
  SetAttributesResult,
  TabspotEventListener,
  TabspotLogSink,
  TabspotGridMoverOptions,
  TabspotGrouperOptions,
  TabspotInstance,
  TabspotLinearMoverOptions,
  TabspotMoverOptions,
  TabspotNavigationEvent,
  TabspotNodeOptions,
  TabspotObserverAPI,
  TabspotObserverOptions,
  TabspotObserverRegistration,
  TabspotOptions,
  TabspotRootOptions,
  Visibility,
} from "./types.ts";
