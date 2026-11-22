"use client";

import { useState } from "react";

export function useLatestShown<Value>(value: Value | null): Value | null {
  const [shown, setShown] = useState(value);
  if (value !== null && value !== shown) setShown(value);
  return value ?? shown;
}
