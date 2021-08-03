import { ControlsClient } from "../core";
import React from "react";

const ControlsClientContext = React.createContext<ControlsClient | undefined>(
  undefined
);

export const useControlsClient = (): ControlsClient | undefined => {
  return React.useContext(ControlsClientContext);
};

export interface ControlsClientProviderProps {
  client?: ControlsClient | undefined;
}

export const ControlsClientProvider = ({
  client,
  children,
}: React.PropsWithChildren<ControlsClientProviderProps>): JSX.Element => {
  const existingContext = React.useContext(ControlsClientContext);
  React.useEffect(() => {
    if (client == null) {
      return;
    }
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
