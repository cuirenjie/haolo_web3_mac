import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSource = readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
const mainSource = readFile(new URL("../src/main/main.mjs", import.meta.url), "utf8");
const videogenSkillSource = readFile(
  new URL("../resources/default-haolo-ai/skills/.system/videogen/SKILL.md", import.meta.url),
  "utf8",
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("normal chat no longer contains the video expert summon action or intent gate", async () => {
  const source = await rendererSource;

  assert.doesNotMatch(source, /NON_VIDEO_EXPERT_VIDEO_SKILL_ROUTE_ENABLED/);
  assert.doesNotMatch(source, /SUMMON_VIDEO_EXPERT/);
  assert.doesNotMatch(source, /summon-video-expert/);
  assert.doesNotMatch(source, /summon_video_expert/);
  assert.doesNotMatch(source, /召唤视频专家/);
  assert.doesNotMatch(source, /shouldShowVideoExpertSummonForNormalChat/);
  assert.doesNotMatch(source, /isExplicitVideoGenerationRequest/);
  assert.doesNotMatch(source, /normalChatEntryActions/);
  assert.doesNotMatch(source, /pendingNormalChatEntryActions/);
});

test("normal chat keeps direct videogen routing without a specialist follow-up", async () => {
  const source = await mainSource;

  const skillsBlock = sourceBlock(source, "function buildSkillsDeveloperInstructions", "function extractSkillsFromResult");
  assert.doesNotMatch(skillsBlock, /normalChatDeveloperSkills\(/);
  assert.doesNotMatch(source, /function normalChatDeveloperSkills/);
  assert.match(skillsBlock, /withMandatoryMediaSkillDefinitions\(/);

  const reminderBlock = sourceBlock(source, "function buildTurnMediaRoutingReminder", "function detectMediaGenerationKinds");
  assert.match(reminderBlock, /const routeImage = kinds\.image && byName\.has\("imagegen"\)/);
  assert.match(reminderBlock, /const routeVideo = kinds\.video && byName\.has\("videogen"\)/);
  assert.match(reminderBlock, /if \(!routeImage && !routeVideo\) return null;/);
  assert.match(reminderBlock, /On every image Director command include --conversation-id/);
  assert.match(reminderBlock, /starts at 1 point per generation/);
  assert.match(reminderBlock, /do not invent or substitute a separate interaction ID/);
  assert.match(reminderBlock, /Video route:/);
  assert.match(reminderBlock, /generate_seedance_video\.py path/);
  assert.match(reminderBlock, /AIHubCC grok-imagine-video-1\.5/);
  assert.match(reminderBlock, /Buming aihubcc\/grok-video-3\.5/);
  assert.match(reminderBlock, /AIHubCC omni-fast-no-water/);
  assert.match(reminderBlock, /fallback_adjustments/);
  assert.match(reminderBlock, /do not automatically select Seedance/i);
  assert.match(reminderBlock, /If a video submission returns no task ID/);
  assert.match(reminderBlock, /accept the possible duplicate-generation and billing risk/);
  assert.match(reminderBlock, /Once a task ID exists, never switch/);
  assert.match(reminderBlock, /Do not call view_image on a full-resolution reference/);
  assert.match(reminderBlock, /isVideoContinuationRequest\(userText\)/);
  assert.match(reminderBlock, /hasRecentVideoMediaJob\(cwd, mediaContext\.threadId\)/);
  assert.match(reminderBlock, /--resume-latest/);
  assert.match(reminderBlock, /This is reconciliation, not a new generation request/);
  assert.match(reminderBlock, /do not POST a replacement task/);

  const turnInputBlock = sourceBlock(
    source,
    "function buildTurnInputWithGroupMemory",
    "function stripHaoloInternalMessageBlocks",
  );
  assert.match(turnInputBlock, /buildTurnMediaRoutingReminder\(cleanText, cwd\)/);

  const developerBlock = sourceBlock(source, "function buildHaoloMediaDeveloperInstructions", "function buildAutomationDeveloperInstructions");
  assert.match(developerBlock, /Generate the requested video directly/);
  assert.doesNotMatch(developerBlock, /Video Expert entry button/);
  assert.match(developerBlock, /Video generation requests must use/);
  assert.match(developerBlock, /generate_seedance_video\.py path/);
  assert.match(developerBlock, /Start ordinary text-to-video and image-to-video with AIHubCC/);
  assert.match(developerBlock, /grok-imagine-video-1\.5/);
  assert.match(developerBlock, /aihubcc\/grok-video-3\.5/);
  assert.match(developerBlock, /omni-fast-no-water/);
  assert.match(developerBlock, /fresh --request-id for each next model/);
  assert.match(developerBlock, /do not automatically select Seedance/i);
  assert.doesNotMatch(developerBlock, /Seedance-2\.0-720p/);
  assert.match(developerBlock, /Never call view_image on a full-resolution attachment/);
});

test("videogen skill uses the guarded AIHubCC Grok, Buming Grok, then Omni chain", async () => {
  const source = await videogenSkillSource;

  assert.match(source, /Ordinary text-to-video and image-to-video requests start with AIHubCC `grok-imagine-video-1\.5`/);
  assert.match(source, /Do not automatically select a Seedance model/);
  assert.match(source, /Submit AIHubCC `grok-imagine-video-1\.5` first/);
  assert.match(source, /Advance one step to Buming `aihubcc\/grok-video-3\.5`, then AIHubCC `omni-fast-no-water`/);
  assert.match(source, /Any submit-stage failure that returns no task id may authorize the next configured model/);
  assert.match(source, /submission ambiguity intentionally advances to the next configured provider/);
  assert.match(source, /Once a task id has been accepted, never start another fallback/);
  assert.match(source, /Buming Grok uses a distinct nested contract/);
  assert.match(source, /Without an image, skip the image-only Buming fallback/);
});
