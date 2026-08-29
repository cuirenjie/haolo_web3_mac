import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendWorkflowMediaReferencesToPrompt,
  publishWorkflowMediaReferences,
} from "../src/main/workflow/media-reference-publisher.mjs";

test("workflow video references reuse an existing public URL without uploading", async () => {
  let uploadCalls = 0;
  const references = await publishWorkflowMediaReferences([{
    id: "upstream-image",
    name: "character.png",
    mime: "image/png",
    url: "https://cdn.example.test/character.png",
    slotId: "character-slot",
    sourceNodeId: "image-node",
  }], {
    async uploadFile() {
      uploadCalls += 1;
      throw new Error("should not upload");
    },
  });

  assert.equal(uploadCalls, 0);
  assert.deepEqual(references, [{
    id: "upstream-image",
    name: "character.png",
    type: "image",
    mime: "image/png",
    url: "https://cdn.example.test/character.png",
    slotId: "character-slot",
    sourceNodeId: "image-node",
    sourceSlotId: null,
    objectKey: null,
    materialId: null,
  }]);
});

test("local upstream images are uploaded once and injected as mandatory video inputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "haolo-workflow-media-"));
  try {
    const imagePath = path.join(root, "character.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const cache = new Map();
    const uploads = [];
    const options = {
      cwd: root,
      cache,
      async uploadFile(params) {
        uploads.push(params);
        return {
          attachment: {
            url: "https://youlebucket.example.test/material/character.png",
            object_key: "material/character.png",
            material_id: "material-character",
          },
        };
      },
    };
    const attachment = {
      id: "upstream-image",
      name: "character.png",
      mime: "image/png",
      local_path: imagePath,
      slotId: "character-slot",
      sourceNodeId: "image-node",
    };

    const first = await publishWorkflowMediaReferences([attachment], options);
    const second = await publishWorkflowMediaReferences([attachment], options);
    const prompt = appendWorkflowMediaReferencesToPrompt("生成角色打斗视频", first);

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].name, "character.png");
    assert.equal(uploads[0].mime, "image/png");
    assert.equal(Buffer.from(uploads[0].bytes).length, 4);
    assert.deepEqual(second, first);
    assert.match(prompt, /必须按类型逐项传入 --image-url 或 --video-url/);
    assert.match(prompt, /https:\/\/youlebucket\.example\.test\/material\/character\.png/);
    assert.match(prompt, /不得忽略这些引用/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publishing fails before video execution when upload returns no public URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "haolo-workflow-media-missing-url-"));
  try {
    const imagePath = path.join(root, "character.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await assert.rejects(
      publishWorkflowMediaReferences([{
        name: "character.png",
        mime: "image/png",
        local_path: imagePath,
      }], {
        async uploadFile() {
          return { attachment: { object_key: "material/character.png" } };
        },
      }),
      (error) => error?.code === "WORKFLOW_MEDIA_REFERENCE_URL_MISSING",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
