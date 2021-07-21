export interface UseMessagingResult {
  sendMessage: <T>(body: T) => Promise<void>;
  sendRequest: <T>(body: T) => Promise<unknown>;
}
