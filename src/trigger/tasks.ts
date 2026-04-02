// src/trigger/tasks.ts
import { task, logger } from "@trigger.dev/sdk/v3";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { z } from "zod";

// ─── LLM Task (Google Gemini) ─────────────────────────────────────
export const llmTask = task({
  id: "llm-execute",
  maxDuration: 120,
  run: async (payload: {
    model: string;
    systemPrompt?: string;
    userMessage: string;
    imageUrls?: string[];
    nodeRunId: string;
  }) => {
    logger.info("LLM task started", { model: payload.model, nodeRunId: payload.nodeRunId });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: payload.model });

    // Build content parts
    const parts: Part[] = [];

    // Add system prompt if provided
    const systemInstruction = payload.systemPrompt?.trim()
      ? payload.systemPrompt
      : undefined;

    // Add image parts if provided
    if (payload.imageUrls?.length) {
      for (const url of payload.imageUrls) {
        try {
          const resp = await fetch(url);
          const buffer = await resp.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const mimeType = resp.headers.get("content-type") ?? "image/jpeg";
          parts.push({ inlineData: { data: base64, mimeType } });
        } catch (err) {
          logger.warn("Failed to fetch image", { url, err });
        }
      }
    }

    // Add user message
    parts.push({ text: payload.userMessage });

    const modelInstance = genAI.getGenerativeModel({
      model: payload.model,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const result = await modelInstance.generateContent({ contents: [{ role: "user", parts }] });
    const text = result.response.text();

    logger.info("LLM task completed", { chars: text.length });
    return { output: text };
  },
});

// ─── Crop Image Task (FFmpeg via sharp as fallback) ───────────────
export const cropImageTask = task({
  id: "crop-image",
  maxDuration: 60,
  run: async (payload: {
    imageUrl: string;
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    nodeRunId: string;
    transloaditKey: string;
    transloaditSecret: string;
  }) => {
    logger.info("Crop image task started", { nodeRunId: payload.nodeRunId });

    // Fetch image to get dimensions
    const imgResp = await fetch(payload.imageUrl);
    if (!imgResp.ok) throw new Error("Failed to fetch source image");

    // Build Transloadit assembly for FFmpeg crop
    const assemblyInstructions = {
      steps: {
        ":original": { robot: "/upload/handle" },
        cropped: {
          use: ":original",
          robot: "/image/resize",
          crop_x1: payload.xPercent / 100,
          crop_y1: payload.yPercent / 100,
          crop_x2: (payload.xPercent + payload.widthPercent) / 100,
          crop_y2: (payload.yPercent + payload.heightPercent) / 100,
          result: true,
        },
        exported: {
          use: "cropped",
          robot: "/s3/store",
          // In production: configure your S3 bucket or Transloadit CDN
          result: true,
        },
      },
    };

    // Call Transloadit API
    const formData = new FormData();
    formData.append(
      "params",
      JSON.stringify({
        auth: { key: payload.transloaditKey },
        template_id: process.env.TRANSLOADIT_CROP_TEMPLATE_ID,
        steps: assemblyInstructions.steps,
      })
    );

    // Pipe source image bytes
    const imageBytes = await imgResp.arrayBuffer();
    formData.append("file", new Blob([imageBytes]), "source.jpg");

    const assemblyResp = await fetch("https://api2.transloadit.com/assemblies", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${payload.transloaditKey}:${payload.transloaditSecret}`,
      },
      body: formData,
    });

    if (!assemblyResp.ok) {
      throw new Error(`Transloadit error: ${assemblyResp.status}`);
    }

    const assembly = await assemblyResp.json();

    // Poll for completion
    let finalAssembly = assembly;
    let attempts = 0;
    while (
      finalAssembly.ok !== "ASSEMBLY_COMPLETED" &&
      finalAssembly.ok !== "ASSEMBLY_FAILED" &&
      attempts < 30
    ) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(`https://api2.transloadit.com/assemblies/${assembly.assembly_id}`, {
        headers: { Authorization: `Bearer ${payload.transloaditKey}` },
      });
      finalAssembly = await poll.json();
      attempts++;
    }

    if (finalAssembly.ok !== "ASSEMBLY_COMPLETED") {
      throw new Error("Transloadit assembly failed or timed out");
    }

    const outputUrl =
      finalAssembly.results?.exported?.[0]?.ssl_url ??
      finalAssembly.results?.cropped?.[0]?.ssl_url;

    if (!outputUrl) throw new Error("No output URL from Transloadit");

    logger.info("Crop image completed", { outputUrl });
    return { output: outputUrl };
  },
});

// ─── Extract Frame Task (FFmpeg) ──────────────────────────────────
export const extractFrameTask = task({
  id: "extract-frame",
  maxDuration: 90,
  run: async (payload: {
    videoUrl: string;
    timestamp: string; // "50%" or "10" (seconds)
    nodeRunId: string;
    transloaditKey: string;
    transloaditSecret: string;
  }) => {
    logger.info("Extract frame task started", { nodeRunId: payload.nodeRunId });

    // Parse timestamp
    let ffmpegTimestamp: string;
    if (payload.timestamp.endsWith("%")) {
      // Percentage: we need video duration first, but Transloadit handles this
      ffmpegTimestamp = payload.timestamp;
    } else {
      const secs = parseFloat(payload.timestamp);
      ffmpegTimestamp = isNaN(secs) ? "00:00:05" : formatTimestamp(secs);
    }

    const formData = new FormData();
    formData.append(
      "params",
      JSON.stringify({
        auth: { key: payload.transloaditKey },
        steps: {
          ":original": { robot: "/upload/handle" },
          frame: {
            use: ":original",
            robot: "/video/thumbs",
            count: 1,
            offsets: payload.timestamp.endsWith("%")
              ? [parseInt(payload.timestamp)]
              : undefined,
            ffmpeg_stack: "v6.0.0",
            result: true,
          },
        },
      })
    );

    // Fetch video bytes and append
    const videoResp = await fetch(payload.videoUrl);
    if (!videoResp.ok) throw new Error("Failed to fetch source video");
    const videoBytes = await videoResp.arrayBuffer();
    formData.append("file", new Blob([videoBytes]), "source.mp4");

    const assemblyResp = await fetch("https://api2.transloadit.com/assemblies", {
      method: "POST",
      body: formData,
    });

    if (!assemblyResp.ok) throw new Error(`Transloadit error: ${assemblyResp.status}`);

    const assembly = await assemblyResp.json();

    // Poll
    let finalAssembly = assembly;
    let attempts = 0;
    while (
      finalAssembly.ok !== "ASSEMBLY_COMPLETED" &&
      finalAssembly.ok !== "ASSEMBLY_FAILED" &&
      attempts < 30
    ) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(
        `https://api2.transloadit.com/assemblies/${assembly.assembly_id}`,
        {
          headers: { Authorization: `Bearer ${payload.transloaditKey}` },
        }
      );
      finalAssembly = await poll.json();
      attempts++;
    }

    if (finalAssembly.ok !== "ASSEMBLY_COMPLETED") {
      throw new Error("Frame extraction failed");
    }

    const outputUrl = finalAssembly.results?.frame?.[0]?.ssl_url;
    if (!outputUrl) throw new Error("No frame URL from Transloadit");

    logger.info("Extract frame completed", { outputUrl });
    return { output: outputUrl };
  },
});

function formatTimestamp(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
