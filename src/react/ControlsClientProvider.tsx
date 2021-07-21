import { ControlsClient } from "../core/client";
import React from "react";

const ControlsClientContext = React.createContext<ControlsClient | undefined>(
  undefined
);

export const useControlsClient = (): ControlsClient => {
  const controlsClient = React.useContext(ControlsClientContext);

  if (!controlsClient) {
    throw new Error(
      "No ControlsClient set, use ControlsClientProvider to set one"
    );
  }

  return controlsClient;
};

export interface ControlsClientProviderProps {
  client: ControlsClient;
}

export const ControlsClientProvider = ({
  client,
  children,
}: React.PropsWithChildren<ControlsClientProviderProps>): JSX.Element => {
  const existingContext = React.useContext(ControlsClientContext);
  React.useEffect(() => {
    if (existingContext != null) {
      throw new Error(
        "Attempted to create a ControlsClientProvider inside of an existing ControlsClientProvider--this is not allowed"
      );
    }

    client.mount();
    return () => {
      client.unmount();
    };
  }, [client, existingContext]);

  return (
    <ControlsClientContext.Provider value={client}>
      {children}
    </ControlsClientContext.Provider>
  );
};
