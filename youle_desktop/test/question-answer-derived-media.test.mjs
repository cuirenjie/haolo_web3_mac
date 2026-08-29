import assert from "node:assert/strict";
import test from "node:test";

import {
  questionAnswerVideoFrameExtractionRequest,
  videoFrameExtractionResponseText,
} from "../src/main/workflow/question-answer-derived-media.mjs";

test("video frame extraction uses only the semantically selected historical video", () => {
  const request = questionAnswerVideoFrameExtractionRequest({
    decision: {
      sourcePlan: {
        derivedMedia: {
          operation: "extract_video_frames",
          attachmentId: "video-selected",
          timestampsSeconds: [2.5, 6.7],
          labels: ["片段首帧", "片段尾帧"],
        },
      },
    },
    providerAttachments: [
      {
        id: "video-unrelated",
        name: "other.mp4",
        local_path: "D:/videos/other.mp4",
      },
      {
        id: "video-selected",
        name: "children.mp4",
        local_path: "D:/videos/children.mp4",
      },
    ],
  });

  assert.deepEqual(request, {
    operation: "extract_video_frames",
    attachmentId: "video-selected",
    name: "children.mp4",
    localPath: "D:/videos/children.mp4",
    timestampsSeconds: [2.5, 6.7],
    labels: ["片段首帧", "片段尾帧"],
  });
  assert.match(videoFrameExtractionResponseText(request), /2 张真实画面/);
  assert.match(videoFrameExtractionResponseText(request), /0:02\.5/);
  assert.match(videoFrameExtractionResponseText(request), /0:06\.7/);
});

test("video frame extraction fails closed without a local selected artifact", () => {
  assert.equal(questionAnswerVideoFrameExtractionRequest({
    decision: {
      sourcePlan: {
        derivedMedia: {
          operation: "extract_video_frames",
          attachmentId: "video-1",
          timestampsSeconds: [1],
        },
      },
    },
    providerAttachments: [{
      id: "video-1",
      name: "remote-only.mp4",
      url: "https://example.test/video.mp4",
    }],
  }), null);
});
