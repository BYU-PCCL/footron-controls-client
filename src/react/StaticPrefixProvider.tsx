// TODO: Static prefix is kind of a messy requirement that is simple enough that we don't really want to create a whole
//  new library for it, and it doesn't really need to exist outside of the react directory since it's implementation
//  specific. Those are the only rationales behind the positioning of this file and if either stop being true, feel
//  free to move it.

import React from "react";

const StaticPrefixContext = React.createContext<string | undefined>(undefined);

export const useStaticPrefix = (): string => {
  const staticPrefix = React.useContext(StaticPrefixContext);

  if (!staticPrefix) {
    throw new Error(
      "No static prefix set, use StaticPrefixProvider to set one"
    );
  }

  return staticPrefix;
};

export interface StaticPrefixProviderProps {
  prefix: string;
}

export const StaticPrefixProvider = ({
  prefix,
  children,
}: React.PropsWithChildren<StaticPrefixProviderProps>): JSX.Element => {
  return (
    <StaticPrefixContext.Provider value={prefix}>
      {children}
    </StaticPrefixContext.Provider>
  );
};
