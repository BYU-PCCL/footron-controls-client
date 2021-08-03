import { UseMessagingResult } from "./types";
import { useControlsClient } from "./ControlsClientProvider";
import { MessageCallback } from "../core";
import { useEffect } from "react";

// TODO: See if we can just expose this hook, the static hook, and their
//  corresponding types to the developer--we trust developers, but it would be
//  be cleaner if they could only see their subset of things.
export const useMessaging = <T>(
  initialMessageCallback?: MessageCallback<T>
): UseMessagingResult => {
  const controlsClient = useControlsClient();

  if (!controlsClient) {
    throw Error(
      "No ControlsClient available, use ControlsClientProvider to set one."
    );
  }

  const {
    sendMessage,
    sendRequest,
    addMessageListener,
    removeMessageListener,
  } = controlsClient;

  useEffect(() => {
    if (!initialMessageCallback) {
      return;
    }

    addMessageListener(initialMessageCallback);

    return () => {
      removeMessageListener(initialMessageCallback);
    };
  }, [initialMessageCallback]);

  return { sendMessage, sendRequest };
};
