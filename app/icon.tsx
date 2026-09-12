import {
  companionIconImage,
  companionIconSize,
} from "./_components/companion-icon";

export const size = companionIconSize;
export const contentType = "image/png";

export default function Icon() {
  return companionIconImage();
}
