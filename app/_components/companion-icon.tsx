import { NextResponse } from "next/server";

export const companionIconSize = {
  height: 64,
  width: 64,
};

const publicFaviconPath = "/marketing/zoen-favicon.png";

export function companionIconImage() {
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: publicFaviconPath,
    },
  });
}
