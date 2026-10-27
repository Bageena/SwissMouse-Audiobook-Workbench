// Public surface for built-in modules and future trusted plugin contributions.
// Layout object IDs identify instances; definition IDs identify reusable types.
export { DesktopWorkspace as Workspace, DesktopWindow as WorkspaceContainer } from '../components/DesktopWorkspace';
export { registerContainer, getContainerDefinition, listContainerDefinitions, containerTypes, contentTypes } from '../utils/containerLayout';
export type { ContainerDefinition, ContainerKind, ContentKind, ContainerLayout, LayoutMode } from '../utils/containerLayout';
export { registerPanel, getPanelDefinition, listPanelDefinitions, canDockPanel } from './panels';
export type { PanelDefinition, PanelRole, FluidPanelConstraints } from './panels';
export type { HandleMode, PanelPreferences, WorkspaceState } from './workspaceState';
export { AdaptiveButton } from '../components/AdaptiveButton';

export { NavigationPanel } from '../components/NavigationPanel';
export type { NavigationItem } from '../components/NavigationPanel';
export { ToolbarPanel } from '../components/ToolbarPanel';
export { SlideOutPanel } from '../components/SlideOutPanel';

export { LoadingMotion } from '../components/LoadingMotion';
export type { LoadingMotionProps } from '../components/LoadingMotion';
