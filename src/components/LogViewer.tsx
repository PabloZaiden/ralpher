// Thin re-export barrel — implementation lives in src/components/log-viewer/
import { LogViewer } from "./log-viewer";

export { LogViewer, getEntryGroupKey, annotateShowHeader } from "./log-viewer";
export type { LogEntry, LogViewerProps, DisplayEntry, EntryBase } from "./log-viewer";
export default LogViewer;
