export * from "./messages";

// This pattern is mostly adapted from
// https://github.com/tannerlinsley/react-query/blob/3b2c4088e103e4b4ca990662c03fd6e67330b477/src/core/types.ts#L264-L365

export type ClientConnectionStatus = "idle" | "loading" | "open" | "closed";

export interface BaseConnectionStatusResult {
  status: ClientConnectionStatus;
}

export interface IdleConnectionStatusResult extends BaseConnectionStatusResult {
  status: "idle";
}

export interface LoadingConnectionStatusResult
  extends BaseConnectionStatusResult {
  status: "loading";
}

export interface OpenConnectionStatusResult extends BaseConnectionStatusResult {
  status: "open";
}

export interface ClosedConnectionStatusResult
  extends BaseConnectionStatusResult {
  status: "closed";
  reason?: string;
}

export type ConnectionStatusResult =
  | IdleConnectionStatusResult
  | LoadingConnectionStatusResult
  | OpenConnectionStatusResult
  | ClosedConnectionStatusResult;

export type MessageCallback<T> = (body: T) => void;
export type StatusCallback = (status: ConnectionStatusResult) => void;
