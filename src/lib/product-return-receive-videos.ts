export const MAX_RETURN_RECEIVE_VIDEO_BYTES = 250 * 1024 * 1024;

export function validateProductReturnReceiveVideo(file: File): string | null {
  const looksLikeVideo =
    file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name);
  if (!looksLikeVideo) return "Choose an MP4, WebM, or MOV video.";
  if (file.size > MAX_RETURN_RECEIVE_VIDEO_BYTES) {
    return "Video must be under 250 MB.";
  }
  return null;
}
