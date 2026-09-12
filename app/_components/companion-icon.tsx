import { ImageResponse } from "next/og";
import { OpenGraphMark } from "./og-mark";

export const companionIconSize = {
  height: 32,
  width: 32,
};

export function companionIconImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f5f3ed",
        borderRadius: "6px",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <OpenGraphMark color="#deddd7" foreground="#292927" size={24} />
    </div>,
    companionIconSize
  );
}
