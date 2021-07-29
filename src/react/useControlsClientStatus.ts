import {
  ClientConnectionStatus,
  ConnectionStatusResult,
  ControlsClient,
} from "../core";
import { useEffect, useState } from "react";

export const useControlsClientStatus = (
  client: ControlsClient | undefined
): ClientConnectionStatus | undefined => {
  const [status, setStatus] = useState<ClientConnectionStatus>();

  useEffect(() => {
    if (!client) {
      return;
    }

    const statusCallback = (result: ConnectionStatusResult) =>
      setStatus(result.status);

    client.addStatusListener(statusCallback);
    setStatus(client.status);
    return () => {
      client.removeStatusListener(statusCallback);
    };
  }, [client]);

  return status;
};
