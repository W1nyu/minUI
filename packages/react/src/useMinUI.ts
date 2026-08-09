import { useContext } from "react";
import { MinUIContext, type MinUIContextValue } from "./MinUIProvider.js";

export function useMinUI(): MinUIContextValue {
  const value = useContext(MinUIContext);
  if (!value) {
    throw new Error("useMinUI는 <MinUIProvider> 안에서만 쓸 수 있습니다.");
  }
  return value;
}
