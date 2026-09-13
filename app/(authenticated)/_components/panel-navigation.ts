"use client";

import { createContext } from "react";

export const PanelNavigationContext = createContext<(() => void) | undefined>(
  undefined
);
