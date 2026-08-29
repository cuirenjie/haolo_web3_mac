import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectWorkflowAgentArtifacts } from "../src/main/workflow/agent-artifacts.mjs";

async function withWorkspace(name, callback) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `haolo-workflow-artifacts-${name}-`));
  try {
    await callback(workspace);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

test("media worker final text recovers a real generated image when command effects omit paths", async () => {
  await withWorkspace("image", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const imagePath = path.join(outputRoot, "角色 2-织-三视图.png");
    const metadataPath = path.join(outputRoot, "角色 2-织-三视图.json");
    const outsidePath = path.join(workspace, "outside.png");
    await fs.writeFile(imagePath, Buffer.from("generated-image"));
    await fs.writeFile(metadataPath, "{}");
    await fs.writeFile(outsidePath, Buffer.from("outside"));

    const artifacts = await collectWorkflowAgentArtifacts([
      { status: "succeeded", paths: [] },
      { status: "failed", paths: [path.join(outputRoot, "failed.png")] },
    ], {
      cwd: workspace,
      mediaMode: "image-generation",
      sinceMs: Date.now() - 5_000,
      text: [
        `图片文件：${imagePath}`,
        `元数据文件：${metadataPath}`,
        `工作区外文件：${outsidePath}`,
        `不存在的图片：${path.join(outputRoot, "missing.png")}`,
      ].join("\n"),
    });

    assert.deepEqual(artifacts, [{
      type: "file",
      uri: path.resolve(imagePath),
      name: path.basename(imagePath),
    }]);
  });
});

test("media artifact recovery preserves trusted effect paths and rejects stale text-only files", async () => {
  await withWorkspace("stale", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const staleImagePath = path.join(outputRoot, "stale.png");
    const effectImagePath = path.join(outputRoot, "effect.png");
    await fs.writeFile(staleImagePath, Buffer.from("old-image"));
    await fs.writeFile(effectImagePath, Buffer.from("effect-image"));

    const artifacts = await collectWorkflowAgentArtifacts([
      { status: "succeeded", paths: [effectImagePath, effectImagePath] },
    ], {
      cwd: workspace,
      mediaMode: "image-generation",
      sinceMs: Date.now() + 5_000,
      text: `已生成：${staleImagePath}\n效果路径重复：${effectImagePath}`,
    });

    assert.deepEqual(artifacts, [{
      type: "file",
      uri: effectImagePath,
      name: path.basename(effectImagePath),
    }]);
  });
});

test("artifact recovery follows media mode and explicit text-only output contracts", async () => {
  await withWorkspace("mode", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const imagePath = path.join(outputRoot, "frame.png");
    const videoPath = path.join(outputRoot, "clip.mp4");
    await fs.writeFile(imagePath, Buffer.from("image"));
    await fs.writeFile(videoPath, Buffer.from("video"));
    const text = `图片：${imagePath}\n视频：${videoPath}`;

    const imageArtifacts = await collectWorkflowAgentArtifacts([], {
      cwd: workspace,
      mediaMode: "image-generation",
      text,
    });
    const videoArtifacts = await collectWorkflowAgentArtifacts([], {
      cwd: workspace,
      mediaMode: "video-generation",
      text,
    });
    const ordinaryAgentArtifacts = await collectWorkflowAgentArtifacts([], {
      cwd: workspace,
      text,
      outputContract: { format: "text", requiredArtifactTypes: [] },
    });

    assert.deepEqual(imageArtifacts.map((artifact) => artifact.uri), [path.resolve(imagePath)]);
    assert.deepEqual(videoArtifacts.map((artifact) => artifact.uri), [path.resolve(videoPath)]);
    assert.deepEqual(ordinaryAgentArtifacts, []);
  });
});

test("non-media workers recover only files declared by compiled semantic output slots", async () => {
  await withWorkspace("semantic-files", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const docxPath = path.join(outputRoot, "final-report.docx");
    const xlsxPath = path.join(outputRoot, "analysis.xlsx");
    const pptxPath = path.join(outputRoot, "presentation.pptx");
    const pdfPath = path.join(outputRoot, "appendix.pdf");
    const projectPath = path.join(outputRoot, "scene.blend");
    const auditPath = path.join(outputRoot, "generation-audit.json");
    for (const filePath of [docxPath, xlsxPath, pptxPath, pdfPath, projectPath, auditPath]) {
      await fs.writeFile(filePath, Buffer.from(path.basename(filePath)));
    }

    const artifacts = await collectWorkflowAgentArtifacts([{ status: "succeeded", paths: [] }], {
      cwd: workspace,
      sinceMs: Date.now() - 5_000,
      nodeContract: {
        compiled: true,
        outputContract: {
          slots: [
            { type: "file", accept: [".docx"], maxCount: 1 },
            {
              type: "file",
              accept: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
              maxCount: 1,
            },
            { type: "file", accept: [".pptx"], maxCount: 1 },
            { type: "file", accept: ["application/pdf"], maxCount: 1 },
            { type: "file", accept: [".blend"], maxCount: 1 },
          ],
        },
      },
      text: [
        `Word：${docxPath}`,
        `Excel：${xlsxPath}`,
        `PPT：${pptxPath}`,
        `PDF：${pdfPath}`,
        `内部审计：${auditPath}`,
        `3D project: ${projectPath}`,
      ].join("\n"),
    });

    assert.deepEqual(
      artifacts.map((artifact) => artifact.uri),
      [docxPath, xlsxPath, pptxPath, pdfPath, projectPath].map((filePath) => path.resolve(filePath)),
    );
  });
});

test("legacy auto-output workers recover other newly delivered file types", async () => {
  await withWorkspace("legacy-files", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const archivePath = path.join(outputRoot, "website.zip");
    const audioPath = path.join(outputRoot, "narration.mp3");
    const notebookPath = path.join(outputRoot, "analysis.ipynb");
    for (const filePath of [archivePath, audioPath, notebookPath]) {
      await fs.writeFile(filePath, Buffer.from(path.basename(filePath)));
    }

    const artifacts = await collectWorkflowAgentArtifacts([], {
      cwd: workspace,
      sinceMs: Date.now() - 5_000,
      outputContract: { format: "auto", requiredArtifactTypes: [] },
      text: `压缩包：${archivePath}\n音频：${audioPath}\nNotebook：${notebookPath}`,
    });

    assert.deepEqual(
      artifacts.map((artifact) => artifact.uri),
      [archivePath, audioPath, notebookPath].map((filePath) => path.resolve(filePath)),
    );
  });
});

test("compiled pass-through and text slots never claim files from worker prose", async () => {
  await withWorkspace("non-generated", async (workspace) => {
    const outputRoot = path.join(workspace, "outputs");
    await fs.mkdir(outputRoot, { recursive: true });
    const filePath = path.join(outputRoot, "should-not-be-claimed.pdf");
    await fs.writeFile(filePath, Buffer.from("not-generated-output"));

    const artifacts = await collectWorkflowAgentArtifacts([], {
      cwd: workspace,
      nodeContract: {
        compiled: true,
        outputContract: {
          slots: [
            { type: "text", accept: ["text/plain"], maxCount: 1 },
            { type: "file", accept: [".pdf"], maxCount: 1, passThroughFromSlotId: "input-pdf" },
          ],
        },
      },
      text: `参考文件：${filePath}`,
    });

    assert.deepEqual(artifacts, []);
  });
});
