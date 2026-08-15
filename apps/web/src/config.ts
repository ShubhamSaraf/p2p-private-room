const localSignalingUrl = "http://localhost:8787";

export const SIGNALING_URL = (import.meta.env.VITE_SIGNALING_URL ?? localSignalingUrl).replace(
  /\/$/,
  "",
);
