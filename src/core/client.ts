import {
  ApplicationClientMessage,
  ConnectMessage,
  Message,
  MessageType,
} from "./messages";
import { v4 as uuidv4 } from "uuid";
import {
  ClientConnectionStatus,
  ClosedConnectionStatusResult,
  ConnectionStatusResult,
  MessageCallback,
  StatusCallback,
} from "./types";
import { PROTOCOL_VERSION } from "./constants";

// This number is totally arbitrary and doesn't neatly map to any specific
// memory constraint
const DEFAULT_MESSAGE_QUEUE_SIZE = 256;
const DEFAULT_LOADING_TIMEOUT_MS = 10000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const CONNECTION_REQUEST_POLL_INTERVAL_MS = 500;

// This is a higher level interface for AccessMessage
interface AccessResult {
  accepted: boolean;
  app?: string;
  reason?: string;
}

type AccessCallback = (access: AccessResult) => void;

interface MessageQueueConfig {
  size?: number;
}

interface ControlsClientConfig {
  queueSize?: number;
  messageQueue?: boolean | MessageQueueConfig;
}

// TODO: See which parts of this class can be encapsulated
/**
 * Provides an API for sending/receiving messages with a router and managing a
 * connection.
 * Handles a WebSocket connection and processes Footron protocol messages.
 *
 * _Important preface_: in comments in this class and probably elsewhere,
 * "connection" does not refer to a WebSocket connection but to a higher-level
 * abstraction defined by us. We use "socket" exclusively when referring to the
 * WebSocket connection to avoid this conflict.
 * See the router source for more background.
 */
export class ControlsClient {
  /**
   * Base endpoint (typically http(s)://<host>[:port]/messaging/in/)
   */
  private readonly endpoint: string;
  // vinhowe: auth code can be set to undefined in development, but I don't see
  // the point in handling an "unset" state where the client exists but prevents
  // sending messages. So for now, an auth code is a hard dependency of a
  // controls client.
  /**
   * Each client session is scoped to the lifetime of an auth code
   */
  private readonly authCode: string | null;
  private socket?: WebSocket;
  /**
   * ID of currently connected app--mirrors state in router and is undefined
   * when a connection is in progress or a connection request was denied
   */
  private connectionAppId?: string;
  /**
   * ID of _requested_ app as specified by the client. This is the app we want
   * to run, which can be different than the app that is currently running.
   */
  private clientAppId?: string;
  private readonly messageQueueSize: number;
  private readonly messageQueue?: unknown[];
  private readonly messageListeners: Set<MessageCallback<unknown>>;
  private readonly statusListeners: Set<StatusCallback>;
  private readonly requests: Map<string, MessageCallback<unknown>>;
  private accessCallback?: AccessCallback;
  // TODO: This timeout doesn't exist for the entire duration of the loading
  //  state (from the first attempt to connect with a WebSocket to the first
  //  application message), so we might consider renaming this variable
  private loadingTimeoutId?: number;
  // TODO: It's likely that our implementation of the loading state is more
  //  complicated than what is described here. We should probably either find
  //  ways to simplify our logic or update this documentation.
  /**
   * Valid status transitions (rough finite state machine diagram):
   *
   * ```
   *           ╭──────(1)─────╮
   *           ↑              ↓
   * idle → loading → open → closed
   *           ↑       ↓      ↑   ↓
   *           ╰──(2)──╯      ╰(3)╯
   *
   * (1) occurs when a new connection attempt is denied
   * (2) occurs when attempting to connect to a different app after a successful
   *     connection
   * (3) illustrates that a closed state is final; once a client closes for any
   *     reason (currently should only happen due to a timeout or denied
   *     access), a new client will have to be created with a new auth code
   * ```
   *
   * Status conditions:
   * - "idle" is the state before any attempt has been made to start a
   *   connection (before startConnection() has been called). Once a connection
   *   attempt has started, set status := "loading"
   * - "loading" until all of the following have been met, then status := "open"
   *   (unless a predefined timeout is exceeded, then status := "closed"):
   *   - WebSocket has connected (before onopen is called, while
   *     connection.readyState = CONNECTING)
   *   - A connection request has been sent but no access response has been
   *     received
   *     - If a _rejecting_ access response is received, then status := "closed"
   *   - A connection has been accepted but no application messages have been
   *     received
   * - "open" until any of the following:
   *   - WebSocket disconnects without providing a reason, then
   *     status := "loading"
   *   - Rejecting access message is received, then status := "closed"
   * - "closed" for remaining duration of client lifetime
   */
  status: ClientConnectionStatus;

  constructor(
    endpoint: string,
    authCode: string | null = null,
    config: ControlsClientConfig = {}
  ) {
    this.endpoint = endpoint;
    this.authCode = authCode;
    this.messageQueueSize =
      config?.messageQueue &&
      typeof config?.messageQueue === "object" &&
      config?.messageQueue.size
        ? config?.messageQueue.size
        : DEFAULT_MESSAGE_QUEUE_SIZE;
    this.messageQueue = config.messageQueue
      ? new Array(this.messageQueueSize)
      : undefined;

    this.messageListeners = new Set();
    this.requests = new Map();
    this.statusListeners = new Set();
    this.status = "idle";

    this.bindMethods();
  }

  /**
   * These methods are passed around as independent functions and need to be
   * explicitly bound to this class.
   * <br>
   * See
   * https://www.freecodecamp.org/news/this-is-why-we-need-to-bind-event-handlers-in-class-components-in-react-f7ea1a6f93eb/
   * for more background
   * @private
   */
  private bindMethods() {
    this.sendRequest = this.sendRequest.bind(this);
    this.sendMessage = this.sendMessage.bind(this);
    this.addMessageListener = this.addMessageListener.bind(this);
    this.removeMessageListener = this.removeMessageListener.bind(this);
    this.addStatusListener = this.addStatusListener.bind(this);
    this.removeStatusListener = this.removeStatusListener.bind(this);
  }

  //
  // Client lifecycle methods (not to be confused with protocol lifecycle
  // messages)
  //

  mount(): void {
    // Note that consumers of this class will have to also call setApp to
    //  attempt an actual connection request, and to enter the loading state
    this.openSocket();
  }

  unmount(): void {
    this.close();
  }

  private close(reason?: string) {
    // TODO(vinhowe): Determine if and how we go about distinguishing between
    //  protocol reasons and non-error application reasons. It could be useful
    //  for the user to have some subtle visual cue letting them know
    //  immediately whether they should be concerned or if they just got
    //  eliminated from their game.
    //  While it seems like we could solve this with clear messaging on the part
    //  of developers ("You lost! Better luck next time!" is way better than
    //  something terse and ambiguous like "Experience Disconnected"), I want
    //  to be careful not to assume that users will see things the same way we
    //  do.

    if (this.status == "closed") {
      // @vinhowe: This return statement just makes close() idempotent because
      // I can't think of a reason why we'd care whether this method is called
      // multiple times. It could be bad practice not to throw an error here.
      // If we decided that we cared that this method is only called once, we
      // could throw an error here instead.
      return;
    }

    this.status = "closed";
    this.notifyStatusListeners({
      status: "closed",
      reason,
    } as ClosedConnectionStatusResult);

    this.closeSocket();
    this.clearRequests();
    this.clearStatusListeners();
    this.clearMessageListeners();
  }

  //
  // Loading timeout handling
  //

  private startLoadingTimeout() {
    this.loadingTimeoutId = setTimeout(
      () =>
        // TODO: Keep in mind this message is shown to end users--it could be too
        //  technical
        this.close("Timed out attempting to connect"),
      DEFAULT_LOADING_TIMEOUT_MS
    );
  }

  private stopLoadingTimeout() {
    if (!this.loadingTimeoutId) {
      return;
    }

    clearTimeout(this.loadingTimeoutId);
  }

  //
  // Socket-level logic
  //

  private openSocket() {
    // TODO: Handle retries here
    this.socket = new WebSocket(this.endpoint + (this.authCode || ""));
    this.socket.addEventListener("message", ({ data }) => this.onMessage(data));
    this.socket.addEventListener("close", this.onSocketClose);
  }

  private closeSocket() {
    if (this.socket === undefined) {
      return;
    }

    // We're closing the socket manually here, so we don't want onSocketClose to
    // try reopening it
    this.socket.removeEventListener("close", this.onSocketClose);
    this.socket.close();
  }

  private onSocketClose() {
    // This is an example of why it's important to set a new status before
    // calling methods
    if (this.status == "closed") {
      return;
    }

    // Status is idle, loading, or open, so we'll retry opening the socket
    // after a delay to avoid spamming the server
    setTimeout(this.openSocket, 1000);
  }

  private async socketReady(): Promise<boolean> {
    if (this.socket === undefined) {
      return false;
    }

    if (this.socket.readyState == WebSocket.OPEN) {
      return true;
    }

    if (this.socket.readyState == WebSocket.CONNECTING) {
      // Await until either socket connects or times out
      // @vinhowe: Technically we could just return a boolean promise, but
      // there's no non-error state where it would potentially return anything
      // other than true, so that didn't make sense to me.
      await new Promise<void>((resolve, reject) => {
        if (this.socket === undefined) {
          reject(
            new Error(
              "Socket was set to undefined during CONNECTING state; " +
                "this is probably a bug"
            )
          );
          return;
        }

        const openCallback = () => {
          removeListeners();
          resolve();
        };
        const closeCallback = () => {
          removeListeners();
          reject(
            new Error(
              "Socket closed during CONNECTING state; it may have timed out"
            )
          );
        };
        const removeListeners = () => {
          this.socket?.removeEventListener("open", openCallback);
          this.socket?.removeEventListener("close", closeCallback);
        };

        this.socket.addEventListener("open", openCallback);
        this.socket.addEventListener("close", closeCallback);
      });
      return true;
    }

    return false;
  }

  //
  // App connection handling
  //

  private async sendConnectionRequest(): Promise<void> {
    console.log("sending connection request");
    await this.sendProtocolMessage({
      type: MessageType.Connect,
      app: this.clientAppId,
    } as ConnectMessage);
  }

  private async requestAppConnection(): Promise<AccessResult> {
    const connectionRequestIntervalId = setInterval(
      this.sendConnectionRequest.bind(this),
      CONNECTION_REQUEST_POLL_INTERVAL_MS
    );

    return new Promise<AccessResult>((resolve, reject) => {
      const connectionClosedCallback = () => {
        removeListeners();
        reject(
          new Error("Connection closed while sending connection requests")
        );
      };
      this.accessCallback = (accessResult) => {
        this.connectionAppId = accessResult.accepted
          ? // We could just use this.clientAppId here but it seemed cleaner to
            // just pass the app through the result. In a sort of vague
            // intuitive way--without any solid rationale. So if you have a
            // good reason to just use this.clientAppId, go for it.
            accessResult.app
          : undefined;
        removeListeners();
        resolve(accessResult);
      };

      const removeListeners = () => {
        clearInterval(connectionRequestIntervalId);
        this.accessCallback = undefined;
        this.removeStatusListener(connectionClosedCallback);
      };

      this.addStatusListener(connectionClosedCallback);
    });
  }

  private async waitForFirstMessage(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const firstMessageCallback = () => {
        removeListeners();
        resolve();
      };
      const connectionClosedCallback = () => {
        removeListeners();
        reject(
          new Error(
            "Connection closed while waiting for first application message"
          )
        );
      };
      const removeListeners = () => {
        this.removeMessageListener(firstMessageCallback);
        this.removeStatusListener(connectionClosedCallback);
      };

      this.addMessageListener(firstMessageCallback);
      this.addStatusListener(connectionClosedCallback);
    });
  }

  private async startAppConnection(): Promise<void> {
    // Any messages or requests in the queue now were sent by the last app, so
    // clear them
    this.clearMessageQueue();
    this.clearRequests();
    // TODO: Do we need to clear message listeners here too? We might need to
    //  build some consumers for this code before we know that. But I think the
    //  answer will be no because the listeners for controls that depend on an
    //  old app will be cleared when their useMessaging hook unmounts. That
    //  might not be the whole story because there could be a race condition
    //  when we set an app but useMessaging clients haven't cleared out yet.
    //  Still, it probably wouldn't matter because any stray messages sent from
    //  the old app would be picked up by our (current app == target app) check.

    // Note that the way we use this method now, our socket could attempt to
    // connect forever and we wouldn't enforce a timeout until we started
    // attempting to connect to an actual app. This behavior seems fine for now,
    // just possibly a little unintuitive.
    this.startLoadingTimeout();
    this.connectionAppId = undefined;
    if (!(await this.socketReady())) {
      // TODO: Do we want to queue up messages and wait for the socket to be
      //  available again? Or does our little CONNECTING await in socketReady
      //  basically provide that behavior for all of the states we care about?
      throw Error(
        "Couldn't couldn't start app connection because socket is not available"
      );
    }

    const accessResult = await this.requestAppConnection();
    if (!accessResult.accepted) {
      this.close(accessResult.reason);
      return;
    }

    await this.waitForFirstMessage();
    // TODO(vinhowe) (and this is relatively important too): technically
    //  we've scoped the controls client to exist for the duration of an
    //  auth code, so moving to the closed state for what could be an issue
    //  with the app itself is a violation of that scope _assuming the app
    //  doesn't have a lock_.
    //  Every potential "security hole" available to
    //  app developers comes with the caveat that in our case they're
    //  trustworthy people we have professional relationships with, but an
    //  app developer could potentially exploit this undocumented behavior
    //  to deny access to users individually _without requesting a lock_
    //  by just never sending any application messages, including an empty
    //  start() message.
    this.stopLoadingTimeout();
  }

  // TODO(vinhowe): Is there no way to tell WebStorm that this method is only
  //  consumed as part of a library interface? It doesn't matter that we don't
  //  use it, unless WebStorm is subtly trying to tell us to write tests.
  // noinspection JSUnusedGlobalSymbols
  async setApp(appId: string): Promise<void> {
    if (this.clientAppId === appId) {
      return;
    }

    this.clientAppId = appId;
    return this.startAppConnection();
  }

  //
  // Message handling
  //

  private async sendProtocolMessage(message: Message) {
    if (!(await this.socketReady())) {
      // TODO: Do we want to queue up messages and wait for the socket to be
      //  available again? Or does our little CONNECTING await in socketReady
      //  basically provide that behavior for all of the states we care about?
      throw Error(
        "Couldn't send protocol message because socket isn't available"
      );
    }

    this.socket?.send(
      JSON.stringify({ ...message, version: PROTOCOL_VERSION })
    );
  }

  private static parseMessage(data: string): Message {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.error(
        "An error occurred while attempting to parse a Controls message"
      );
      throw error;
    }

    if (!("type" in message) || typeof message["type"] !== "string") {
      throw Error("Message received from router doesn't specify valid type");
    }

    return message as unknown as Message;
  }

  private pushMessageQueue<T>(message: T) {
    this.messageQueue?.push(message);

    while (
      this.messageQueue &&
      this.messageQueue.length > this.messageQueueSize
    ) {
      this.messageQueue.shift();
    }
  }

  private onMessage(data: string) {
    const message = ControlsClient.parseMessage(data);

    if (message.type == MessageType.Access) {
      if (message.app == null) {
        // Router closed connection
        this.close("Connection was closed");
        return;
      }
      if (this.accessCallback === undefined) {
        throw Error("Received access response without existing request");
      }
      if (message.app !== this.clientAppId) {
        throw Error(
          "Received access response from a different app than requested"
        );
      }
      this.accessCallback({
        accepted: message.accepted,
        reason: message.reason,
        app: message.app,
      });
      return;
    }

    if (!this.connectionAppId) {
      throw Error(
        "Router sent a non-access message but current app is unknown"
      );
    }

    if (this.connectionAppId !== this.clientAppId) {
      throw Error(
        "Can't process non-access message type while connection app ID " +
          "and client app ID differ"
      );
    }

    if (message.type == MessageType.ApplicationApp) {
      if (message.req) {
        if (!this.requests.has(message.req)) {
          // Just ignore any responses without any corresponding pending
          // requests
          return;
        }

        this.requests.get(message.req)?.(message.body);
        return;
      }

      this.pushMessageQueue(message.body);
      this.notifyMessageListeners(message.body);
      return;
    }
  }

  async sendMessage<T>(body: T): Promise<void> {
    await this.sendProtocolMessage({
      type: MessageType.ApplicationClient,
      body,
    } as ApplicationClientMessage);
  }

  private clearMessageQueue(): void {
    if (this.messageQueue === undefined) {
      return;
    }

    this.messageQueue.length = 0;
  }

  //
  // Requests
  //

  async sendRequest<T>(
    body: T,
    timeout = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const requestId = uuidv4();
    await this.sendProtocolMessage({
      type: MessageType.ApplicationClient,
      body,
      req: requestId,
    } as ApplicationClientMessage);

    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(
        () =>
          reject(
            new Error(`Request ${requestId} timed out after ${timeout}ms`)
          ),
        timeout
      );

      this.requests.set(requestId, (body) => {
        clearTimeout(timeoutId);
        resolve(body);
      });
    });
  }

  private clearRequests(): void {
    this.requests.clear();
  }

  //
  // Message listeners
  //

  /**
   * Add a listener for messages from the current app
   * @param listener
   * @param queueCount number of messages back to receive; silently limited by
   * size and existence of internal queue, and if unset will send _all_ messages
   * in queue to listener
   */
  addMessageListener<T>(
    listener: MessageCallback<T>,
    queueCount = this.messageQueueSize
  ): void {
    this.messageListeners.add(listener as MessageCallback<unknown>);

    if (!queueCount || !this.messageQueue) {
      return;
    }

    this.messageQueue
      .slice(0, queueCount)
      .forEach(listener as MessageCallback<unknown>);
  }

  removeMessageListener<T>(listener: MessageCallback<T>): void {
    this.messageListeners.delete(listener as MessageCallback<unknown>);
  }

  private clearMessageListeners(): void {
    this.messageListeners.clear();
  }

  private notifyMessageListeners<T>(message: T) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  //
  // Status listeners
  //

  addStatusListener(listener: StatusCallback): void {
    this.statusListeners.add(listener);
  }

  removeStatusListener(listener: StatusCallback): void {
    this.statusListeners.delete(listener);
  }

  private clearStatusListeners(): void {
    this.statusListeners.clear();
  }

  private notifyStatusListeners(statusResult: ConnectionStatusResult) {
    this.statusListeners.forEach((listener) => listener(statusResult));
  }
}
