export enum MessageType {
  // App status message (<app id> is up/down)
  // router -> client
  Heartbeat = "ahb",
  // Connection request (I want to connect to <app id>)
  // client (us) -> app/router
  Connect = "con",
  // Connection response (Access granted/denied to <app id>)
  // app/router -> client (us)
  Access = "acc",
  // Lifecycle message (I am paused/unpaused)
  // client (us) -> app
  Lifecycle = "lcy",
  // Error message
  // router -> client (us)
  Error = "err",

  //
  // Messages with application-defined content--the majority of messages sent
  //
  // client (us) -> app
  ApplicationClient = "cap",
  // app -> client (us)
  ApplicationApp = "app",
}

interface BaseMessage {
  type: MessageType;
  version: number;
}

export interface HeartbeatMessage extends BaseMessage {
  type: MessageType.Heartbeat;
  app: string;
  up: boolean;
}

export interface ConnectMessage extends BaseMessage {
  type: MessageType.Connect;
  app: string;
}

export interface AccessMessage extends BaseMessage {
  type: MessageType.Access;
  app: string;
  accepted: boolean;
  reason?: string;
}

export interface LifecycleMessage extends BaseMessage {
  type: MessageType.Lifecycle;
  paused: boolean;
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.Error;
  error: string;
}

interface BaseApplicationMessage extends BaseMessage {
  body: unknown;
  req?: string;
}

export interface ApplicationClientMessage extends BaseApplicationMessage {
  type: MessageType.ApplicationClient;
}

export interface ApplicationAppMessage extends BaseApplicationMessage {
  type: MessageType.ApplicationApp;
}

export type Message =
  | HeartbeatMessage
  | ConnectMessage
  | AccessMessage
  | LifecycleMessage
  | ErrorMessage
  | ApplicationClientMessage
  | ApplicationAppMessage;
