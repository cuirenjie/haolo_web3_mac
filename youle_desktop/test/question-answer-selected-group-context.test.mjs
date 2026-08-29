import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("question-answer current directory is bound only by the existing group picker", () => {
  const renderer = fs.readFileSync(
    path.join(projectRoot, "src", "renderer", "main.ts"),
    "utf8",
  );
  const main = fs.readFileSync(
    path.join(projectRoot, "src", "main", "main.mjs"),
    "utf8",
  );

  assert.doesNotMatch(renderer, /分组资料|toggle-current-group-access|composer-current-group-access/);
  assert.match(
    renderer,
    /const composerGroupIdForSend = groupIdForThreadContext\(threadId\);[\s\S]*?const currentGroupIdForSend = isDefaultThreadGroup\(composerGroupIdForSend\)[\s\S]*?\? null[\s\S]*?: composerGroupIdForSend/,
  );
  assert.match(
    renderer,
    /currentGroupContext:\s*questionAnswerCurrentGroupContext\([\s\S]*?params\.currentGroupId,[\s\S]*?interactionId,[\s\S]*?\)/,
  );
  assert.match(
    renderer,
    /function questionAnswerCurrentGroupContext\([\s\S]*?threadGroupById\(groupId\)[\s\S]*?isDefaultThreadGroup\(group\.id\)[\s\S]*?source:\s*"group_picker"[\s\S]*?groupId:\s*group\.id[\s\S]*?workspaceSlug:\s*threadGroupWorkspaceSlug\(group\)[\s\S]*?requestId/,
  );
  assert.match(
    main,
    /const context = params\?\.currentGroupContext[\s\S]*?context\.source !== "group_picker"[\s\S]*?groupId === DEFAULT_THREAD_GROUP_ID/,
  );
  assert.match(
    main,
    /resolveThreadGroupWorkspace\(context\)[\s\S]*?cwdMatchesSelectedGroup[\s\S]*?if \(!cwdMatchesSelectedGroup\) return null;[\s\S]*?issueQuestionAnswerCurrentGroupGrant\(\{[\s\S]*?cwd:\s*selectedWorkspace\.cwd,[\s\S]*?requestId,[\s\S]*?groupId/,
  );
});

test("default placeholder group cannot grant current-directory context", () => {
  const renderer = fs.readFileSync(
    path.join(projectRoot, "src", "renderer", "main.ts"),
    "utf8",
  );

  assert.match(
    renderer,
    /const selectedLabel = selectedIsDefaultGroup \? "选择分组" : threadGroupDisplayLabel\(selectedGroup\)/,
  );
  assert.match(
    renderer,
    /const currentGroupIdForSend = isDefaultThreadGroup\(composerGroupIdForSend\)\s*\? null/,
  );
});
