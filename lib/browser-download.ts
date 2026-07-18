import type { HealthExportDocument } from "@/lib/browser-flow";
import { loadHealthAttachments } from "@/lib/browser-storage";

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not encode a stored attachment."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read a stored attachment."));
    reader.readAsDataURL(blob);
  });
}

async function downloadableExport(json: string): Promise<{ blob: Blob; extension: string }> {
  if (typeof CompressionStream === "undefined") {
    return { blob: new Blob([json], { type: "application/json" }), extension: "json" };
  }
  const source = new Blob([json], { type: "application/json" }).stream();
  const compressed = await new Response(source.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return {
    blob: new Blob([compressed], { type: "application/gzip" }),
    extension: "json.gz",
  };
}

export async function downloadHealthExport(healthExport: HealthExportDocument): Promise<void> {
  const attachments = await loadHealthAttachments();
  const binaries: Record<string, unknown>[] = [];
  for (const attachment of attachments) {
    binaries.push({
      resourceType: "Binary",
      id: attachment.binaryId,
      contentType: attachment.contentType,
      data: await blobBase64(attachment.blob),
      ...(attachment.sourceDocumentReference
        ? { securityContext: { reference: attachment.sourceDocumentReference } }
        : {}),
    });
  }
  const exportedDocument = binaries.length
    ? {
        ...healthExport,
        data: {
          ...healthExport.data,
          Binary: binaries,
        },
      }
    : healthExport;
  const download = await downloadableExport(JSON.stringify(exportedDocument, null, 2));
  const date = healthExport.exportedAt.slice(0, 10);
  const provider = new URL(healthExport.source.fhirBase).hostname.replace(/[^a-z0-9]+/gi, "-");
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `yesyou-health-${provider}-${date}.${download.extension}`;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
