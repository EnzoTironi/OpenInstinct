import { NextResponse } from "next/server";
import { applicationOrigin } from "@shared/environment/origin";

export const companionIconSize = {
  height: 64,
  width: 64,
};

export function companionIconImage() {
  return NextResponse.redirect(
    new URL("/marketing/zoen-favicon.png", applicationOrigin())
  );
}
