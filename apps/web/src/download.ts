export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Leave enough time for the browser to start consuming the temporary URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
