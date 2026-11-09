// Display uploaded or bundled images without making a request to another host.
export function localImage(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)
    || value.startsWith("blob:")
    || (value.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u0020\\]/.test(value));
}
