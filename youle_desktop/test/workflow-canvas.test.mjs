import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadWorkflowCanvasModule() {
  const source = await readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
  return import(moduleUrl);
}

const workflowCanvasModule = loadWorkflowCanvasModule();

const workflowNodeLogoUrls = Object.freeze({
  haolo: "logo-haolo.png",
  codex: "logo-codex.svg",
  claude: "logo-claude.svg",
  kimi: "logo-kimi.svg",
  deepseek: "logo-deepseek.svg",
  gemini: "logo-gemini.svg",
  grok: "logo-grok.svg",
  mimo: "logo-mimo.svg",
  perplexity: "logo-perplexity.svg",
  doubao: "logo-doubao.png",
  qwen: "logo-qwen.svg",
});

test("new workflow node titles continue the highest visible sequence without reusing deleted names", async () => {
  const { workflowCanvasNextDraftNodeTitle } = await workflowCanvasModule;

  assert.equal(workflowCanvasNextDraftNodeTitle([], "新增模型"), "新增模型");
  assert.equal(workflowCanvasNextDraftNodeTitle(["新增模型"], "新增模型"), "新增模型 2");
  assert.equal(workflowCanvasNextDraftNodeTitle(["新增模型 2"], "新增模型"), "新增模型 3");
  assert.equal(
    workflowCanvasNextDraftNodeTitle(["新增模型", "新增模型 2", "新增模型 4"], "新增模型"),
    "新增模型 5",
  );
  assert.equal(workflowCanvasNextDraftNodeTitle(["新增智能体 3"], "新增模型"), "新增模型");
});

test("legacy English node task is shown in Chinese in the editor", async () => {
  const { renderWorkflowNodeDialog } = await workflowCanvasModule;
  const legacyEnglishTask = "Given the user's runtime prompt text, produce a text output that follows and answers that prompt.";
  const dialog = renderWorkflowNodeDialog({
    threadId: "thread_legacy_english_task",
    nodes: [{
      id: "legacy-model",
      kind: "model",
      executorType: "external_model",
      title: "新增模型",
      provider: "claude",
      model: "claude-fable-5",
      prompt: `输入：\n- 提示词\n\n任务：\n${legacyEnglishTask}\n\n输出：\n- 文字`,
      dependsOn: [],
      status: "pending",
    }],
  }, "legacy-model", workflowNodeLogoUrls, { editable: true });

  assert.match(
    dialog,
    /根据用户在运行时提供的提示词，生成符合提示词要求并作出回答的文本输出。/,
  );
  assert.doesNotMatch(dialog, /Given the user's runtime prompt text/);
});

function workflowNode(id, kind, dependsOn = []) {
  return {
    id,
    kind,
    title: id,
    purpose: `${id} purpose`,
    provider: kind === "root" ? "codex" : "deepseek",
    model: kind === "model" ? "model" : null,
    dependsOn,
    status: "pending",
  };
}

test("workflow canvas panel width follows any widest node layer with 70px side padding", async () => {
  const {
    workflowCanvasMaxParallelNodeCount,
    workflowCanvasPreferredPanelWidth,
  } = await workflowCanvasModule;
  const oneColumn = [
    workflowNode("root-plan", "root"),
    workflowNode("local-context", "context", ["root-plan"]),
    workflowNode("draft", "model", ["local-context"]),
  ];
  const twoColumns = [
    ...oneColumn,
    workflowNode("review", "model", ["local-context"]),
  ];
  const threeColumns = [
    ...twoColumns,
    workflowNode("research", "model", ["local-context"]),
  ];
  const sevenColumns = [
    ...threeColumns,
    ...Array.from({ length: 4 }, (_, index) =>
      workflowNode(`additional-${index + 1}`, "model", ["local-context"]),
    ),
  ];

  assert.equal(workflowCanvasPreferredPanelWidth(oneColumn), 338);
  assert.ok(Math.abs(workflowCanvasPreferredPanelWidth(twoColumns) - 554.6666666666666) < 0.001);
  assert.ok(Math.abs(workflowCanvasPreferredPanelWidth(threeColumns) - 771.3333333333334) < 0.001);
  assert.ok(Math.abs(workflowCanvasPreferredPanelWidth(sevenColumns) - 1638) < 0.001);
  assert.equal(workflowCanvasMaxParallelNodeCount([]), 0);
  assert.equal(workflowCanvasMaxParallelNodeCount(oneColumn), 1);
  assert.equal(workflowCanvasMaxParallelNodeCount(twoColumns), 2);
  assert.equal(workflowCanvasMaxParallelNodeCount(threeColumns), 3);
  assert.equal(workflowCanvasMaxParallelNodeCount(sevenColumns), 7);
});

test("workflow canvas shows parallel nodes without a collaboration backdrop and keeps the review gate", async () => {
  const { layoutWorkflowGraph, renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const run = {
    id: "workflow-parallel-review",
    threadId: "thread-parallel-review",
    status: "running",
    complexityAssessment: {
      level: "complex",
      score: 5,
      strategy: "parallel_review",
      parallelReviewGroupCount: 1,
      maxParallelModels: 2,
    },
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      {
        ...workflowNode("candidate-a", "model", ["local-context"]),
        coordination: { mode: "parallel_candidate", parallelGroup: "critical", reviewTargets: [] },
      },
      {
        ...workflowNode("candidate-b", "model", ["local-context"]),
        coordination: { mode: "parallel_candidate", parallelGroup: "critical", reviewTargets: [] },
      },
      {
        ...workflowNode("independent-review", "model", ["candidate-a", "candidate-b"]),
        coordination: {
          mode: "review_gate",
          parallelGroup: "critical",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
    ],
  };

  const layout = layoutWorkflowGraph(run.nodes);
  const byId = new Map(layout.map((node) => [node.id, node]));
  assert.equal(byId.get("candidate-a").layer, byId.get("candidate-b").layer);
  assert.equal(byId.get("independent-review").layer, byId.get("candidate-a").layer + 1);

  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const dialog = renderWorkflowNodeDialog(run, "independent-review", workflowNodeLogoUrls);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(canvas, /workflow-parallel-lane|data-workflow-parallel-group/);
  assert.equal((canvas.match(/parallel-candidate/g) || []).length, 2);
  assert.match(canvas, /class="workflow-node model pending review-gate"/);
  assert.match(canvas, /class="workflow-edge pending review-gate"/);
  assert.match(dialog, /独立审核门/);
  assert.match(dialog, /candidate-a、candidate-b/);
  assert.doesNotMatch(styles, /\.workflow-parallel-lane(?:\s|>|\{)/);
  assert.match(styles, /\.workflow-node\.review-gate\s*\{/);
});

test("workflow canvas labels an explicitly requested three-model parallel group", async () => {
  const { renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const candidateIds = ["candidate-a", "candidate-b", "candidate-c"];
  const run = {
    id: "workflow-three-parallel",
    threadId: "thread-three-parallel",
    status: "running",
    complexityAssessment: {
      level: "complex",
      score: 5,
      strategy: "parallel_review",
      parallelReviewGroupCount: 1,
      maxParallelModels: 3,
    },
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      ...candidateIds.map((id) => ({
        ...workflowNode(id, "model", ["local-context"]),
        coordination: { mode: "parallel_candidate", parallelGroup: "research", reviewTargets: [] },
      })),
      {
        ...workflowNode("independent-review", "model", candidateIds),
        coordination: {
          mode: "review_gate",
          parallelGroup: "research",
          reviewTargets: candidateIds,
        },
      },
    ],
  };

  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const dialog = renderWorkflowNodeDialog(run, "candidate-a", workflowNodeLogoUrls);

  assert.doesNotMatch(canvas, /workflow-parallel-lane|data-workflow-parallel-group/);
  assert.equal((canvas.match(/parallel-candidate/g) || []).length, 3);
  assert.match(dialog, /三模型并行候选/);
  assert.match(dialog, /3 路独立产出/);
});

test("workflow canvas marks a dynamically dispatched third model as a timeout rescue", async () => {
  const { renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const run = {
    id: "workflow-timeout-rescue",
    threadId: "thread-timeout-rescue",
    status: "running",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      {
        ...workflowNode("candidate-a", "model", ["local-context"]),
        status: "failed",
        parallelTimeoutExhausted: true,
        coordination: { mode: "parallel_candidate", parallelGroup: "critical", reviewTargets: [] },
      },
      {
        ...workflowNode("candidate-b", "model", ["local-context"]),
        status: "failed",
        parallelTimeoutExhausted: true,
        coordination: { mode: "parallel_candidate", parallelGroup: "critical", reviewTargets: [] },
      },
      {
        ...workflowNode("critical-timeout-rescue", "model", ["local-context"]),
        coordination: {
          mode: "parallel_rescue",
          parallelGroup: "critical",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      {
        ...workflowNode("independent-review", "model", ["candidate-a", "candidate-b", "critical-timeout-rescue"]),
        coordination: {
          mode: "review_gate",
          parallelGroup: "critical",
          reviewTargets: ["candidate-a", "candidate-b", "critical-timeout-rescue"],
        },
      },
    ],
  };

  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const dialog = renderWorkflowNodeDialog(run, "critical-timeout-rescue", workflowNodeLogoUrls);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(canvas, /class="workflow-node model pending parallel-rescue"/);
  assert.match(canvas, /双路超时接替/);
  assert.match(dialog, /两个主节点都各自连续 3 次连接超时/);
  assert.match(styles, /\.workflow-node\.parallel-rescue\s*\{/);
});

test("workflow canvas folds root edges through the second node without mutating runtime dependencies", async () => {
  const { layoutWorkflowGraph, renderWorkflowCanvas } = await workflowCanvasModule;
  const nodes = [
    workflowNode("root-plan", "root"),
    workflowNode("local-context", "context", ["root-plan"]),
    workflowNode("research", "model", ["root-plan"]),
    workflowNode("review", "model", ["root-plan"]),
    workflowNode("delivery", "model", ["root-plan", "research"]),
  ];
  const dependenciesBeforeRender = nodes.map((node) => [...node.dependsOn]);
  const layout = layoutWorkflowGraph(nodes);
  const byId = new Map(layout.map((node) => [node.id, node]));

  assert.deepEqual(nodes.map((node) => node.dependsOn), dependenciesBeforeRender);
  assert.deepEqual(
    ["root-plan", "local-context", "research", "delivery"].map((id) => byId.get(id).layer),
    [0, 1, 2, 3],
  );
  assert.equal(byId.get("research").y, byId.get("review").y, "same-level nodes should share one row");
  assert.notEqual(byId.get("research").x, byId.get("review").x, "same-row nodes should occupy separate columns");
  assert.equal(byId.get("root-plan").width, 198);
  assert.equal(byId.get("root-plan").height, 116.16);
  assert.ok(byId.get("root-plan").y < byId.get("local-context").y);
  assert.ok(byId.get("local-context").y < byId.get("research").y);
  assert.ok(byId.get("research").y < byId.get("delivery").y);

  const markup = renderWorkflowCanvas({
    id: "workflow-test",
    threadId: "thread-test",
    status: "running",
    nodes,
  });
  const rootTargets = [...markup.matchAll(/data-workflow-edge-source="root-plan" data-workflow-edge-target="([^"]+)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(rootTargets, ["local-context"]);
  assert.match(markup, /data-workflow-edge-source="local-context" data-workflow-edge-target="research"/);
  assert.match(markup, /data-workflow-edge-source="local-context" data-workflow-edge-target="review"/);
  assert.doesNotMatch(markup, /data-workflow-edge-source="local-context" data-workflow-edge-target="delivery"/);
  assert.doesNotMatch(markup, /workflow-node-inspector|has-inspector|data-workflow-close-inspector/);
  assert.deepEqual(nodes.map((node) => node.dependsOn), dependenciesBeforeRender);
});

test("workflow node cards stay non-interactive until the workflow reaches a terminal state", async () => {
  const { renderWorkflowCanvas } = await workflowCanvasModule;
  const nodes = [
    { ...workflowNode("root-plan", "root"), status: "succeeded" },
    { ...workflowNode("research", "model", ["root-plan"]), status: "running" },
    workflowNode("delivery", "agent", ["research"]),
  ];
  const baseRun = {
    id: "workflow-node-interaction-lock",
    threadId: "thread-node-interaction-lock",
    nodes,
  };

  for (const status of ["planning", "running", "accepting"]) {
    const canvas = renderWorkflowCanvas({ ...baseRun, status });
    const cards = [...canvas.matchAll(/<button type="button" class="workflow-node[\s\S]*?<\/button>/g)]
      .map((match) => match[0]);

    assert.equal(cards.length, nodes.length, `${status} should render every runtime node card`);
    for (const card of cards) {
      assert.match(card, /\sdisabled(?:\s|>)/);
      assert.doesNotMatch(card, /data-action="open-workflow-node-dialog"|aria-haspopup="dialog"/);
      assert.match(card, /工作流执行中不可查看/);
    }
  }

  for (const status of ["succeeded", "failed", "cancelled"]) {
    const canvas = renderWorkflowCanvas({ ...baseRun, status });
    const cards = [...canvas.matchAll(/<button type="button" class="workflow-node[\s\S]*?<\/button>/g)]
      .map((match) => match[0]);

    assert.ok(cards.length > 0, `${status} should keep user-editable node cards`);
    for (const card of cards) {
      assert.doesNotMatch(card, /\sdisabled(?:\s|>)/);
      assert.match(card, /data-action="open-workflow-node-dialog"/);
      assert.match(card, /aria-haspopup="dialog"/);
    }
  }

  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.workflow-node:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-node:disabled\s*\{[^}]*cursor:\s*default;[^}]*opacity:\s*1;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node:hover:not\(:disabled\)/);
});

test("workflow node cards expose the accessible node editor used by the group-chat canvas", async () => {
  const { renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const run = {
    id: "workflow-dialog",
    threadId: "thread-dialog",
    status: "failed",
    contextPackage: {
      manifest: [{ relativePath: "materials/brief.md", mime: "text/markdown", size: 2048 }],
    },
    nodes: [
      { ...workflowNode("root-plan", "root"), title: "Haolo editor", status: "succeeded" },
      {
        ...workflowNode("review", "model", ["root-plan"]),
        title: "Quality review",
        prompt: "Review the final draft against the brief.",
        capabilityManifest: {
          protocolVersion: 1,
          capabilities: [
            { id: "model.inference", mode: "execute" },
            { id: "local.files.review", mode: "read_only_context_package" },
          ],
        },
        localFileReview: {
          capability: "local.files.review",
          status: "granted",
          reason: "user_intent_and_planner_request",
          contextPackageId: "context_review",
          grant: {
            id: "grant_review",
            issuedBy: "root-codex",
            access: "read_only",
            delegation: false,
            scope: { root: "D:/workspace", nodeId: "review", contextPackageId: "context_review" },
          },
        },
        contextPackage: {
          id: "context_review",
          manifest: [{ relativePath: "materials/brief.md", mime: "text/markdown", size: 2048 }],
        },
        status: "failed",
        result: {
          status: "failed",
          error: { code: "MODEL_TIMEOUT", message: "The provider timed out.", retryable: true },
          output: { data: { reviewedSections: 4 } },
          evidence: [{ source: "brief.md", matched: true }],
          confidence: 0.9,
          diagnostics: { durationMs: 4200, attempts: 2 },
        },
      },
    ],
  };
  const canvas = renderWorkflowCanvas(run, "review", workflowNodeLogoUrls);
  const dialog = renderWorkflowNodeDialog(
    run,
    "review",
    workflowNodeLogoUrls,
    {
      editable: true,
      sourceNodeId: "review",
      availableExecutors: [
        {
          executorType: "external_model",
          provider: "claude",
          model: "claude-sonnet-5",
          label: "Claude Sonnet 5",
        },
        {
          executorType: "external_model",
          provider: "gemini",
          model: "gemini-3.1-pro-preview",
          label: "Gemini 3.1 Pro Preview",
        },
      ],
      availableSkills: [],
    },
  );
  const continuedDialog = renderWorkflowNodeDialog(
    run,
    "review",
    workflowNodeLogoUrls,
    {
      editable: true,
      sourceNodeId: "review",
      availableSkills: [],
      suppressEntranceAnimation: true,
    },
  );
  const savingDialog = renderWorkflowNodeDialog(
    run,
    "review",
    workflowNodeLogoUrls,
    {
      editable: true,
      sourceNodeId: "review",
      availableSkills: [],
      saving: true,
    },
  );
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(canvas, /<button type="button" class="workflow-node model failed selected"/);
  assert.match(canvas, /data-action="open-workflow-node-dialog"/);
  assert.match(canvas, /data-workflow-thread-id="thread-dialog" data-workflow-node-id="review"/);
  assert.match(canvas, /aria-haspopup="dialog"/);
  assert.match(dialog, /<dialog class="workflow-node-dialog workflow-node-edit-dialog" open aria-modal="true"/);
  assert.match(dialog, /data-action="close-workflow-node-dialog"/);
  assert.doesNotMatch(dialog, /编辑节点/);
  assert.doesNotMatch(dialog, /workflow-node-dialog-continuation/);
  assert.match(
    continuedDialog,
    /workflow-node-dialog-backdrop workflow-node-dialog-continuation/,
  );
  assert.match(
    continuedDialog,
    /workflow-node-dialog workflow-node-edit-dialog workflow-node-dialog-continuation/,
  );
  assert.match(savingDialog, /data-workflow-node-edit-form[^>]*aria-busy="true"/);
  assert.match(savingDialog, /workflow-node-dialog-body" inert aria-disabled="true"/);
  assert.doesNotMatch(savingDialog, /workflow-node-dialog-reset|reset-workflow-node-draft|恢复原设置/);
  assert.match(savingDialog, /workflow-node-dialog-close[^>]* disabled/);
  assert.match(savingDialog, /workflow-node-edit-button secondary[^>]* disabled/);
  assert.match(savingDialog, /workflow-node-edit-button primary" disabled>Haolo 正在分析…/);
  assert.doesNotMatch(savingDialog, />保存修改<\/button>/);
  assert.match(dialog, /data-workflow-node-edit-form/);
  assert.match(dialog, /Quality review/);
  assert.match(dialog, /Review the final draft against the brief\./);
  assert.doesNotMatch(dialog, /The provider timed out\./);
  assert.doesNotMatch(dialog, /workflow-node-status/);
  assert.match(dialog, /保存修改/);
  assert.doesNotMatch(dialog, /workflow-node-dialog-reset|reset-workflow-node-draft|恢复原设置/);
  assert.match(dialog, /data-workflow-model-logo="deepseek"><img src="logo-deepseek\.svg"/);
  assert.match(dialog, /data-workflow-node-edit-avatar/);
  assert.match(dialog, /data-workflow-node-executor-value="external_model\|claude\|claude-sonnet-5"\s+data-workflow-model-logo="claude"/);
  assert.match(dialog, /value="external_model\|claude\|claude-sonnet-5"/);
  assert.match(dialog, /Claude Sonnet 5/);
  assert.match(dialog, /value="external_model\|gemini\|gemini-3\.1-pro-preview"/);
  assert.match(dialog, /Gemini 3\.1 Pro Preview/);
  assert.match(dialog, /aria-label="Claude系列"/);
  assert.match(dialog, /aria-label="Gemini系列"/);
  assert.match(
    mainSource,
    /function syncWorkflowNodeEditorAvatar\([\s\S]*option\.dataset\.workflowModelLogo[\s\S]*avatar\.dataset\.workflowModelLogo = logoKey;[\s\S]*image\.src = WORKFLOW_NODE_LOGO_URLS\[logoKey\]/,
  );
  assert.match(
    mainSource,
    /function selectWorkflowNodeExecutor\([\s\S]*syncWorkflowNodeEditorAvatar\(form, option\);[\s\S]*closeWorkflowNodeExecutorMenu\(form\)/,
  );
  assert.match(styles, /\.workflow-node-edit-dialog\s*\{[\s\S]*?max-height:/);
  assert.match(
    styles,
    /\.workflow-node-edit-dialog\s*\{[^}]*width:\s*min\(600px, calc\(100vw - 48px\)\);[^}]*max-height:\s*calc\(100vh - 32px\);/s,
  );
  assert.match(styles, /\.workflow-node-edit-dialog\s*\{[^}]*background:\s*#fff;/s);
  assert.match(styles, /\.workflow-node-edit-dialog \.workflow-node-dialog-header\s*\{[^}]*min-height:\s*39px;[^}]*gap:\s*8px;[^}]*border-bottom:\s*0;[^}]*background:\s*#fff;[^}]*padding:\s*6px 14px;/s);
  assert.match(styles, /\.workflow-node-edit-dialog \.workflow-node-dialog-header > \.workflow-node-avatar\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*flex-basis:\s*26px;[^}]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\)/s);
  assert.match(styles, /\.workflow-node-edit-dialog \.workflow-node-dialog-identity h2\s*\{[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);[^}]*font-weight:\s*400;[^}]*line-height:\s*18px;/s);
  assert.doesNotMatch(styles, /workflow-node-dialog-reset/);
  assert.match(styles, /\.workflow-node-edit-dialog \.workflow-node-dialog-close\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex-basis:\s*24px;/s);
  assert.match(styles, /\.workflow-node-edit-dialog \.workflow-node-dialog-body\s*\{[^}]*background:\s*#fff;/s);
  assert.match(
    styles,
    /\.workflow-node-edit-dialog \.workflow-node-dialog-body\s*\{[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-edit-form > \.workflow-node-dialog-body\s*\{[^}]*flex:\s*0 1 auto;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-executor-picker \.workflow-node-executor-menu\.composer-model-menu\.grouped\s*\{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*bottom:\s*auto;[^}]*max-height:\s*min\(\s*260px,\s*calc\(100vh - 420px\),\s*var\(--workflow-node-menu-available-height, 260px\)\s*\);[^}]*overscroll-behavior:\s*contain;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-executor-picker\.open-upward \.workflow-node-executor-menu\.composer-model-menu\.grouped\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*calc\(100% \+ 8px\);/s,
  );
  assert.match(styles, /\.workflow-node-editor-section\s*\{[^}]*border:\s*1px solid rgba\(84, 103, 136, 0\.11\);[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.workflow-node-dialog-body\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-edit-dialog/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-edit-dialog \.workflow-node-dialog-header\s*\{[^}]*background:\s*#1a1d23;/s);
  assert.match(styles, /\.workflow-node-edit-button\s*\{[^}]*min-width:\s*70px;[^}]*height:\s*34px;[^}]*border-radius:\s*9px;/s);
  assert.match(styles, /\.workflow-node-edit-button\.primary\s*\{[^}]*background:\s*#15171b;[^}]*color:\s*#fff;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-edit-button\.primary\s*\{[^}]*background:\s*#07090c;[^}]*color:\s*#fff;[^}]*box-shadow:\s*none;/s);
  assert.match(styles, /\.workflow-node-editor-settings\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;/s);
  assert.match(styles, /\.workflow-node-editor-settings-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(
    styles,
    /\.workflow-node-editor-setting\s*\{[^}]*grid-template-columns:\s*max-content minmax\(0, 280px\);[^}]*align-items:\s*center;[^}]*justify-content:\s*start;[^}]*gap:\s*12px;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-editor-setting-label,[\s\S]*?\.workflow-node-editor-field > \.workflow-node-editor-setting-label\s*\{[^}]*font-size:\s*calc\(10\.5px \+ var\(--app-font-size-offset\)\);[^}]*font-weight:\s*400;[^}]*line-height:\s*15px;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-editor-section > h3\s*\{[^}]*font-size:\s*calc\(10\.5px \+ var\(--app-font-size-offset\)\);[^}]*line-height:\s*15px;/s,
  );
  assert.match(styles, /\.workflow-node-editor-section > h3\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.workflow-node-editor-field > span\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-editor-settings\s*\{[^}]*background:\s*transparent;/s);
  assert.match(styles, /\.workflow-node-edit-footer\s*\{[^}]*border-top:\s*0;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-edit-footer\s*\{[^}]*border-top:\s*0;/s);
  assert.match(
    mainSource,
    /function placeWorkflowNodePickerMenu\([\s\S]*?\.workflow-node-edit-dialog[\s\S]*?availableAbove[\s\S]*?availableBelow[\s\S]*?menu\.scrollHeight > availableBelow[\s\S]*?classList\.toggle\("open-upward", openUpward\)[\s\S]*?--workflow-node-menu-available-height/,
  );
  assert.doesNotMatch(styles, /workflow-node-join-/);
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.copy-context-menu,[\s\S]*?html\[data-theme="dark"\] \.chat-title-group-menu,[\s\S]*?\{\s*border-color:\s*rgba\(255, 255, 255, 0\.085\);[^}]*background:\s*#1b1e23;/s,
  );
  assert.doesNotMatch(mainSource, /WorkflowNodeJoinQuorum|workflowNodeJoinMode|joinQuorum|openWorkflowNodeJoin/);
  assert.doesNotMatch(mainSource, /WorkflowNodeOutputMenu|WorkflowNodeOutputFormat|WorkflowNodeStructuredDataFormat/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-editor-section\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(
    styles,
    /\.workflow-node-dialog-backdrop\.workflow-node-dialog-continuation,[\s\S]*\.workflow-node-dialog\.workflow-node-dialog-continuation\s*\{[^}]*animation:\s*none;/,
  );
  assert.doesNotMatch(dialog, /style="[^"]*(?:color|background|border)/i);
  assert.match(mainSource, /workflowNodeDialog:\s*\{ threadId: string; nodeId: string; sourceNodeId\?: string \} \| null/);
  assert.match(
    mainSource,
    /function activeWorkflowNodeDialogMatchesRenderedForm\(\)[\s\S]*const sourceNodeId = selection\.sourceNodeId \|\| selection\.nodeId[\s\S]*form\.dataset\.workflowThreadId === selection\.threadId[\s\S]*form\.dataset\.workflowNodeId === sourceNodeId/,
  );
  assert.match(
    mainSource,
    /suppressEntranceAnimation:\s*workflowNodeDialogAlreadyRendered/,
  );
  assert.match(mainSource, /data-action="open-workflow-node-dialog"/);
  assert.match(
    mainSource,
    /function renderActiveWorkflowNodeDialog\([\s\S]*editable:\s*true,[\s\S]*availableSkills:\s*workflowCanvasDialogSkills\(\),[\s\S]*favoritePrompts:\s*state\.promptFavorites\.items\.map/,
  );
  assert.match(
    mainSource,
    /const run = ensureWorkflowCanvasRevisionDraft\(threadId\);[\s\S]*state\.workflowNodeDialog = \{ threadId, nodeId, sourceNodeId \}/,
  );
});

test("workflow node editor renders a populated definition form without mutating run history", async () => {
  const { renderWorkflowNodeDialog } = await workflowCanvasModule;
  const run = {
    id: "workflow-edit-dialog",
    threadId: "thread-edit-dialog",
    status: "succeeded",
    nodes: [
      {
        ...workflowNode("source", "model"),
        title: "资料分析",
        status: "succeeded",
      },
      {
        ...workflowNode("source-2", "model"),
        title: "事实核验",
        status: "succeeded",
      },
      {
        ...workflowNode("review", "model", ["source", "source-2"]),
        title: "独立审核",
        purpose: "核验上游结论",
        executorType: "external_model",
        provider: "gemini",
        model: "gemini-3.1-pro",
        executorCandidates: [
          { executorType: "external_model", provider: "gemini", model: "gemini-3.1-pro" },
          { executorType: "external_model", provider: "claude", model: "claude-fable-5" },
        ],
        joinPolicy: { mode: "all_required" },
        prompt: "比较上游结果并给出明确结论。",
        acceptance: ["覆盖全部上游结果", "明确指出冲突"],
        contextSelection: {
          needsLocalFiles: true,
          scope: ["current_group"],
          rationale: "需要核对原始资料",
        },
        skillBindings: [{ id: "document-review", name: "文档审查", version: "1.0.0", required: true }],
        capabilityRequest: {
          permissionProfile: "read_only",
          capabilities: ["filesystem.read"],
          resourceScope: { workspace: "current_group", paths: ["D:/workspace"] },
          sideEffectPolicy: "none",
          delegation: false,
          rationale: "读取证据",
        },
        capabilityGrant: {
          id: "grant_historical",
          permissionProfile: "read_only",
        },
        status: "succeeded",
        completedAt: "2026-07-29T12:00:00.000Z",
        result: {
          status: "succeeded",
          output: { text: "审核通过" },
          diagnostics: { durationMs: 1500, attempts: 1 },
        },
      },
    ],
  };
  const original = JSON.stringify(run);
  const dialog = renderWorkflowNodeDialog(
    run,
    "review",
    workflowNodeLogoUrls,
    {
      editable: true,
      sourceNodeId: "review",
      attachments: [
        {
          id: "upload-brief",
          name: "项目说明.pdf",
          mime: "application/pdf",
          size: 2048,
          iconUrl: "icon-pdf.svg",
          closeIconUrl: "icon-close.svg",
          uploadStatus: "uploaded",
        },
      ],
      availableSkills: [
        { id: "document-review", label: "文档审查", description: "核验文档内容" },
        { id: "imagegen", label: "图像生成" },
      ],
      favoritePrompts: [
        { id: "favorite-review", content: "按事实、结构和表达三个维度审查。" },
      ],
    },
  );

  assert.match(dialog, /workflow-node-dialog workflow-node-edit-dialog/);
  assert.doesNotMatch(dialog, /编辑节点/);
  assert.match(dialog, /data-workflow-node-edit-form/);
  assert.match(dialog, /<h2[^>]*>独立审核<\/h2>/);
  assert.doesNotMatch(dialog, /name="title"/);
  assert.doesNotMatch(dialog, /name="purpose"/);
  assert.match(dialog, /name="inputDefinition" hidden aria-hidden="true" tabindex="-1"[\s\S]*workflow-node-derived-input-note/);
  assert.doesNotMatch(dialog, /placeholder="说明运行时需要提供什么/);
  assert.match(dialog, /name="taskDefinition"[\s\S]*@文档审查[\s\S]*比较上游结果并给出明确结论。/);
  assert.match(dialog, /<textarea[^>]*name="taskDefinition"[^>]*data-workflow-node-mention-input[^>]*data-workflow-node-prompt/s);
  assert.match(dialog, /<textarea[^>]*name="outputDefinition"[^>]*data-workflow-node-mention-input/s);
  assert.match(dialog, />输入：<\/span>[\s\S]*>任务：<\/span>[\s\S]*>输出：<\/span>/);
  assert.doesNotMatch(dialog, /<h3>执行者<\/h3>/);
  assert.match(dialog, /data-action="pick-workflow-node-files"/);
  assert.match(
    dialog,
    /data-action="pick-workflow-node-files"[\s\S]*title="添加附件"[\s\S]*aria-label="添加附件"[\s\S]*<span>添加附件<\/span>[\s\S]*<svg/,
  );
  assert.match(dialog, /data-workflow-node-file-input/);
  assert.match(dialog, /data-workflow-node-attachment-id="upload-brief"/);
  assert.match(
    dialog,
    /data-workflow-node-attachments-wrap[\s\S]*data-workflow-node-attachment-scroll="left"[\s\S]*data-workflow-node-attachments[\s\S]*aria-label="已上传文件，左右滚动查看更多"[\s\S]*tabindex="0"[\s\S]*data-workflow-node-attachment-scroll="right"/,
  );
  assert.match(dialog, /项目说明\.pdf/);
  assert.match(dialog, /workflow-node-attachments pending-attachments/);
  assert.match(dialog, /class="pending-file uploaded"/);
  assert.match(dialog, /src="icon-pdf\.svg"/);
  assert.match(
    dialog,
    /data-workflow-node-attachments[\s\S]*workflow-node-contract-editor[\s\S]*name="taskDefinition"/,
  );
  assert.doesNotMatch(dialog, /添加 Skill|toggle-workflow-node-skill-menu/);
  assert.match(
    dialog,
    /workflow-node-prompt-toolbar-left[\s\S]*pick-workflow-node-files[\s\S]*workflow-node-executor-picker[\s\S]*select name="executor" aria-label="选择模型"/,
  );
  assert.match(dialog, /data-workflow-node-mention-root="favorites"[\s\S]*已收藏提示词/);
  assert.match(dialog, /data-workflow-node-mention-root="favorites"[\s\S]*composer-prompt-favorite-root-add" data-workflow-node-add-prompt-favorite>添加<\/span>/);
  assert.match(dialog, /data-workflow-node-mention-root="skills"[\s\S]*技能\/插件/);
  assert.doesNotMatch(dialog, /data-workflow-node-mention-root="threads"|引用会话/);
  assert.match(dialog, /data-workflow-node-mention-submenu="favorites"[\s\S]*按事实、结构和表达三个维度审查。/);
  assert.match(dialog, /composer-prompt-favorite-submenu[\s\S]*composer-prompt-favorite-row[\s\S]*composer-prompt-favorite-main[\s\S]*data-workflow-node-edit-prompt-favorite="favorite-review"[\s\S]*>编辑<\/span>/);
  assert.match(dialog, /data-workflow-node-mention-submenu="skills"[\s\S]*data-workflow-node-skill-id="document-review"/);
  assert.match(dialog, /<option[^>]*>gemini-3\.1-pro<\/option>/);
  assert.match(dialog, /<option[^>]*>claude-fable-5<\/option>/);
  assert.doesNotMatch(dialog, /<option[^>]*>[^<]*(?:外部模型|Haolo)[^<]*<\/option>/);
  assert.match(dialog, /data-action="toggle-workflow-node-executor-menu"/);
  assert.match(dialog, /composer-model-menu grouped workflow-node-executor-menu hidden/);
  assert.match(dialog, /composer-model-group-title">Gemini系列/);
  assert.match(dialog, /composer-model-group-title">Claude系列/);
  assert.match(dialog, /data-workflow-node-executor-value=/);
  assert.match(dialog, /data-workflow-node-prompt-highlight/);
  assert.doesNotMatch(dialog, /保存后用于下一次运行，历史结果不会改变/);
  assert.doesNotMatch(dialog, /name="inputSourceIds"/);
  assert.doesNotMatch(dialog, /<h3>输入来源<\/h3>/);
  assert.doesNotMatch(dialog, /汇聚条件|workflow-node-editor-setting join/);
  assert.doesNotMatch(dialog, /输出要求提示词|输出要求（每行一条）|name="outputRequirements"/);
  assert.doesNotMatch(
    dialog,
    /workflow-node-editor-section (?:join|output)/,
  );
  assert.doesNotMatch(dialog, /joinMode|joinQuorum|workflow-node-join-|等待全部上游节点完成|任一上游节点完成即可/);
  assert.doesNotMatch(dialog, /通过条件（选填）|name="joinCondition"/);
  assert.doesNotMatch(dialog, /输出要求提示词|name="outputRequirements"|覆盖全部上游结果/);
  assert.doesNotMatch(dialog, /输出格式|outputFormat|structuredDataFormat|outputSchema|workflow-node-structured/);
  assert.doesNotMatch(dialog, /name="skillIds"/);
  assert.doesNotMatch(dialog, /name="permissionProfile"/);
  assert.doesNotMatch(dialog, /name="capabilities"/);
  assert.doesNotMatch(dialog, /验收与风险/);
  assert.doesNotMatch(dialog, /查看不可变的执行事实|workflow-node-editor-history|workflow-node-history-details|grant_historical/);
  assert.match(dialog, /保存修改/);
  assert.equal(JSON.stringify(run), original);
});

test("a running fallback adds a node to the right and preserves the timed-out node as failed", async () => {
  const { layoutWorkflowGraph, renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const run = {
    id: "workflow-fallback",
    threadId: "thread-fallback",
    status: "running",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      {
        ...workflowNode("draft", "model", ["root-plan"]),
        title: "创作完整中文稿",
        status: "running",
        provider: "claude",
        model: "claude-sonnet-5",
        executorChoice: 2,
        maxExecutorChoices: 3,
        totalAttempts: 4,
        attempt: 1,
        maxAttempts: 3,
        retrying: false,
        executorHistory: [
          {
            executorChoice: 1,
            provider: "qwen",
            model: "qwen3.7-max",
            status: "failed",
            attempts: 3,
            error: {
              code: "UPSTREAM_TIMEOUT",
              message: "模型响应超时",
              category: "timeout",
              status: 502,
              upstreamStatus: 504,
              requestId: "cluster-request-canvas",
              retryAfterMs: 3500,
              routeExhausted: true,
              retryable: true,
            },
          },
        ],
      },
      { ...workflowNode("review", "model", ["draft"]), title: "后续审阅" },
    ],
  };

  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const layout = layoutWorkflowGraph(run.nodes);
  const failedNode = layout.find((node) => node.id === "draft");
  const replacementNode = layout.find((node) => node.id === "draft::executor:2");
  const failedDialog = renderWorkflowNodeDialog(run, "draft", workflowNodeLogoUrls);
  const replacementDialog = renderWorkflowNodeDialog(run, "draft::executor:2", workflowNodeLogoUrls);

  assert.ok(failedNode);
  assert.ok(replacementNode);
  assert.equal(failedNode.status, "failed");
  assert.equal(failedNode.model, "qwen3.7-max");
  assert.equal(replacementNode.status, "running");
  assert.equal(replacementNode.model, "claude-sonnet-5");
  assert.equal(failedNode.y, replacementNode.y);
  assert.ok(failedNode.x < replacementNode.x, "the replacement should be immediately to the failed node's right");
  assert.ok(Math.abs(replacementNode.x - failedNode.x - 198 - 28 * (2 / 3)) < 0.001);
  assert.match(canvas, /class="workflow-node model failed [^"]*"/);
  assert.match(canvas, /data-workflow-node-id="draft"/);
  assert.match(canvas, /data-workflow-node-id="draft::executor:2"/);
  assert.match(canvas, /data-workflow-source-node-id="draft"/);
  assert.match(canvas, /data-workflow-model-logo="qwen"><img src="logo-qwen\.svg"/);
  assert.match(canvas, /data-workflow-model-logo="claude"><img src="logo-claude\.svg"/);
  assert.match(canvas, /qwen3\.7-max/);
  assert.match(canvas, /claude-sonnet-5/);
  assert.match(canvas, /替补 2\/3/);
  assert.match(canvas, /data-workflow-edge-source="draft::executor:2" data-workflow-edge-target="review"/);
  assert.doesNotMatch(canvas, /data-workflow-edge-source="draft" data-workflow-edge-target="review"/);
  assert.match(failedDialog, /qwen3\.7-max/);
  assert.match(failedDialog, /失败信息/);
  assert.match(failedDialog, /模型响应超时/);
  assert.match(failedDialog, /累计尝试：3 次/);
  assert.match(failedDialog, /故障诊断/);
  assert.match(failedDialog, /错误码：UPSTREAM_TIMEOUT/);
  assert.match(failedDialog, /真实上游状态：HTTP 504/);
  assert.match(failedDialog, /请求 ID：cluster-request-canvas/);
  assert.match(failedDialog, /中转路由：账号级切换已耗尽/);
  assert.match(replacementDialog, /claude-sonnet-5/);
  assert.match(replacementDialog, /模型选择：2\/3/);
  assert.match(replacementDialog, /模型替补记录/);
  assert.match(replacementDialog, /第 1 选择 · 3 次尝试 · 失败 · 模型响应超时/);
});

test("workflow node dialogs preserve the infinite canvas viewport transform", async () => {
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(mainSource, /const clusterScroller = root\.querySelector<HTMLElement>\("\.cluster-workflow-viewport"\)/);
  assert.match(mainSource, /if \(clusterScroller\) \{[\s\S]*surface: "cluster"[\s\S]*viewportTransform: workflowCanvasViewportTransformForViewport\(clusterScroller\)/);
  assert.match(mainSource, /const scroller = root\.querySelector<HTMLElement>\("\.workflow"\)[\s\S]*surface: "timeline"/);
  assert.match(mainSource, /scrollTop: scroller\.scrollTop/);
  assert.match(mainSource, /scrollLeft: scroller\.scrollLeft/);
  assert.match(mainSource, /if \(previous\?\.surface === "cluster"\)[\s\S]*applyWorkflowCanvasViewportTransform\(viewport, previous\.viewportTransform\)/);
  assert.match(mainSource, /close-workflow-node-dialog[^]*?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(mainSource, /button\.focus\(\{ preventScroll: true \}\)/);
});

test("a new agent model picker matches grouped execution, image, and video choices", async () => {
  const { renderWorkflowNodeDialog } = await workflowCanvasModule;
  const agent = {
    ...workflowNode("new-agent", "agent", ["root-plan"]),
    executorType: "codex_subagent",
    provider: "haolo-codex-agent",
    model: "gpt-5.6-sol",
    executorCandidates: [{
      executorType: "codex_subagent",
      provider: "haolo-codex-agent",
      model: "gpt-5.6-sol",
    }],
  };
  const run = {
    id: "workflow-new-agent-models",
    threadId: "thread-new-agent-models",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("existing-model", "model", ["root-plan"]), provider: "claude", model: "claude-sonnet-5" },
      agent,
    ],
  };
  const dialog = renderWorkflowNodeDialog(
    run,
    agent.id,
    workflowNodeLogoUrls,
    {
      editable: true,
      newNode: true,
      availableExecutors: [
        { executorType: "codex_subagent", provider: "haolo-codex-agent", model: "gpt-5.6-sol" },
        { executorType: "codex_subagent", provider: "haolo-codex-agent", model: "gpt-5.6-terra" },
        {
          executorType: "codex_subagent",
          provider: "haolo-image-agent",
          model: "image2",
          groupLabel: "图片模型 · GPT",
          priceLabel: "1/次",
        },
        {
          executorType: "codex_subagent",
          provider: "haolo-video-agent",
          model: "omni-fast",
          groupLabel: "视频模型 · Gemini",
          priceLabel: "12/次",
        },
        { executorType: "codex_subagent", provider: "haolo-codex-agent", model: null, label: "默认模型" },
        { executorType: "external_model", provider: "claude", model: "claude-sonnet-5" },
      ],
    },
  );

  assert.match(dialog, /value="codex_subagent\|haolo-codex-agent\|gpt-5\.6-sol" selected/);
  assert.match(dialog, /data-workflow-node-edit-avatar data-workflow-model-logo="codex"><img src="logo-codex\.svg" class="dark-theme-white-agent-icon"/);
  assert.match(dialog, /value="codex_subagent\|haolo-codex-agent\|gpt-5\.6-terra"/);
  assert.match(dialog, /aria-label="GPT系列"/);
  assert.match(dialog, /value="codex_subagent\|haolo-image-agent\|image2"/);
  assert.match(dialog, /data-workflow-node-executor-value="codex_subagent\|haolo-image-agent\|image2"\s+data-workflow-model-logo="codex"/);
  assert.match(dialog, /aria-label="图片模型 · GPT"/);
  assert.match(dialog, /composer-model-option-name">image2<[\s\S]*composer-model-option-price">1\/次/);
  assert.match(dialog, /value="codex_subagent\|haolo-video-agent\|omni-fast"/);
  assert.match(dialog, /data-workflow-node-executor-value="codex_subagent\|haolo-video-agent\|omni-fast"\s+data-workflow-model-logo="gemini"/);
  assert.match(dialog, /aria-label="视频模型 · Gemini"/);
  assert.match(dialog, /composer-model-option-name">omni-fast<[\s\S]*composer-model-option-price">12\/次/);
  assert.match(dialog, /name="inputDefinition" hidden aria-hidden="true" tabindex="-1"[\s\S]*workflow-node-derived-input-note/);
  assert.doesNotMatch(dialog, /placeholder="说明运行时需要提供什么/);
  assert.match(dialog, /name="taskDefinition"[\s\S]*placeholder="说明这个节点要完成什么；输入 @ 可以调用 Skill"/);
  assert.match(dialog, /name="outputDefinition"[\s\S]*placeholder="说明要输出什么/);
  assert.doesNotMatch(dialog, /name="outputRequirements"|输出要求提示词/);
  assert.doesNotMatch(dialog, /独立完成该节点承担的任务|完成该节点承担的任务|结果清晰完整|结果必须完整回应节点职责/);
  assert.doesNotMatch(dialog, /默认模型/);
  assert.doesNotMatch(dialog, /claude-sonnet-5|Claude系列|external_model/);
});

test("workflow canvas reorders adjacent layers to avoid avoidable edge crossings", async () => {
  const { layoutWorkflowGraph } = await workflowCanvasModule;
  const layout = layoutWorkflowGraph([
    workflowNode("root-plan", "root"),
    workflowNode("local-context", "context", ["root-plan"]),
    workflowNode("left-parent", "model", ["root-plan"]),
    workflowNode("right-parent", "model", ["root-plan"]),
    workflowNode("right-child", "model", ["right-parent"]),
    workflowNode("left-child", "model", ["left-parent"]),
  ]);
  const byId = new Map(layout.map((node) => [node.id, node]));

  assert.ok(byId.get("left-parent").x < byId.get("right-parent").x);
  assert.ok(byId.get("left-child").x < byId.get("right-child").x);
  assert.equal(byId.get("left-parent").y, byId.get("right-parent").y);
  assert.equal(byId.get("left-child").y, byId.get("right-child").y);
});

test("workflow canvas routes long edges through side lanes instead of intermediate cards", async () => {
  const { renderWorkflowCanvas } = await workflowCanvasModule;
  const markup = renderWorkflowCanvas({
    id: "workflow-long-edge",
    threadId: "thread-long-edge",
    status: "running",
    nodes: [
      workflowNode("root-plan", "root"),
      workflowNode("local-context", "context", ["root-plan"]),
      workflowNode("independent", "model", ["root-plan"]),
      workflowNode("middle", "model", ["root-plan"]),
      workflowNode("tail", "model", ["middle"]),
      workflowNode("final", "root", ["independent", "tail"]),
    ],
  });
  const longEdge = markup.match(/data-workflow-edge-source="independent" data-workflow-edge-target="final" d="([^"]+)"/);

  assert.ok(longEdge, "expected the long independent-to-final edge");
  assert.match(longEdge[1], / L /, "long edges should use a side-lane segment");
  assert.match(markup, /class="workflow-graph"/);
});

test("workflow toolbar shows the canvas title without run status or progress", async () => {
  const { renderWorkflowCanvas, renderWorkflowToolbar } = await workflowCanvasModule;
  const run = {
    id: "workflow-toolbar",
    threadId: "thread-toolbar",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("delivery", "model", ["root-plan"]), status: "succeeded" },
    ],
  };
  const toolbar = renderWorkflowToolbar(run);
  const canvas = renderWorkflowCanvas(run);

  assert.match(toolbar, /<div class="cluster-workflow-toolbar">/);
  assert.match(toolbar, /class="cluster-workflow-toolbar-title" role="heading" aria-level="2">画布<\/span>/);
  assert.doesNotMatch(toolbar, /<h2|<header/);
  assert.doesNotMatch(toolbar, /目标已交付|执行未达成|Haolo 终验中|cluster-workflow-progress|\d+\/\d+/);
  assert.doesNotMatch(canvas, /cluster-workflow-toolbar/);
});

test("empty workflow canvas centers the right-click node hint in both themes", async () => {
  const { renderWorkflowCanvas } = await workflowCanvasModule;
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const emptyCanvas = renderWorkflowCanvas({
    id: "workflow-empty-tutorial",
    threadId: "thread-empty-tutorial",
    status: "succeeded",
    nodes: [],
  });
  const populatedCanvas = renderWorkflowCanvas({
    id: "workflow-populated-tutorial",
    threadId: "thread-populated-tutorial",
    status: "succeeded",
    nodes: [{ ...workflowNode("draft", "model"), status: "succeeded" }],
  });

  assert.match(
    emptyCanvas,
    /class="workflow-canvas-empty-hint" role="status" aria-label="右键添加节点"/,
  );
  assert.match(
    emptyCanvas,
    /<div class="workflow-canvas-empty-hint"[^>]*>\s*<span>右键添加节点<\/span>\s*<\/div>/,
  );
  assert.doesNotMatch(emptyCanvas, /观看教程，创作画布/);
  assert.doesNotMatch(populatedCanvas, /workflow-canvas-empty-hint|右键添加节点/);
  assert.match(
    styles,
    /\.workflow-canvas-empty-hint\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s,
  );
  assert.match(
    styles,
    /\.workflow-canvas-empty-hint\s*\{[^}]*font-size:\s*calc\(16px \+ var\(--app-font-size-offset\)\);/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-canvas-empty-hint\s*\{[^}]*color:\s*#c3c8d2;/s,
  );
});

test("terminal workflow canvas hides system nodes without deleting them and restores them for a new run", async () => {
  const {
    renderWorkflowCanvas,
    renderWorkflowNodeDialog,
    workflowCanvasPresentationNodes,
  } = await workflowCanvasModule;
  const nodes = [
    { ...workflowNode("root-plan", "root"), title: "Haolo 编排", status: "succeeded" },
    {
      ...workflowNode("local-context", "context", ["root-plan"]),
      title: "本地材料",
      status: "succeeded",
    },
    {
      ...workflowNode("review", "model", ["local-context"]),
      title: "内容评审",
      status: "succeeded",
    },
    {
      ...workflowNode("delivery", "agent", ["review"]),
      title: "生成 Markdown",
      status: "succeeded",
    },
    {
      ...workflowNode("root-acceptance", "root", ["delivery"]),
      title: "终验与交付",
      status: "succeeded",
    },
  ];
  const completedRun = {
    id: "workflow-completed-presentation",
    threadId: "thread-completed-presentation",
    status: "succeeded",
    nodes,
  };

  const completedCanvas = renderWorkflowCanvas(completedRun, null, workflowNodeLogoUrls);
  const presentationNodes = workflowCanvasPresentationNodes(completedRun);

  assert.equal(completedRun.nodes.length, 5, "presentation filtering must not mutate persisted run history");
  assert.deepEqual(presentationNodes.map((node) => node.id), ["review", "delivery"]);
  assert.doesNotMatch(completedCanvas, /Haolo 编排|本地材料|终验与交付/);
  assert.match(completedCanvas, /内容评审/);
  assert.match(completedCanvas, /生成 Markdown/);
  assert.equal(
    renderWorkflowNodeDialog(completedRun, "root-plan", workflowNodeLogoUrls),
    "",
    "a system-node dialog must also disappear when the run reaches a terminal state",
  );

  const rerunningRun = {
    ...completedRun,
    id: "workflow-rerunning-presentation",
    status: "running",
    nodes: nodes.map((node) => ({ ...node, status: "pending" })),
  };
  const rerunningCanvas = renderWorkflowCanvas(rerunningRun, null, workflowNodeLogoUrls);

  assert.match(rerunningCanvas, /Haolo 编排/);
  assert.match(rerunningCanvas, /本地材料/);
  assert.match(rerunningCanvas, /终验与交付/);
});

test("workflow canvas inserts nodes in parallel rows or creates a complete row in every surrounding gap", async () => {
  const {
    captureWorkflowCanvasLayout,
    deleteWorkflowCanvasEdge,
    deleteWorkflowCanvasNode,
    deleteWorkflowCanvasNodeFromLayoutSnapshot,
    insertWorkflowCanvasNode,
    insertWorkflowCanvasNodeIntoLayoutSnapshot,
    layoutWorkflowGraph,
    removeWorkflowCanvasEdgeFromLayoutSnapshot,
    workflowCanvasGridRowXPositions,
    workflowCanvasEditableLayers,
    workflowCanvasPresentationNodes,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-structural-draft",
    threadId: "thread-structural-draft",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("candidate-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("candidate-b", "model", ["local-context"]), status: "succeeded" },
      {
        ...workflowNode("review", "model", ["candidate-a", "candidate-b"]),
        status: "succeeded",
        coordination: {
          mode: "review_gate",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      { ...workflowNode("delivery", "agent", ["review"]), status: "succeeded" },
      { ...workflowNode("root-acceptance", "root", ["delivery"]), status: "succeeded" },
    ],
  };
  const newNode = (id) => ({
    ...workflowNode(id, "model"),
    inputBindings: [],
    joinPolicy: null,
    outputContract: { format: "text", requirements: ["usable output"] },
  });

  const emptyRun = {
    id: "workflow-empty-structural-draft",
    threadId: "thread-empty-structural-draft",
    status: "succeeded",
    nodes: [
      { ...workflowNode("empty-root-plan", "root"), status: "succeeded" },
      { ...workflowNode("empty-root-acceptance", "root", ["empty-root-plan"]), status: "succeeded" },
    ],
  };
  const emptyTarget = {
    placement: "between",
    previousLayer: null,
    nextLayer: null,
  };
  const emptyLayout = captureWorkflowCanvasLayout(emptyRun);
  assert.deepEqual(emptyLayout.nodePositions, {});
  const firstNodeRun = insertWorkflowCanvasNode(
    emptyRun,
    newNode("first-visible-node"),
    emptyTarget,
    emptyLayout,
  );
  const firstNodeLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    emptyLayout,
    firstNodeRun,
    "first-visible-node",
    emptyTarget,
    { x: 240, y: 180 },
  );
  assert.deepEqual(firstNodeRun.nodes.find((node) => node.id === "first-visible-node").dependsOn, []);
  assert.deepEqual(firstNodeLayout.nodePositions["first-visible-node"], {
    x: 70,
    y: 50,
    layer: 0,
  });
  assert.deepEqual(firstNodeLayout.entryNodeIds, ["first-visible-node"]);

  assert.deepEqual(
    workflowCanvasEditableLayers(run).map((layer) => layer.sourceNodeIds),
    [["candidate-a", "candidate-b"], ["review"], ["delivery"]],
  );
  const assertNodesUseFixedGrid = (layout) => {
    const rows = new Map();
    for (const [nodeId, position] of Object.entries(layout.nodePositions)) {
      const row = rows.get(position.layer) || [];
      row.push({ nodeId, position });
      rows.set(position.layer, row);
    }
    for (const row of rows.values()) {
      row.sort((left, right) => left.position.x - right.position.x);
      const expectedXs = workflowCanvasGridRowXPositions(layout.width, row.length);
      row.forEach(({ nodeId, position }, index) => {
        assert.ok(
          Math.abs(position.x - expectedXs[index]) < 0.000001,
          `${nodeId} must occupy a fixed canvas column`,
        );
      });
    }
  };

  const parallel = insertWorkflowCanvasNode(
    run,
    newNode("candidate-c"),
    { placement: "parallel", layer: 0 },
  );
  const parallelById = new Map(parallel.nodes.map((node) => [node.id, node]));
  const parallelLayout = new Map(
    layoutWorkflowGraph(workflowCanvasPresentationNodes(parallel))
      .map((node) => [node.id, node]),
  );
  assert.deepEqual(parallelById.get("candidate-c").dependsOn, ["local-context"]);
  assert.deepEqual(parallelById.get("review").dependsOn, [
    "candidate-a",
    "candidate-b",
    "candidate-c",
  ]);
  assert.deepEqual(parallelById.get("review").coordination.reviewTargets, [
    "candidate-a",
    "candidate-b",
    "candidate-c",
  ]);
  assert.equal(parallelLayout.get("candidate-c").layer, parallelLayout.get("candidate-a").layer);
  assert.ok(parallelLayout.get("candidate-c").x > parallelLayout.get("candidate-b").x);

  const orderedFrozenLayout = captureWorkflowCanvasLayout(run);
  const orderedParallelRun = insertWorkflowCanvasNode(
    run,
    newNode("candidate-between-a-b"),
    { placement: "parallel", layer: 0 },
    orderedFrozenLayout,
  );
  const orderedParallelLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    orderedFrozenLayout,
    orderedParallelRun,
    "candidate-between-a-b",
    { placement: "parallel", layer: 0 },
    {
      x: orderedFrozenLayout.nodePositions["candidate-b"].x + 80,
      y: orderedFrozenLayout.nodePositions["candidate-b"].y + 20,
    },
  );
  assertNodesUseFixedGrid(orderedParallelLayout);
  assert.ok(
    orderedParallelLayout.nodePositions["candidate-between-a-b"].x
      < orderedParallelLayout.nodePositions["candidate-a"].x,
  );

  const beforeFirst = insertWorkflowCanvasNode(
    run,
    newNode("before-candidates"),
    { placement: "between", previousLayer: null, nextLayer: 0 },
  );
  const beforeFirstById = new Map(beforeFirst.nodes.map((node) => [node.id, node]));
  assert.deepEqual(beforeFirstById.get("before-candidates").dependsOn, ["local-context"]);
  assert.deepEqual(beforeFirstById.get("candidate-a").dependsOn, ["before-candidates"]);
  assert.deepEqual(beforeFirstById.get("candidate-b").dependsOn, ["before-candidates"]);

  const betweenRows = insertWorkflowCanvasNode(
    run,
    newNode("between-candidates-review"),
    { placement: "between", previousLayer: 0, nextLayer: 1 },
  );
  const betweenById = new Map(betweenRows.nodes.map((node) => [node.id, node]));
  assert.deepEqual(
    betweenById.get("between-candidates-review").dependsOn,
    ["candidate-a", "candidate-b"],
  );
  assert.deepEqual(betweenById.get("review").dependsOn, ["between-candidates-review"]);
  assert.deepEqual(betweenById.get("review").coordination.reviewTargets, [
    "between-candidates-review",
  ]);

  const verticallyAlignedInsertion = insertWorkflowCanvasNode(
    run,
    newNode("between-review-delivery"),
    { placement: "between", previousLayer: 1, nextLayer: 2 },
  );
  const betweenRowsFrozenLayout = captureWorkflowCanvasLayout(run);
  const betweenRowsLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    betweenRowsFrozenLayout,
    verticallyAlignedInsertion,
    "between-review-delivery",
    { placement: "between", previousLayer: 1, nextLayer: 2 },
    {
      x: betweenRowsFrozenLayout.nodePositions.review.x + 150,
      y: betweenRowsFrozenLayout.nodePositions.review.y + 140,
    },
  );
  assert.equal(
    betweenRowsLayout.nodePositions["between-review-delivery"].x,
    betweenRowsFrozenLayout.nodePositions.review.x,
    "a node inserted between vertically aligned rows should inherit their column",
  );
  assert.equal(
    betweenRowsLayout.nodePositions["between-review-delivery"].x,
    betweenRowsFrozenLayout.nodePositions.delivery.x,
  );
  assert.equal(
    betweenRowsLayout.nodePositions.review.x,
    betweenRowsFrozenLayout.nodePositions.review.x,
  );
  assert.equal(
    betweenRowsLayout.nodePositions.delivery.x,
    betweenRowsFrozenLayout.nodePositions.delivery.x,
  );

  const afterLast = insertWorkflowCanvasNode(
    run,
    newNode("after-delivery"),
    { placement: "between", previousLayer: 2, nextLayer: null },
  );
  assert.deepEqual(
    afterLast.nodes.find((node) => node.id === "after-delivery").dependsOn,
    ["delivery"],
  );

  const disconnectedRun = deleteWorkflowCanvasEdge(run, "review", "delivery");
  const frozenLayout = removeWorkflowCanvasEdgeFromLayoutSnapshot(
    captureWorkflowCanvasLayout(run),
    "review",
    "delivery",
  );
  assert.deepEqual(
    workflowCanvasEditableLayers(disconnectedRun).map((layer) => layer.sourceNodeIds),
    [["candidate-a", "candidate-b", "delivery"], ["review"]],
  );
  assert.deepEqual(
    workflowCanvasEditableLayers(disconnectedRun, frozenLayout)
      .map((layer) => layer.sourceNodeIds),
    [["candidate-a", "candidate-b"], ["review"], ["delivery"]],
  );

  const parallelWithFrozenLayout = insertWorkflowCanvasNode(
    disconnectedRun,
    newNode("parallel-with-delivery"),
    { placement: "parallel", layer: 2 },
    frozenLayout,
  );
  const nextFrozenLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    frozenLayout,
    parallelWithFrozenLayout,
    "parallel-with-delivery",
    { placement: "parallel", layer: 2 },
    {
      x: 720,
      y: frozenLayout.nodePositions.delivery.y + 20,
    },
  );
  assertNodesUseFixedGrid(nextFrozenLayout);
  assert.equal(nextFrozenLayout.nodePositions["parallel-with-delivery"].layer, 2);
  assert.equal(
    nextFrozenLayout.nodePositions["parallel-with-delivery"].y,
    frozenLayout.nodePositions.delivery.y,
  );
  assert.ok(
    nextFrozenLayout.nodePositions["parallel-with-delivery"].x
      > nextFrozenLayout.nodePositions.delivery.x,
  );
  assert.deepEqual(nextFrozenLayout.edges, frozenLayout.edges);
  assert.equal(
    layoutWorkflowGraph(workflowCanvasPresentationNodes(parallelWithFrozenLayout))
      .find((node) => node.id === "parallel-with-delivery").layer,
    0,
  );

  const parallelOnLeftRun = insertWorkflowCanvasNode(
    disconnectedRun,
    newNode("parallel-on-left"),
    { placement: "parallel", layer: 2 },
    frozenLayout,
  );
  const parallelOnLeftLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    frozenLayout,
    parallelOnLeftRun,
    "parallel-on-left",
    { placement: "parallel", layer: 2 },
    {
      x: frozenLayout.nodePositions.delivery.x - 20,
      y: frozenLayout.nodePositions.delivery.y + 20,
    },
  );
  assert.ok(
    parallelOnLeftLayout.nodePositions["parallel-on-left"].x
      < parallelOnLeftLayout.nodePositions.delivery.x,
  );
  assert.equal(parallelOnLeftLayout.nodePositions["parallel-on-left"].x, 70);
  assertNodesUseFixedGrid(parallelOnLeftLayout);

  const anchoredLeftTarget = {
    placement: "parallel",
    layer: 2,
    anchorNodeId: "delivery",
    anchorDisplayNodeId: "delivery",
    side: "left",
  };
  const anchoredLeftRun = insertWorkflowCanvasNode(
    disconnectedRun,
    newNode("anchored-parallel-on-left"),
    anchoredLeftTarget,
    frozenLayout,
  );
  assert.ok(
    anchoredLeftRun.nodes.findIndex((node) => node.id === "anchored-parallel-on-left")
      < anchoredLeftRun.nodes.findIndex((node) => node.id === "delivery"),
  );
  const anchoredLeftLayout = insertWorkflowCanvasNodeIntoLayoutSnapshot(
    frozenLayout,
    anchoredLeftRun,
    "anchored-parallel-on-left",
    anchoredLeftTarget,
    {
      x: frozenLayout.width + 1_000,
      y: frozenLayout.nodePositions.delivery.y + 20,
    },
  );
  assert.ok(
    anchoredLeftLayout.nodePositions["anchored-parallel-on-left"].x
      < anchoredLeftLayout.nodePositions.delivery.x,
    "the semantic left-side anchor must win even if a stale pointer coordinate is far to the right",
  );
  assert.equal(anchoredLeftLayout.nodePositions["anchored-parallel-on-left"].x, 70);
  assertNodesUseFixedGrid(anchoredLeftLayout);

  const combinedDeletionRun = deleteWorkflowCanvasNode(
    parallelWithFrozenLayout,
    "delivery",
  );
  const combinedDeletionLayout = deleteWorkflowCanvasNodeFromLayoutSnapshot(
    nextFrozenLayout,
    parallelWithFrozenLayout,
    combinedDeletionRun,
    "delivery",
  );
  assert.equal(combinedDeletionLayout.nodePositions.delivery, undefined);
  assertNodesUseFixedGrid(combinedDeletionLayout);
  assert.deepEqual(combinedDeletionLayout.edges, nextFrozenLayout.edges);
});

test("workflow canvas deletes a node and its incident edges without an implicit bypass", async () => {
  const {
    captureWorkflowCanvasLayout,
    deleteWorkflowCanvasNode,
    deleteWorkflowCanvasNodeFromLayoutSnapshot,
    layoutWorkflowGraph,
    workflowCanvasGridLayerY,
    workflowCanvasGridRowXPositions,
    workflowCanvasPresentationNodes,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-delete-node",
    threadId: "thread-delete-node",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("candidate-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("candidate-b", "model", ["local-context"]), status: "succeeded" },
      {
        ...workflowNode("review", "model", ["candidate-a", "candidate-b"]),
        status: "succeeded",
        coordination: {
          mode: "review_gate",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      { ...workflowNode("delivery", "agent", ["review"]), status: "succeeded" },
      { ...workflowNode("root-acceptance", "root", ["delivery"]), status: "succeeded" },
    ],
  };

  const withoutReview = deleteWorkflowCanvasNode(run, "review");
  const withoutReviewById = new Map(withoutReview.nodes.map((node) => [node.id, node]));
  assert.equal(withoutReviewById.has("review"), false);
  assert.deepEqual(withoutReviewById.get("delivery").dependsOn, []);
  const compactedLayout = new Map(
    layoutWorkflowGraph(workflowCanvasPresentationNodes(withoutReview))
      .map((node) => [node.id, node]),
  );
  assert.equal(compactedLayout.get("delivery").layer, 0);
  const frozenLayout = captureWorkflowCanvasLayout(run);
  const deletionLayout = deleteWorkflowCanvasNodeFromLayoutSnapshot(
    frozenLayout,
    run,
    withoutReview,
    "review",
  );
  assert.equal(deletionLayout.nodePositions.review, undefined);
  assert.equal(deletionLayout.nodePositions.delivery.layer, 1);
  assert.equal(deletionLayout.nodePositions.delivery.y, workflowCanvasGridLayerY(1));
  const candidateXs = ["candidate-a", "candidate-b"]
    .map((nodeId) => deletionLayout.nodePositions[nodeId].x)
    .sort((left, right) => left - right);
  assert.deepEqual(
    candidateXs,
    workflowCanvasGridRowXPositions(deletionLayout.width, 2),
    "deleting a row must compact every remaining card back onto the fixed grid",
  );
  assert.deepEqual(
    deletionLayout.edges
      .map((edge) => [edge.sourceNodeId, edge.targetNodeId])
      .sort(),
    [],
  );

  const withoutCandidate = deleteWorkflowCanvasNode(run, "candidate-a");
  const withoutCandidatePresentation = new Map(
    workflowCanvasPresentationNodes(withoutCandidate).map((node) => [node.id, node]),
  );
  assert.deepEqual(withoutCandidatePresentation.get("review").dependsOn, ["candidate-b"]);
  assert.deepEqual(
    withoutCandidate.nodes.find((node) => node.id === "review").coordination.reviewTargets,
    ["candidate-b"],
  );

  const singleNodeRun = {
    id: "workflow-delete-only-node",
    threadId: "thread-delete-only-node",
    status: "failed",
    nodes: [
      { ...workflowNode("only-root-plan", "root"), status: "succeeded" },
      { ...workflowNode("only-agent", "agent", ["only-root-plan"]), status: "failed" },
      { ...workflowNode("only-root-acceptance", "root", ["only-agent"]), status: "failed" },
    ],
  };
  const singleNodeLayout = captureWorkflowCanvasLayout(singleNodeRun);
  const emptyRun = deleteWorkflowCanvasNode(singleNodeRun, "only-agent");
  const emptyLayout = deleteWorkflowCanvasNodeFromLayoutSnapshot(
    singleNodeLayout,
    singleNodeRun,
    emptyRun,
    "only-agent",
  );
  assert.deepEqual(workflowCanvasPresentationNodes(emptyRun), []);
  assert.deepEqual(emptyLayout.nodePositions, {});
  assert.deepEqual(emptyLayout.entryNodeIds, []);
  assert.deepEqual(emptyLayout.edges, []);

  assert.equal(
    deleteWorkflowCanvasNode(run, "root-plan"),
    run,
    "hidden system nodes must never be deleted from the revision graph",
  );
  assert.equal(run.nodes.length, 7, "deleting from a revision must not mutate run history");
});

test("completed workflow edges reveal a one-third delete control that removes only that dependency", async () => {
  const {
    captureWorkflowCanvasLayout,
    deleteWorkflowCanvasEdge,
    removeWorkflowCanvasEdgeFromLayoutSnapshot,
    renderWorkflowCanvas,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-delete-edge",
    threadId: "thread-delete-edge",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("candidate-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("candidate-b", "model", ["local-context"]), status: "succeeded" },
      {
        ...workflowNode("review", "model", ["candidate-a", "candidate-b"]),
        status: "succeeded",
        inputBindings: [
          { sourceNodeId: "candidate-a", required: true, acceptedStatuses: ["succeeded"] },
          { sourceNodeId: "candidate-b", required: true, acceptedStatuses: ["succeeded"] },
        ],
        coordination: {
          mode: "review_gate",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      { ...workflowNode("delivery", "agent", ["review"]), status: "succeeded" },
    ],
  };
  const edgeLayoutSnapshot = captureWorkflowCanvasLayout(run);
  const verticalEdge = edgeLayoutSnapshot.edges.find((edge) => (
    edge.sourceNodeId === "review" && edge.targetNodeId === "delivery"
  ));
  const pathStart = verticalEdge?.path.match(/^M ([\d.-]+) ([\d.-]+)/);
  const pathEndY = Number(verticalEdge?.path.trim().split(/\s+/).at(-1));
  assert.ok(verticalEdge && pathStart && Number.isFinite(pathEndY));
  const pathStartX = Number(pathStart[1]);
  const pathStartY = Number(pathStart[2]);
  assert.ok(Math.abs(verticalEdge.deleteX - pathStartX) < 0.000001);
  assert.ok(
    Math.abs(
      verticalEdge.deleteY - (pathStartY + (pathEndY - pathStartY) / 3),
    ) < 0.000001,
    "the delete control should sit one-third of the way from source to target",
  );
  assert.notEqual(verticalEdge.deleteY, (pathStartY + pathEndY) / 2);
  const completedCanvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const runningCanvas = renderWorkflowCanvas(
    { ...run, status: "running" },
    null,
    workflowNodeLogoUrls,
  );
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(completedCanvas, /class="workflow-edge-hit"/);
  assert.match(completedCanvas, /class="workflow-node-delete workflow-edge-delete"/);
  assert.match(completedCanvas, /data-action="delete-workflow-edge"/);
  assert.match(
    completedCanvas,
    /data-workflow-edge-source="candidate-a"[\s\S]*data-workflow-edge-target="review"/,
  );
  assert.match(
    completedCanvas,
    /data-workflow-edge-display-source="candidate-a"[\s\S]*data-workflow-edge-display-target="review"/,
  );
  assert.match(
    completedCanvas,
    /<foreignObject class="workflow-edge-delete-wrap" x="[^"]+" y="[^"]+" width="28" height="28">/,
  );
  assert.doesNotMatch(runningCanvas, /class="workflow-edge-hit"|data-action="delete-workflow-edge"/);
  assert.match(
    styles,
    /\.workflow-edge-hit\s*\{[^}]*stroke:\s*transparent;[^}]*stroke-width:\s*14;[^}]*pointer-events:\s*stroke;/s,
  );
  assert.match(
    styles,
    /\.workflow-edge-group:hover \.workflow-edge-delete,[\s\S]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*transform:\s*scale\(1\);/s,
  );
  assert.match(mainSource, /function deleteWorkflowEdge\(/);
  assert.match(
    mainSource,
    /\[data-action="delete-workflow-edge"\][\s\S]*deleteWorkflowEdge\([\s\S]*threadId,[\s\S]*sourceNodeId,[\s\S]*targetNodeId,[\s\S]*displaySourceId,[\s\S]*displayTargetId,[\s\S]*\)/,
  );

  const withoutCandidateA = deleteWorkflowCanvasEdge(run, "candidate-a", "review");
  const review = withoutCandidateA.nodes.find((node) => node.id === "review");
  assert.deepEqual(
    withoutCandidateA.nodes.map((node) => node.id),
    run.nodes.map((node) => node.id),
    "deleting an edge must preserve every node card in its original order",
  );
  assert.deepEqual(review.dependsOn, ["candidate-b"]);
  assert.deepEqual(
    review.inputBindings.map((binding) => binding.sourceNodeId),
    ["candidate-b"],
  );
  assert.deepEqual(review.coordination.reviewTargets, ["candidate-b"]);
  assert.deepEqual(
    run.nodes.find((node) => node.id === "review").dependsOn,
    ["candidate-a", "candidate-b"],
    "deleting an edge from a revision must not mutate run history",
  );
  const canvasAfterDelete = renderWorkflowCanvas(
    withoutCandidateA,
    null,
    workflowNodeLogoUrls,
  );
  assert.match(canvasAfterDelete, /data-workflow-node-id="candidate-a"/);
  assert.match(canvasAfterDelete, /data-workflow-node-id="review"/);
  const layoutSnapshot = captureWorkflowCanvasLayout(run);
  const layoutWithoutCandidateA = removeWorkflowCanvasEdgeFromLayoutSnapshot(
    layoutSnapshot,
    "candidate-a",
    "review",
  );
  const withoutReviewInputs = deleteWorkflowCanvasEdge(
    withoutCandidateA,
    "candidate-b",
    "review",
  );
  const frozenCanvas = renderWorkflowCanvas(
    withoutReviewInputs,
    null,
    workflowNodeLogoUrls,
    removeWorkflowCanvasEdgeFromLayoutSnapshot(
      layoutWithoutCandidateA,
      "candidate-b",
      "review",
    ),
  );
  const reflowedCanvas = renderWorkflowCanvas(
    withoutReviewInputs,
    null,
    workflowNodeLogoUrls,
  );
  const nodePosition = (markup, nodeId) => {
    const match = markup.match(new RegExp(
      `<button type="button" class="workflow-node[^"]*"\\s+style="left:([\\d.-]+)px;top:([\\d.-]+)px;[^"]*"[^>]*data-workflow-node-id="${nodeId}"`,
    ));
    assert.ok(match, `expected position for ${nodeId}`);
    return [Number(match[1]), Number(match[2])];
  };
  for (const nodeId of ["candidate-a", "candidate-b", "review", "delivery"]) {
    assert.deepEqual(
      nodePosition(frozenCanvas, nodeId),
      nodePosition(completedCanvas, nodeId),
      `${nodeId} must keep its position after deleting edges`,
    );
  }
  assert.notDeepEqual(
    nodePosition(reflowedCanvas, "review"),
    nodePosition(completedCanvas, "review"),
    "the regression fixture must reflow without a frozen layout",
  );
  const withoutDeliveryInput = deleteWorkflowCanvasEdge(
    run,
    "review",
    "delivery",
  );
  const layoutWithoutDeliveryEdge = removeWorkflowCanvasEdgeFromLayoutSnapshot(
    layoutSnapshot,
    "review",
    "delivery",
  );
  const canvasWithoutDeliveryEdge = renderWorkflowCanvas(
    withoutDeliveryInput,
    null,
    workflowNodeLogoUrls,
    layoutWithoutDeliveryEdge,
  );
  const edgePaths = (markup) => new Map(
    [...markup.matchAll(
      /data-workflow-edge-source="([^"]+)" data-workflow-edge-target="([^"]+)" d="([^"]+)"/g,
    )].map((match) => [`${match[1]}->${match[2]}`, match[3]]),
  );
  const originalEdgePaths = edgePaths(completedCanvas);
  const remainingEdgePaths = edgePaths(canvasWithoutDeliveryEdge);
  assert.deepEqual(
    [...remainingEdgePaths.keys()],
    [...originalEdgePaths.keys()].filter((edgeId) => edgeId !== "review->delivery"),
    "only the selected visible edge may be removed",
  );
  for (const [edgeId, path] of remainingEdgePaths) {
    assert.equal(
      path,
      originalEdgePaths.get(edgeId),
      `${edgeId} must keep its exact path after another edge is deleted`,
    );
  }
  assert.equal(
    (canvasWithoutDeliveryEdge.match(/data-workflow-entry-node="true"/g) || []).length,
    (completedCanvas.match(/data-workflow-entry-node="true"/g) || []).length,
    "deleting an edge must not create a new composer entry connection",
  );
  assert.match(
    canvasWithoutDeliveryEdge,
    /data-workflow-node-id="delivery"[^>]*data-workflow-entry-node="false"/,
  );
  assert.match(
    mainSource,
    /const nodeCardsPreserved = \([\s\S]*nextDraft\.nodes\.length === draft\.nodes\.length[\s\S]*node\.id === draft\.nodes\[index\]\?\.id[\s\S]*if \(!nodeCardsPreserved\)/,
  );
  assert.match(mainSource, /freezeWorkflowCanvasLayout\(draft\)/);
  assert.match(mainSource, /removeWorkflowCanvasEdgeFromLayoutSnapshot\(/);
  assert.match(
    mainSource,
    /renderWorkflowCanvas\([\s\S]*WORKFLOW_NODE_LOGO_URLS,[\s\S]*layoutSnapshot,/,
  );
  assert.equal(
    deleteWorkflowCanvasEdge(run, "missing-source", "review"),
    run,
    "missing edges must leave the revision untouched",
  );
});

test("workflow node ports reconnect one edge with a mouse-following preview and cancellable miss click", async () => {
  const {
    addWorkflowCanvasEdgeToLayoutSnapshot,
    captureWorkflowCanvasLayout,
    connectWorkflowCanvasEdge,
    deleteWorkflowCanvasEdge,
    reconcileWorkflowCanvasEdgeConnection,
    removeWorkflowCanvasEdgeFromLayoutSnapshot,
    renderWorkflowCanvas,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-reconnect-edge",
    threadId: "thread-reconnect-edge",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("candidate-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("candidate-b", "model", ["local-context"]), status: "succeeded" },
      {
        ...workflowNode("review", "model", ["candidate-a", "candidate-b"]),
        status: "succeeded",
        coordination: {
          mode: "review_gate",
          reviewTargets: ["candidate-a", "candidate-b"],
        },
      },
      { ...workflowNode("delivery", "agent", ["review"]), status: "succeeded" },
    ],
  };
  const originalSnapshot = captureWorkflowCanvasLayout(run);
  const disconnectedRun = deleteWorkflowCanvasEdge(run, "candidate-a", "review");
  const disconnectedSnapshot = removeWorkflowCanvasEdgeFromLayoutSnapshot(
    originalSnapshot,
    "candidate-a",
    "review",
  );
  const reconnectedRun = connectWorkflowCanvasEdge(
    disconnectedRun,
    "candidate-a",
    "review",
  );
  const reconnectedSnapshot = addWorkflowCanvasEdgeToLayoutSnapshot(
    disconnectedSnapshot,
    reconnectedRun,
    "candidate-a",
    "review",
  );

  assert.deepEqual(
    reconnectedRun.nodes.map((node) => node.id),
    run.nodes.map((node) => node.id),
    "reconnecting must preserve every node card",
  );
  assert.deepEqual(
    reconnectedRun.nodes.find((node) => node.id === "review").dependsOn,
    ["candidate-b", "candidate-a"],
  );
  assert.deepEqual(
    reconnectedRun.nodes.find((node) => node.id === "review").coordination.reviewTargets,
    ["candidate-b", "candidate-a"],
  );
  assert.equal(
    reconnectedSnapshot.edges.length,
    disconnectedSnapshot.edges.length + 1,
  );
  assert.deepEqual(
    reconnectedSnapshot.edges.slice(0, disconnectedSnapshot.edges.length),
    disconnectedSnapshot.edges,
    "adding one edge must not move or replace any existing edge path",
  );
  assert.deepEqual(reconnectedSnapshot.nodePositions, disconnectedSnapshot.nodePositions);
  assert.deepEqual(reconnectedSnapshot.entryNodeIds, disconnectedSnapshot.entryNodeIds);
  assert.equal(
    connectWorkflowCanvasEdge(reconnectedRun, "candidate-a", "review"),
    reconnectedRun,
    "an existing edge must not be duplicated",
  );
  assert.equal(
    connectWorkflowCanvasEdge(reconnectedRun, "review", "candidate-a"),
    reconnectedRun,
    "a connection that creates a cycle must be rejected",
  );
  const repairedDisplayEdge = reconcileWorkflowCanvasEdgeConnection(
    reconnectedRun,
    disconnectedSnapshot,
    "candidate-a",
    "review",
    "candidate-a",
    "review",
  );
  assert.equal(
    repairedDisplayEdge.run,
    reconnectedRun,
    "an existing semantic edge must not be duplicated while repairing its display edge",
  );
  assert.equal(
    repairedDisplayEdge.layoutSnapshot.edges.length,
    disconnectedSnapshot.edges.length + 1,
  );
  const repairedSemanticEdge = reconcileWorkflowCanvasEdgeConnection(
    disconnectedRun,
    reconnectedSnapshot,
    "candidate-a",
    "review",
    "candidate-a",
    "review",
  );
  assert.equal(
    repairedSemanticEdge.layoutSnapshot,
    reconnectedSnapshot,
    "an existing display edge must not be duplicated while repairing its semantic edge",
  );
  assert.deepEqual(
    repairedSemanticEdge.run.nodes.find((node) => node.id === "review").dependsOn,
    ["candidate-b", "candidate-a"],
  );
  assert.equal(
    reconcileWorkflowCanvasEdgeConnection(
      reconnectedRun,
      reconnectedSnapshot,
      "candidate-a",
      "review",
      "candidate-a",
      "review",
    ),
    null,
    "a fully existing connection must remain a rejected duplicate",
  );
  assert.equal(
    reconcileWorkflowCanvasEdgeConnection(
      reconnectedRun,
      reconnectedSnapshot,
      "review",
      "candidate-a",
      "review",
      "candidate-a",
    ),
    null,
    "reconciliation must not bypass cycle validation",
  );

  const completedCanvas = renderWorkflowCanvas(
    disconnectedRun,
    null,
    workflowNodeLogoUrls,
    disconnectedSnapshot,
  );
  const runningCanvas = renderWorkflowCanvas(
    { ...disconnectedRun, status: "running" },
    null,
    workflowNodeLogoUrls,
  );
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.match(completedCanvas, /data-workflow-node-port="input"/);
  assert.match(completedCanvas, /data-workflow-node-port="output"/);
  assert.match(completedCanvas, /class="workflow-edge-preview" data-workflow-edge-preview/);
  assert.match(completedCanvas, /data-workflow-edge-preview-path/);
  assert.doesNotMatch(runningCanvas, /data-workflow-node-port|data-workflow-edge-preview/);
  assert.match(
    mainSource,
    /function beginWorkflowCanvasConnection\([\s\S]*is-connecting-from-\$\{portType\}[\s\S]*updateWorkflowCanvasConnectionPreview/,
  );
  assert.doesNotMatch(
    mainSource,
    /function render\(\)\s*\{[\s\S]{0,160}cancelWorkflowCanvasConnection\(\)/,
    "an unrelated full render must not discard an active first connection",
  );
  assert.match(
    mainSource,
    /type WorkflowCanvasConnectionDraft\s*=\s*\{[\s\S]*pointerX:\s*number;[\s\S]*pointerY:\s*number;/,
  );
  assert.match(
    mainSource,
    /function restoreWorkflowCanvasConnection\(\)[\s\S]*workflowCanvasConnectionPortElement\(connection\)[\s\S]*shell\?\.dataset\.workflowRunId !== connection\.runId[\s\S]*updateWorkflowCanvasConnectionPreview/,
  );
  assert.match(
    mainSource,
    /function bindWorkflowCanvasConnectionEvents\(container: ParentNode = root\)[\s\S]*container\.querySelectorAll<HTMLElement>\("\[data-workflow-node-port\]"\)[\s\S]*restoreWorkflowCanvasConnection\(\);[\s\S]*if \(workflowCanvasConnectionWindowBound\) return;/,
  );
  assert.match(
    mainSource,
    /window\.addEventListener\("pointermove"[\s\S]*updateWorkflowCanvasConnectionPreview\(event\.clientX, event\.clientY\)/,
  );
  assert.match(
    mainSource,
    /function completeWorkflowCanvasConnection\([\s\S]*reconcileWorkflowCanvasEdgeConnection\(/,
  );
  assert.match(
    mainSource,
    /window\.addEventListener\("click"[\s\S]*closest\("\[data-workflow-node-port\]"\)[\s\S]*cancelWorkflowCanvasConnection\(\);[\s\S]*\}, true\);/,
  );
  assert.match(
    mainSource,
    /window\.addEventListener\("contextmenu"[\s\S]*if \(!workflowCanvasConnectionDraft\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*cancelWorkflowCanvasConnection\(\);[\s\S]*\}, true\);/,
    "right-clicking while connecting must cancel the preview without opening a context menu",
  );
  assert.match(
    mainSource,
    /event\.key !== "Escape" \|\| !workflowCanvasConnectionDraft[\s\S]*cancelWorkflowCanvasConnection\(\)/,
  );
  assert.match(
    styles,
    /\.workflow-edge-preview-line\s*\{[^}]*stroke:\s*#5d7fe8;[^}]*stroke-dasharray:\s*5 4;[^}]*stroke-width:\s*1\.8;/s,
  );
  assert.match(
    styles,
    /\.workflow-edge\.pending,\s*\.workflow-edge\.succeeded\s*\{[^}]*stroke:\s*#96b6dd;[^}]*stroke-dasharray:\s*none;/s,
    "saved pending edges must use the same solid line style as succeeded edges",
  );
  assert.match(
    styles,
    /\[data-workflow-node-port\]:hover,[\s\S]*\.is-connection-start\s*\{[^}]*transform:\s*scale\(1\.18\)/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.workflow-edge-preview-line\s*\{[^}]*stroke:\s*#87a4ff;/s,
  );
});

test("completed workflow nodes reveal a separate delete control and a themed confirmation dialog", async () => {
  const { renderWorkflowCanvas } = await workflowCanvasModule;
  const run = {
    id: "workflow-delete-control",
    threadId: "thread-delete-control",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("review", "model", ["local-context"]), status: "succeeded" },
    ],
  };
  const completedCanvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const runningCanvas = renderWorkflowCanvas(
    { ...run, status: "running" },
    null,
    workflowNodeLogoUrls,
  );
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const workflowCanvasSource = await readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8");

  assert.match(completedCanvas, /class="workflow-node-delete workflow-node-card-delete"/);
  assert.match(completedCanvas, /data-action="open-workflow-node-delete"/);
  assert.match(workflowCanvasSource, /left:\$\{node\.x \+ node\.width - 12\}px;top:\$\{node\.y - 12\}px/);
  assert.doesNotMatch(runningCanvas, /class="workflow-node-delete"/);
  assert.match(mainSource, /确定要删除节点？/);
  assert.match(mainSource, /data-action="confirm-workflow-node-delete"/);
  assert.match(mainSource, /data-action="cancel-workflow-node-delete"/);
  assert.doesNotMatch(mainSource, /workflow-node-delete-dialog-icon/);
  assert.match(mainSource, /class="confirm" data-action="confirm-workflow-node-delete"/);
  assert.match(mainSource, /function confirmWorkflowNodeDelete\(\)/);
  assert.match(mainSource, /该节点已经删除，画布已刷新/);
  assert.match(
    mainSource,
    /function applyWorkflowRevisionEnvelope\([\s\S]*workflowCanvasDraftsByThreadId\.set\(threadId, nextRun\);[\s\S]*workflowCanvasStructuralDraftThreadIds\.add\(threadId\);[\s\S]*workflowCanvasLayoutSnapshotsByThreadId\.set/,
    "persisted node definitions and layouts must remain one structural draft",
  );
  assert.match(
    mainSource,
    /function hydrateLatestWorkflowRun\([\s\S]*api\.getWorkflowRevisionDraft\(\{ threadId \}\)[\s\S]*envelope\?\.draft\.sourceRunId === run\.id[\s\S]*applyWorkflowRevisionEnvelope\(threadId, envelope\)/,
    "a restarted client must restore the persisted empty canvas instead of the historical node card",
  );
  assert.match(
    mainSource,
    /function bindWorkflowCanvasSurfaceEvents\(container: ParentNode = root\)[\s\S]*container\.querySelectorAll<HTMLButtonElement>\('\[data-action="open-workflow-node-delete"\]'\)[\s\S]*container\.querySelectorAll<HTMLButtonElement>\('\[data-action="delete-workflow-composer-edge"\]'\)/,
  );
  assert.match(
    mainSource,
    /function bindAgentPanelEvents\(container: ParentNode = root\) \{\s*bindWorkflowCanvasSurfaceEvents\(container\);/,
    "a locally replaced agent panel must rebind every workflow canvas action",
  );
  assert.match(
    mainSource,
    /panel\.replaceWith\(nextPanel\);\s*bindAgentPanelEvents\(nextPanel\);/,
  );
  assert.match(styles, /\.workflow-node:hover \+ \.workflow-node-delete,[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /\.workflow-node-delete\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*background:\s*#8b929d;[^}]*padding:\s*0;[^}]*color:\s*#fff;/s);
  assert.match(styles, /\.workflow-node-card-delete\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  assert.match(styles, /\.workflow-node-card-delete::before\s*\{[^}]*inset:\s*-4px;[^}]*content:\s*"";/s);
  assert.match(styles, /\.workflow-node-card-delete svg\s*\{[^}]*width:\s*12px;[^}]*height:\s*12px;/s);
  assert.match(styles, /\.workflow-node-delete-dialog\s*\{[^}]*width:\s*min\(360px,[^}]*border-radius:\s*16px/s);
  assert.match(styles, /\.workflow-node-delete-dialog footer button\.confirm\s*\{[^}]*background:\s*#15171b;[^}]*color:\s*#fff;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-delete\s*\{[^}]*background:\s*#777f8b;[^}]*color:\s*#fff;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-delete-dialog\s*\{[^}]*background:\s*rgba\(29, 32, 38, 0\.99\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-delete-dialog footer button\.confirm\s*\{[^}]*background:\s*#07090c;[^}]*color:\s*#fff;/s);
});

test("workflow canvas exposes model and agent creation that commits only after saving", async () => {
  const { renderWorkflowCanvas } = await workflowCanvasModule;
  const run = {
    id: "workflow-context-menu",
    threadId: "thread-context-menu",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("review", "model", ["local-context"]), status: "succeeded" },
    ],
  };
  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const workflowCanvasSource = await readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8");

  assert.match(canvas, /data-workflow-node-layer="0"/);
  assert.doesNotMatch(canvas, /data-workflow-canvas-file-input/);
  assert.doesNotMatch(mainSource, /viewport\?\.addEventListener\("click"/);
  assert.match(mainSource, /viewport\?\.addEventListener\("contextmenu"/);
  assert.match(
    mainSource,
    /viewport\?\.addEventListener\("contextmenu",[\s\S]*openWorkflowCanvasContextMenu\(viewport, event\)/,
  );
  assert.match(
    mainSource,
    /if \(!rows\.length\) \{[\s\S]*placement: "between",[\s\S]*previousLayer: null,[\s\S]*nextLayer: null,[\s\S]*zoneLabel: "作为第 1 行插入"/,
  );
  assert.doesNotMatch(mainSource, /data-workflow-canvas-add="file"/);
  assert.doesNotMatch(mainSource, /workflowCanvasPendingFileTarget|workflowCanvasFileDraftNode/);
  assert.match(mainSource, /data-workflow-canvas-add="model"/);
  assert.match(mainSource, /<strong>增加模型<\/strong><small>添加可读取文件和分析的模型节点<\/small>/);
  assert.doesNotMatch(mainSource, /添加外部模型节点/);
  assert.match(mainSource, /data-workflow-canvas-add="agent"/);
  assert.match(mainSource, /<strong>增加画布<\/strong><small>增加完整工作流节点<\/small>/);
  assert.match(mainSource, /class="workflow-canvas-history-submenu" role="menu" aria-label="其他历史画布"/);
  assert.match(mainSource, /reusableSpecs\.map\(renderWorkflowCanvasHistorySpecOption\)/);
  assert.match(
    mainSource,
    /function workflowCanvasHistoryThreads\(currentThreadId: string\)[\s\S]*thread\.id !== currentThreadId[\s\S]*isMultiModelClusterThread\(thread\.id\)[\s\S]*workflowCanvasHistoryThreadCreatedAtMs\(b\)[\s\S]*workflowCanvasHistoryThreadCreatedAtMs\(a\)/,
  );
  assert.match(
    mainSource,
    /function workflowCanvasHistoryThreadCreatedAtMs[\s\S]*record\.created_at[\s\S]*uuidV7Timestamp\(thread\.id\)[\s\S]*workflowCanvasRunWithDraft\(thread\.id\)\?\.createdAt/,
  );
  assert.match(
    mainSource,
    /function renderWorkflowCanvasHistorySpecOption[\s\S]*spec\.workflowKey[\s\S]*data-workflow-canvas-history-spec-id[\s\S]*class="workflow-canvas-history-option-name">\$\{escapeHtml\(name\)\}<\/span>/,
  );
  const historySpecOptionSource = mainSource.slice(
    mainSource.indexOf("function renderWorkflowCanvasHistorySpecOption"),
    mainSource.indexOf("function workflowCanvasHistoryThreadCreatedAtMs"),
  );
  assert.doesNotMatch(
    historySpecOptionSource,
    /createdAt|<time>|row-preview|workflow-history-canvas-avatar|冻结版本/,
  );
  assert.equal(
    [...mainSource.matchAll(/data-workflow-canvas-history-thread-id=/g)].length,
    1,
    "history canvases are display-only until insertion behavior is implemented",
  );
  assert.match(mainSource, /\.workflow-canvas-history-menu-item"[\s\S]*item\.classList\.add\("submenu-open"\)/);
  assert.match(
    mainSource,
    /class="workflow-canvas-context-menu-close"[\s\S]*data-action="close-workflow-canvas-context-menu"[\s\S]*aria-label="关闭增加节点弹窗"/,
  );
  assert.match(
    mainSource,
    /data-action="close-workflow-canvas-context-menu"[\s\S]*addEventListener\("click",[\s\S]*workflowCanvasContextMenu = null;[\s\S]*render\(\);/,
  );
  assert.match(mainSource, /let workflowCanvasPendingNodeInsertion: WorkflowCanvasPendingNodeInsertionState \| null = null/);
  assert.match(
    mainSource,
    /function openWorkflowCanvasPendingNodeEditor\([\s\S]*workflowCanvasPendingNodeInsertion = \{[\s\S]*state\.workflowNodeDialog = \{[\s\S]*render\(\);/,
  );
  assert.match(
    mainSource,
    /function updateWorkflowNodeRevisionDraft\([\s\S]*if \(pendingInsertion\) \{[\s\S]*insertWorkflowCanvasNode\([\s\S]*insertWorkflowCanvasNodeIntoLayoutSnapshot\([\s\S]*api\.compileWorkflowRevisionNode\(\{[\s\S]*definition:\s*\{[\s\S]*layout:\s*desiredLayout[\s\S]*applyWorkflowRevisionEnvelope\([\s\S]*workflowCanvasPendingNodeInsertion = null;/,
  );
  assert.match(
    mainSource,
    /const canvasPoint = workflowCanvasPointInGraph\([\s\S]*event\.clientX,[\s\S]*event\.clientY,[\s\S]*x: Math\.max\(0, canvasPoint\.x\)[\s\S]*y: Math\.max\(0, canvasPoint\.y\)/,
  );
  assert.match(
    mainSource,
    /workflowCanvasInsertionTargetAtPoint\(\s*viewport,\s*event\.clientX,\s*event\.clientY,\s*\)/,
  );
  assert.match(
    mainSource,
    /anchorNodeId:\s*nearestNode\?\.sourceNodeId[\s\S]*anchorDisplayNodeId:\s*nearestNode\?\.displayNodeId[\s\S]*side:\s*clientX < nearestCenterX \? "left" : "right"/,
  );
  assert.match(
    mainSource,
    /function insertWorkflowCanvasNestedSpec\([\s\S]*const currentLayout = workflowCanvasLayoutSnapshotForRun\([\s\S]*insertWorkflowCanvasNodeIntoLayoutSnapshot\([\s\S]*commitWorkflowCanvasStructuralMutation\(/,
  );
  assert.match(
    workflowCanvasSource,
    /const leftExpansion = Math\.max\(0, CANVAS_HORIZONTAL_PADDING - minimumNodeX\);[\s\S]*position\.x \+= leftExpansion;[\s\S]*snapshot\.width \+ leftExpansion/,
  );
  assert.match(
    mainSource,
    /const widthGrowth = previousLayoutSnapshot[\s\S]*storedChatPanelWidth - widthGrowth/,
  );
  assert.equal(
    [...mainSource.matchAll(/workflowCanvasLayoutSnapshotsByThreadId\.delete\(/g)].length,
    2,
    "only draft replacement and discarded-thread cleanup may remove an explicit layout",
  );
  assert.equal(
    [...mainSource.matchAll(/workflowCanvasStructuralDraftThreadIds\.add\(/g)].length,
    3,
    "only persisted hydration, shared layout transactions, and thread promotion may select a structural draft",
  );
  assert.match(
    mainSource,
    /function confirmWorkflowNodeDelete\([\s\S]*deleteWorkflowCanvasNodeFromLayoutSnapshot\([\s\S]*commitWorkflowCanvasStructuralMutation\(/,
  );
  assert.match(mainSource, /clearWorkflowCanvasPendingNodeInsertion\([\s\S]*state\.workflowNodeDialog = null/);
  for (const removedHelperText of [
    "新增节点",
    "编辑节点",
    "保存修改后加入当前画布",
    "修改已保存到当前画布草稿",
    "调整下一次运行的执行方式",
    "由谁完成这个节点",
    "告诉执行者要做什么",
    "什么时候开始执行",
    "结果类型",
    "保存后创建节点并重新排列画布",
    "只更新当前画布草稿，不改变历史执行结果",
    "保存后用于下一次运行，历史结果不会改变",
  ]) {
    assert.doesNotMatch(workflowCanvasSource, new RegExp(removedHelperText));
  }
  assert.match(styles, /\.workflow-node-edit-footer\s*\{[^}]*justify-content:\s*flex-end;[^}]*border-top:\s*0;/s);
  assert.match(mainSource, /placement:\s*"parallel"/);
  assert.match(mainSource, /placement:\s*"between"/);
  assert.match(styles, /\.workflow-canvas-context-menu\s*\{[^}]*position:\s*fixed;[^}]*border-radius:\s*12px/s);
  assert.match(styles, /\.workflow-canvas-context-menu-head-copy strong\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.workflow-canvas-context-menu > button strong,\s*\.workflow-canvas-context-menu-main-item strong\s*\{[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.workflow-canvas-context-menu-close:hover,[^}]*background:\s*var\(--surface-hover\);[^}]*color:\s*var\(--text-primary\)/s);
  assert.match(styles, /\.workflow-canvas-context-menu-close:active\s*\{[^}]*background:\s*var\(--surface-active-translucent\);[^}]*transform:\s*scale\(0\.92\)/s);
  assert.match(styles, /\.workflow-canvas-context-menu > button:hover,[^}]*background:\s*var\(--surface-hover\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-context-menu\s*\{[^}]*background:\s*rgba\(27, 30, 35, 0\.98\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-context-menu-close:hover,[^}]*background:\s*rgba\(255, 255, 255, 0\.07\);[^}]*color:\s*#f3f4f6/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-context-menu-close:active\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.11\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-context-menu > button:focus-visible,[^}]*background:\s*rgba\(255, 255, 255, 0\.07\)/s);
  assert.match(styles, /\.workflow-canvas-history-submenu\s*\{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*left:\s*-6px;[^}]*width:\s*calc\(100% \+ 12px\);[^}]*max-height:\s*var\(--workflow-canvas-submenu-max-height,[^}]*visibility:\s*hidden;[^}]*padding:\s*6px 8px 6px 6px;[^}]*pointer-events:\s*none;[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(styles, /\.workflow-canvas-history-menu-item\.submenu-open > \.workflow-canvas-history-submenu\s*\{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
  assert.match(mainSource, /class="workflow-canvas-context-menu-chevron"[^>]*>[\s\S]*<path d="m3\.5 6 4\.5 4\.5L12\.5 6"><\/path>/);
  assert.match(styles, /\.workflow-canvas-history-menu-item:is\(:hover, :focus-within, \.submenu-open\) \.workflow-canvas-context-menu-chevron\s*\{[^}]*transform:\s*translateY\(1px\)/s);
  assert.match(styles, /\.workflow-canvas-history-option\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*min-height:\s*40px;[^}]*overflow:\s*hidden;[^}]*padding:\s*0 12px;/s);
  assert.match(styles, /\.workflow-canvas-history-option-name\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*flex:\s*1 1 0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.workflow-canvas-history-option:hover,[^}]*background:\s*var\(--surface-hover\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-history-submenu\s*\{[^}]*background:\s*rgba\(27, 30, 35, 0\.98\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-history-option:hover,[^}]*background:\s*rgba\(255, 255, 255, 0\.07\)/s);
  assert.match(styles, /\.workflow-node-attachment-trigger:hover:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(73, 91, 126, 0\.07\)/s);
  assert.match(styles, /\.workflow-node-attachment-trigger\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*auto;[^}]*gap:\s*4px;[^}]*padding:\s*0 7px;[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.workflow-node-executor-picker select\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.workflow-node-executor-picker \.chat-title-group-button\s*\{[^}]*max-width:\s*184px;[^}]*height:\s*28px;[^}]*gap:\s*3px;[^}]*padding:\s*0 6px/s);
  assert.match(styles, /\.workflow-node-executor-picker \.composer-model-button svg:last-child\s*\{[^}]*width:\s*14px;[^}]*stroke-width:\s*1\.08/s);
  assert.match(styles, /\.workflow-node-executor-picker \.workflow-node-executor-menu\.composer-model-menu\.grouped\s*\{[^}]*top:\s*calc\(100% \+ 8px\);[^}]*right:\s*0;[^}]*bottom:\s*auto;[^}]*z-index:\s*45;[^}]*max-height:\s*min\(\s*260px,\s*calc\(100vh - 420px\),\s*var\(--workflow-node-menu-available-height, 260px\)\s*\)/s);
  assert.match(styles, /\.workflow-node-executor-menu\.composer-model-menu\.hidden\s*\{[^}]*display:\s*none/s);
  assert.match(styles, /\.workflow-node-mention-popover\s*\{[^}]*width:\s*154px;[^}]*background:\s*var\(--surface-primary\)/s);
  assert.match(styles, /\.workflow-node-mention-popover\s*\{[^}]*top:\s*0;[^}]*left:\s*0;[^}]*bottom:\s*auto;/s);
  assert.match(styles, /\.workflow-node-mention-options > \[hidden\],[\s\S]*\.workflow-node-mention-empty\.hidden\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.workflow-node-mention-popover \.composer-prompt-favorite-root-add\s*\{[^}]*color:\s*var\(--brand-blue\);[^}]*font-weight:\s*500;/s);
  assert.match(styles, /\.workflow-node-mention-popover \.composer-prompt-favorite-main\s*\{[^}]*min-height:\s*42px;[^}]*background:\s*transparent;[^}]*font-size:\s*calc\(13px \+ var\(--app-font-size-offset\)\);[^}]*font-weight:\s*400;/s);
  assert.match(styles, /\.workflow-node-mention-popover \.composer-prompt-favorite-edit\s*\{[^}]*min-width:\s*62px;[^}]*color:\s*var\(--brand-blue\);[^}]*font-size:\s*calc\(12px \+ var\(--app-font-size-offset\)\)/s);
  assert.match(styles, /\.workflow-node-mention-submenu\s*\{[^}]*left:\s*calc\(100% \+ 3px\);[^}]*background:\s*var\(--surface-primary\)/s);
  assert.doesNotMatch(styles, /\.workflow-node-mention-submenu\.open-left/);
  assert.match(
    mainSource,
    /function placeWorkflowNodeMentionSubmenu\([\s\S]*dialog\.getBoundingClientRect\(\)[\s\S]*maximumSubmenuWidth[\s\S]*rightOverflow[\s\S]*popover\.style\.left/,
  );
  assert.doesNotMatch(mainSource, /submenu\.classList\.toggle\(\s*"open-left"/);
  assert.match(
    mainSource,
    /function openWorkflowNodeMentionSubmenu\([\s\S]*placeWorkflowNodeMentionSubmenu\(form, activePanel\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*\.workflow-node-mention-submenu\s*\{[^}]*width:\s*min\(286px, calc\(100vw - 250px\)\);/s,
  );
  assert.match(styles, /\.workflow-node-mention-root-item:hover:not\(:disabled\),[\s\S]*background:\s*var\(--surface-soft\)/s);
  assert.match(styles, /\.workflow-node-attachments \.pending-file\s*\{[^}]*width:\s*180px;[^}]*height:\s*52px/s);
  assert.match(
    styles,
    /\.workflow-node-attachments-wrap\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*0;/s,
  );
  assert.match(
    styles,
    /\.workflow-node-attachments\.pending-attachments\s*\{[^}]*height:\s*56px;[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*overscroll-behavior-x:\s*contain;[^}]*scrollbar-width:\s*none;[^}]*touch-action:\s*pan-x;/s,
  );
  assert.match(
    styles,
    /\.attachment-scroll-button\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*border-radius:\s*999px;/s,
  );
  assert.match(
    styles,
    /html\[data-theme="dark"\] \.attachment-scroll-button\.left,[\s\S]*html\[data-theme="dark"\] \.attachment-scroll-button\.right,[\s\S]*background:\s*var\(--surface-interactive\);/s,
  );
  assert.match(styles, /\.workflow-node-editor-section\.prompt\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.workflow-node-prompt-control\s*\{[^}]*border:\s*1px solid rgba\(91, 109, 140, 0\.16\);[^}]*border-radius:\s*11px;[^}]*background:\s*transparent/s);
  assert.match(styles, /\.workflow-node-prompt-control:focus-within\s*\{[^}]*border-color:\s*#6688dc;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s);
  assert.match(styles, /\.workflow-node-prompt-toolbar\s*\{[^}]*padding:\s*0 8px 8px;/s);
  assert.match(styles, /\.workflow-node-prompt-field textarea\s*\{[^}]*min-height:\s*138px;[^}]*resize:\s*none;/s);
  assert.match(styles, /\.workflow-node-prompt-input-wrap\s*\{[^}]*min-height:\s*138px;/s);
  assert.match(styles, /\.workflow-node-prompt-highlight,[\s\S]*\.workflow-node-prompt-input-wrap > textarea\s*\{[^}]*position:\s*absolute;[^}]*min-height:\s*138px;[^}]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\);[^}]*line-height:\s*normal/s);
  assert.match(styles, /\.workflow-node-derived-input-note\s*\{[^}]*min-height:\s*58px;[^}]*font-size:\s*calc\(11px \+ var\(--app-font-size-offset\)\);[^}]*line-height:\s*calc\(16px \+ var\(--app-font-size-offset\)\);[^}]*cursor:\s*default/s);
  assert.match(styles, /\.workflow-node-prompt-field \.workflow-node-contract-field > textarea,[\s\S]*padding:\s*1px;[^}]*line-height:\s*normal;[^}]*caret-color:\s*currentColor;[^}]*caret-shape:\s*bar;[^}]*cursor:\s*text/s);
  assert.match(styles, /\.workflow-node-contract-field\.task \.workflow-node-prompt-highlight,[\s\S]*\.workflow-node-contract-field\.task \.workflow-node-prompt-input-wrap > textarea\s*\{[^}]*min-height:\s*96px;[^}]*padding:\s*1px;[^}]*border-radius:\s*0;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-derived-input-note\s*\{[^}]*color:\s*#7f8b9e/s);
  assert.match(styles, /\.workflow-node-prompt-highlight mark\s*\{[^}]*background:\s*rgba\(0, 136, 255, 0\.1\);[^}]*color:\s*transparent/s);
  assert.match(styles, /\.workflow-node-prompt-field \.workflow-node-prompt-input-wrap > textarea,[\s\S]*border:\s*0;[^}]*background:\s*transparent;[^}]*line-height:\s*normal;[^}]*caret-color:\s*currentColor;[^}]*caret-shape:\s*bar;[^}]*cursor:\s*text;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-attachment-trigger:hover:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\.07\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-executor-picker \.chat-title-group-button:hover,[\s\S]*background:\s*rgba\(129, 158, 193, 0\.09\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-mention-popover,[\s\S]*html\[data-theme="dark"\] \.workflow-node-mention-submenu\s*\{[^}]*background:\s*rgba\(29, 32, 39, 0\.99\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-mention-root-item:hover:not\(:disabled\),[\s\S]*background:\s*rgba\(129, 158, 193, 0\.11\)/s);
  assert.match(styles, /html\[data-theme="dark"\][\s\S]*\.workflow-node-mention-popover[\s\S]*\.composer-prompt-favorite-row\[role="option"\]:is\(:hover, \.active\)\s*\{[^}]*background:\s*var\(--selection-soft\)/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-editor-section\.prompt\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-prompt-control:focus-within\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none/s);
  assert.match(styles, /html\[data-theme="dark"\] \.pending-file\.error,[\s\S]*background:\s*rgba\(255, 107, 107, 0\.12\)/s);
  assert.match(
    mainSource,
    /function renderWorkflowNodeMentionHighlights\([\s\S]*composerMentionTokenRanges[\s\S]*<mark>[\s\S]*function syncWorkflowNodeMentionHighlights\([\s\S]*highlight\.scrollTop = input\.scrollTop/,
  );
  assert.match(
    workflowCanvasSource,
    /name="inputDefinition"[\s\S]*?data-workflow-node-mention-input[\s\S]*?name="taskDefinition"[\s\S]*?data-workflow-node-mention-input[\s\S]*?name="outputDefinition"[\s\S]*?data-workflow-node-mention-input/,
  );
  assert.match(
    mainSource,
    /function workflowNodeMentionInputs\([\s\S]*querySelectorAll<HTMLTextAreaElement>\([\s\S]*"\[data-workflow-node-mention-input\]"[\s\S]*function activeWorkflowNodeMentionInput/,
  );
  assert.match(
    mainSource,
    /function workflowNodeMentionCaretAnchor\([\s\S]*marker\.textContent = input\.value\.slice\(triggerIndex, triggerIndex \+ 1\)[\s\S]*markerRect\.left - mirrorRect\.left - input\.scrollLeft[\s\S]*markerRect\.bottom - mirrorRect\.top - input\.scrollTop/,
  );
  assert.match(
    mainSource,
    /function placeWorkflowNodeMentionMenu\([\s\S]*anchor\.left - controlRect\.left[\s\S]*popover\.style\.left[\s\S]*popover\.style\.top[\s\S]*popover\.style\.bottom = "auto"/,
  );
  assert.match(
    mainSource,
    /workflowNodeMentionInputsForForm\.forEach\(\(input\) => \{[\s\S]*input\.addEventListener\("input"[\s\S]*syncWorkflowNodeMentionMenu\(workflowNodeEditForm, input\)[\s\S]*input\.addEventListener\("click"/,
  );
  assert.match(
    mainSource,
    /data-workflow-node-add-prompt-favorite[\s\S]*openPromptFavoriteDialog\("add"\)[\s\S]*data-workflow-node-edit-prompt-favorite[\s\S]*openPromptFavoriteDialog\("edit", favoriteId\)/,
  );
  assert.match(
    workflowCanvasSource,
    /favoritePrompts\.length >= 2\s*\? renderWorkflowNodeMentionSearch\("favorites", "搜索提示词"\)\s*:\s*""/,
  );
  assert.match(
    mainSource,
    /attachmentScroller\.addEventListener\("wheel"[\s\S]*attachmentScroller\.scrollLeft = nextScrollLeft[\s\S]*attachmentScroller\.addEventListener\("keydown"[\s\S]*event\.key === "ArrowRight"/,
  );
  assert.match(
    mainSource,
    /function scrollWorkflowNodeAttachmentRail\([\s\S]*rail\.clientWidth \* 0\.72[\s\S]*function updateWorkflowNodeAttachmentScrollControls\([\s\S]*leftButton\.hidden = rail\.scrollLeft <= 1;[\s\S]*rightButton\.hidden = rail\.scrollLeft >= maxScrollLeft - 1;/,
  );
  assert.match(
    mainSource,
    /const previousScrollLeft = currentRail\.scrollLeft[\s\S]*current\.replaceWith\(next\);[\s\S]*nextRail\.scrollLeft = previousScrollLeft/,
  );
  assert.match(
    mainSource,
    /handleComposerSkillReferenceArrowKeydown\(event, tokens\)[\s\S]*handleWorkflowNodeSkillTokenDeleteKeydown/,
  );
  assert.match(
    mainSource,
    /function replaceWorkflowNodeMention\([\s\S]*composerMentionTrailingSpacer\(afterSelection\)[\s\S]*closeWorkflowNodeMentionMenu\(form\)/,
  );
  assert.match(
    mainSource,
    /function ensureWorkflowNodeDialogAttachmentDraft\([\s\S]*Existing workflow inputs and upstream outputs[\s\S]*attachments:\s*\[\]/,
  );
  assert.match(
    mainSource,
    /function persistWorkflowNodeDialogAttachments\([\s\S]*selectedUploadIds[\s\S]*delivery[\s\S]*run\.metadata = \{[\s\S]*node\.contextSelection = \{/,
  );
  assert.doesNotMatch(mainSource, /semanticCondition|joinCondition|joinQuorum|joinMode/);
  assert.match(mainSource, /node\.outputContract = null;/);
  assert.doesNotMatch(mainSource, /structuredDataFormat|outputSchema|workflowNodeEditString\(formData, "outputFormat"\)/);
});

test("workflow canvas exposes editable composer connections to any visible node in both themes", async () => {
  const {
    addWorkflowCanvasComposerEdgeToLayoutSnapshot,
    captureWorkflowCanvasLayout,
    removeWorkflowCanvasComposerEdgeFromLayoutSnapshot,
    renderWorkflowCanvas,
    workflowCanvasComposerBranchRoute,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-composer-connector",
    threadId: "thread-composer-connector",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("review-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("review-b", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("merge", "model", ["review-a", "review-b"]), status: "succeeded" },
      { ...workflowNode("root-acceptance", "root", ["merge"]), status: "succeeded" },
    ],
  };
  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const frozenLayout = captureWorkflowCanvasLayout(run);
  assert.equal(
    Math.min(...Object.values(frozenLayout.nodePositions).map((position) => position.y)),
    50,
    "the first row must leave the requested vertical room for composer entry lines",
  );
  const debugLayout = addWorkflowCanvasComposerEdgeToLayoutSnapshot(
    frozenLayout,
    "merge",
  );
  assert.notEqual(debugLayout, frozenLayout);
  assert.ok(debugLayout.entryNodeIds.includes("merge"));
  assert.deepEqual(debugLayout.nodePositions, frozenLayout.nodePositions);
  assert.deepEqual(debugLayout.edges, frozenLayout.edges);
  assert.equal(
    addWorkflowCanvasComposerEdgeToLayoutSnapshot(debugLayout, "merge"),
    debugLayout,
    "the same composer connection must not be duplicated",
  );
  const disconnectedLayout = removeWorkflowCanvasComposerEdgeFromLayoutSnapshot(
    debugLayout,
    "merge",
  );
  assert.ok(!disconnectedLayout.entryNodeIds.includes("merge"));
  assert.deepEqual(disconnectedLayout.nodePositions, frozenLayout.nodePositions);
  assert.deepEqual(disconnectedLayout.edges, frozenLayout.edges);
  const directComposerRoute = workflowCanvasComposerBranchRoute({
    entry: { x: 0, y: 420 },
    target: { x: 300, y: 260 },
    wallTop: 8,
    canvasWidth: 700,
    obstacles: [{ left: 40, top: 60, right: 220, bottom: 180 }],
  });
  assert.equal(directComposerRoute.routed, false);
  assert.equal(directComposerRoute.laneX, null);
  assert.deepEqual(directComposerRoute.deletePoint, { x: 300, y: 134 });
  assert.match(directComposerRoute.path, /^M 0 420[\s\S]*L 300 8 C 300 16,[\s\S]*300 260$/);
  const obstacleAvoidingComposerRoute = workflowCanvasComposerBranchRoute({
    entry: { x: 0, y: 420 },
    target: { x: 300, y: 260 },
    wallTop: 8,
    canvasWidth: 700,
    obstacles: [
      { left: 40, top: 60, right: 230, bottom: 180 },
      { left: 250, top: 60, right: 350, bottom: 180 },
      { left: 370, top: 60, right: 560, bottom: 180 },
    ],
  });
  assert.equal(obstacleAvoidingComposerRoute.routed, true);
  assert.equal(obstacleAvoidingComposerRoute.laneX, 24);
  assert.deepEqual(obstacleAvoidingComposerRoute.deletePoint, { x: 24, y: 334 });
  assert.match(obstacleAvoidingComposerRoute.path, /^M 0 420 L 16 420 Q 24 420, 24 412/);
  assert.doesNotMatch(obstacleAvoidingComposerRoute.path, /L 300 8/);
  assert.match(obstacleAvoidingComposerRoute.path, /Q 300 248, 300 260$/);
  const debugCanvas = renderWorkflowCanvas(
    run,
    null,
    workflowNodeLogoUrls,
    debugLayout,
  );
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

  assert.equal((canvas.match(/data-workflow-entry-node="true"/g) || []).length, 2);
  assert.equal((canvas.match(/data-action="delete-workflow-composer-edge"/g) || []).length, 2);
  assert.match(debugCanvas, /data-workflow-composer-edge-target="merge"/);
  assert.match(canvas, /data-workflow-thread-id="thread-composer-connector"/);
  assert.match(canvas, /<svg class="workflow-composer-connector" data-workflow-composer-connector/);
  assert.match(canvas, /data-workflow-composer-edge-path/);
  assert.match(canvas, /data-workflow-composer-edge-hit/);
  assert.match(mainSource, /function updateWorkflowComposerConnector\(\)/);
  assert.match(
    mainSource,
    /class="composer-workflow-port"[\s\S]*data-composer-workflow-port[\s\S]*data-workflow-connection-origin="composer"[\s\S]*data-workflow-node-port="output"/,
  );
  assert.match(
    mainSource,
    /function deleteWorkflowComposerEdge\([\s\S]*removeWorkflowCanvasComposerEdgeFromLayoutSnapshot\([\s\S]*commitWorkflowCanvasStructuralMutation\(/,
  );
  assert.match(
    mainSource,
    /if \(source\.origin === "composer"\)[\s\S]*addWorkflowCanvasComposerEdgeToLayoutSnapshot\([\s\S]*target\.displayNodeId/,
  );
  assert.match(
    mainSource,
    /const fixedX = connection\.origin === "composer"\s*\?\s*\(\(shellRect \? shellRect\.left : graphRect\.left\) - graphRect\.left\) \/ zoom/,
  );
  assert.match(
    mainSource,
    /const graph = port\.closest<HTMLElement>\("\.workflow-graph"\)\s*\|\| shell\?\.querySelector<HTMLElement>\("\.workflow-graph"\)\s*\|\| null;/,
    "the external composer port must resolve the workflow graph through its matching shell",
  );
  assert.match(mainSource, /const composerPortCenterY = composerPortRect\.top \+ composerPortRect\.height \/ 2/);
  assert.match(mainSource, /--workflow-port-bridge-width/);
  assert.match(mainSource, /composerPortCenterY - shellRect\.top/);
  assert.match(mainSource, /const wallTop = 8;/);
  assert.match(mainSource, /workflowCanvasComposerBranchRoute\(\{[\s\S]*entry:\s*\{ x: 0, y: startY \}[\s\S]*obstacles:\s*canvasNodeRects\.filter/);
  assert.match(mainSource, /workflow-composer-edge-delete-wrap[\s\S]*route\.deletePoint\.x[\s\S]*route\.deletePoint\.y/);
  assert.doesNotMatch(mainSource, /const trunkPath =/);
  assert.doesNotMatch(canvas, /data-workflow-composer-connector-path/);
  assert.doesNotMatch(mainSource, /\|\| !entryNodes\.length/);
  assert.doesNotMatch(mainSource, /workflow-composer-connector-glow/);
  assert.doesNotMatch(mainSource, /viewport\.addEventListener\("scroll", scheduleWorkflowComposerConnector/);
  assert.match(
    mainSource,
    /function applyWorkflowCanvasViewportTransform\([\s\S]*?workflowCanvasViewportTransformsByThreadId\.set\(threadId, transform\);\s*scheduleWorkflowComposerConnector\(\);\s*return transform;/,
    "every canvas pan or zoom must keep the external composer connection attached to its node",
  );
  assert.match(mainSource, /new ResizeObserver\(scheduleWorkflowComposerConnector\)/);
  assert.match(styles, /\.workflow-composer-connector-line\s*\{[^}]*stroke:\s*var\(--workflow-composer-connector-color\);[^}]*stroke-width:\s*1\.35/s);
  assert.match(styles, /\.workflow-composer-edge-hit\s*\{[^}]*pointer-events:\s*stroke/s);
  assert.match(styles, /\.workflow-composer-edge-group\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /\.composer-workflow-port::after\s*\{[^}]*height:\s*1\.35px;[^}]*background:\s*#96b6dd;[^}]*pointer-events:\s*none/s);
  assert.match(styles, /\.composer-workflow-port\s*\{[^}]*cursor:\s*crosshair;[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /\.composer-workflow-port > i\s*\{[^}]*width:\s*7\.92px;[^}]*height:\s*7\.92px;[^}]*border:\s*2\.64px solid #f8faff;[^}]*background:\s*#a9b4c7;[^}]*pointer-events:\s*auto/s);
  assert.match(styles, /html\[data-theme="dark"\] \.cluster-workflow-shell\s*\{[^}]*--workflow-composer-connector-color:\s*#96b6dd/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-workflow-port > i\s*\{\s*border-color:\s*#22252c;/s);
  assert.match(styles, /html\[data-theme="dark"\] \.composer-workflow-port:hover > i,[\s\S]*rgba\(137, 166, 255, 0\.72\)/s);
});

test("terminal workflow restores exact composer entry connections from its frozen invocation metadata", async () => {
  const {
    captureWorkflowCanvasLayout,
    renderWorkflowCanvas,
    workflowCanvasRuntimeEntryNodeIds,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-terminal-frozen-inputs",
    threadId: "thread-terminal-frozen-inputs",
    status: "failed",
    metadata: {
      invocationContract: {
        version: 1,
        entryNodeIds: ["entry-b", "entry-d"],
        slots: [
          {
            slotId: "shared-image",
            type: "image",
            semanticName: "共享图片",
            minCount: 1,
            maxCount: 1,
            targetNodeIds: ["entry-b", "entry-d"],
            targetNodeCodes: ["B", "D"],
          },
        ],
      },
    },
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("entry-b", "agent", ["local-context"]), status: "failed" },
      { ...workflowNode("entry-d", "agent", ["local-context"]), status: "failed" },
      { ...workflowNode("unbound-entry", "agent", ["local-context"]), status: "failed" },
      { ...workflowNode("merge", "agent", ["entry-b", "entry-d"]), status: "skipped" },
      { ...workflowNode("root-acceptance", "root", ["merge"]), status: "skipped" },
    ],
  };

  assert.deepEqual(workflowCanvasRuntimeEntryNodeIds(run), ["entry-b", "entry-d"]);
  const snapshot = captureWorkflowCanvasLayout(run);
  assert.deepEqual(snapshot.entryNodeIds, ["entry-b", "entry-d"]);
  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  assert.match(canvas, /data-workflow-composer-entry-target="entry-b"/);
  assert.match(canvas, /data-workflow-composer-entry-target="entry-d"/);
  assert.doesNotMatch(canvas, /data-workflow-composer-entry-target="unbound-entry"/);
  assert.doesNotMatch(canvas, /data-workflow-composer-entry-target="merge"/);
});

test("a running workflow connects the composer to its first system node before restoring semantic entries", async () => {
  const {
    captureWorkflowCanvasLayout,
    renderWorkflowCanvas,
    workflowCanvasRuntimeEntryNodeIds,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-running-system-entry",
    threadId: "thread-running-system-entry",
    status: "running",
    metadata: {
      invocationContract: {
        version: 1,
        entryNodeIds: ["entry-b", "entry-d"],
        slots: [],
      },
    },
    nodes: [
      { ...workflowNode("root-plan", "root"), title: "Haolo 编排", status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("entry-b", "agent", ["local-context"]), status: "running" },
      { ...workflowNode("entry-d", "agent", ["local-context"]), status: "pending" },
      { ...workflowNode("merge", "agent", ["entry-b", "entry-d"]), status: "pending" },
      { ...workflowNode("root-acceptance", "root", ["merge"]), status: "pending" },
    ],
  };

  assert.deepEqual(workflowCanvasRuntimeEntryNodeIds(run), ["root-plan"]);
  const snapshot = captureWorkflowCanvasLayout(run);
  assert.deepEqual(snapshot.entryNodeIds, ["root-plan"]);
  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  assert.match(canvas, /data-workflow-composer-entry-target="root-plan"/);
  assert.doesNotMatch(canvas, /data-workflow-composer-entry-target="entry-b"/);
  assert.doesNotMatch(canvas, /data-workflow-composer-entry-target="entry-d"/);
  assert.match(canvas, /class="workflow-composer-connector-line"/);
});

test("workflow node titles use regular weight and avatars use rounded-square model logos with Haolo fallback", async () => {
  const { renderWorkflowCanvas, renderWorkflowNodeDialog, workflowNodeLogoKey } = await workflowCanvasModule;
  const nodes = [
    { ...workflowNode("root-plan", "root"), title: "Haolo 编排" },
    { ...workflowNode("gpt-review", "model", ["root-plan"]), provider: "claude", model: "gpt-5.6-terra" },
    { ...workflowNode("qwen-review", "model", ["root-plan"]), provider: "qwen", model: "qwen3.7-max" },
    { ...workflowNode("unknown-model", "model", ["root-plan"]), provider: "custom", model: "custom-1" },
    { ...workflowNode("root-acceptance", "root", ["gpt-review", "qwen-review"]), title: "终验与交付" },
  ];

  assert.equal(workflowNodeLogoKey(nodes[0]), "haolo", "the entry node should always use the Haolo logo");
  assert.equal(workflowNodeLogoKey(nodes[1]), "codex", "the actual model should take priority over provider metadata");
  assert.equal(workflowNodeLogoKey(nodes[2]), "qwen");
  assert.equal(workflowNodeLogoKey(nodes[3]), "haolo");
  assert.equal(workflowNodeLogoKey(nodes[4]), "haolo", "the final root node should also use the Haolo logo");
  assert.deepEqual([
    ["claude-sonnet-5", "claude"],
    ["kimi-k3", "kimi"],
    ["deepseek-v4-flash", "deepseek"],
    ["gemini-3.5-flash", "gemini"],
    ["grok-4.5", "grok"],
    ["mimo-v2.5-pro", "mimo"],
    ["sonar-pro", "perplexity"],
    ["doubao-seed-2-1-pro-260628", "doubao"],
    ["qwen3.7-max", "qwen"],
  ].map(([model, expected]) => workflowNodeLogoKey({ ...nodes[3], model, provider: "custom" }) === expected), Array(9).fill(true));

  const markup = renderWorkflowCanvas({
    id: "workflow-model-logos",
    threadId: "thread-model-logos",
    status: "running",
    nodes,
  }, null, workflowNodeLogoUrls);
  const rootDialog = renderWorkflowNodeDialog({
    id: "workflow-entry-dialog",
    threadId: "thread-entry-dialog",
    status: "running",
    nodes,
  }, "root-plan", workflowNodeLogoUrls);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(markup, /class="workflow-node-title">Haolo 编排<\/span>/);
  assert.doesNotMatch(markup, /<strong>Haolo 编排<\/strong>/);
  assert.match(markup, /data-workflow-model-logo="haolo"><img src="logo-haolo\.png"/);
  assert.match(markup, /class="workflow-node-title">Haolo 编排<\/span><small>haolo agent<\/small>/);
  assert.match(markup, /data-workflow-model-logo="qwen"><img src="logo-qwen\.svg"/);
  assert.match(markup, /data-workflow-model-logo="haolo"><img src="logo-haolo\.png"/);
  assert.doesNotMatch(markup.replace(/<[^>]+>/g, " "), /codex/i);
  assert.match(rootDialog, /data-workflow-model-logo="haolo"><img src="logo-haolo\.png"/);
  assert.match(rootDialog, /服务商：Haolo/);
  assert.match(rootDialog, /<p>haolo agent<\/p>/);
  assert.doesNotMatch(rootDialog.replace(/<[^>]+>/g, " "), /codex/i);
  assert.match(styles, /\.workflow-node-avatar\s*\{[\s\S]*?border-radius:\s*var\(--avatar-radius\)/);
  assert.match(styles, /\.workflow-node-identity \.workflow-node-title\s*\{[\s\S]*?font-weight:\s*400/);
});

test("workflow canvas brands executable subAgents as Haolo and uses ordinary blue node styling in both themes", async () => {
  const { renderWorkflowCanvas, renderWorkflowNodeDialog } = await workflowCanvasModule;
  const agentNode = {
    ...workflowNode("implementation", "agent", ["root-plan"]),
    executorType: "codex_subagent",
    provider: "haolo-codex-agent",
    model: "gpt-5.6-terra",
    title: "实现与验证",
    prompt: "你是 Haolo/Codex 子 Agent；等待根 Codex 签发授权后执行。",
    status: "succeeded",
    capabilityRequest: {
      permissionProfile: "workspace_write",
      capabilities: ["filesystem.read", "filesystem.update", "command.execute"],
      actions: ["read", "update", "execute"],
      sideEffectPolicy: "reversible",
      delegation: false,
      rationale: "根 Codex 要求修改当前项目并运行测试",
    },
    capabilityGrant: {
      id: "grant-agent-1",
      issuedBy: "root-codex",
      taskId: "task-agent-1",
      executorType: "codex_subagent",
      permissionProfile: "workspace_write",
      capabilities: ["filesystem.read", "filesystem.update", "command.execute"],
      resources: {
        workspaceRoot: "D:/workspace",
        paths: ["D:/workspace"],
        network: [],
        applications: [],
        allowImplicitGlobalContext: false,
      },
      actions: ["read", "update", "execute"],
      sideEffectPolicy: "reversible",
      delegation: { allowed: false, maxDepth: 0 },
      lease: { expiresAt: "2026-07-27T16:00:00.000Z" },
    },
    childWorkflow: {
      id: "child-implementation",
      status: "succeeded",
      steps: [{
        id: "file-change",
        stage: "fileChange",
        title: "Codex 修改文件",
        detail: "src/main/workflow/codex-runtime.mjs",
        status: "succeeded",
      }],
    },
    result: {
      status: "succeeded",
      output: { text: "Codex 已完成实现和验证", artifacts: [] },
      effects: [{
        id: "file-change",
        type: "fileChange",
        status: "succeeded",
        paths: ["D:/workspace/src/main/workflow/codex-runtime.mjs"],
      }],
    },
  };
  const run = {
    id: "workflow-agent-node",
    threadId: "thread-agent-node",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      agentNode,
    ],
  };
  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls);
  const dialog = renderWorkflowNodeDialog(run, "implementation", workflowNodeLogoUrls);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  assert.match(canvas, /workflow-node agent succeeded/);
  assert.match(canvas, /data-workflow-model-logo="haolo"><img src="logo-haolo\.png"/);
  assert.match(canvas, /Haolo 子 Agent · gpt-5\.6-terra/);
  assert.match(dialog, /执行器与授权/);
  assert.match(dialog, /data-workflow-model-logo="haolo"><img src="logo-haolo\.png"/);
  assert.match(dialog, /类型：Haolo 子 Agent/);
  assert.match(dialog, /签发方：Haolo/);
  assert.match(dialog, /当前工作区读写/);
  assert.match(dialog, /隐式全局上下文：禁止/);
  assert.match(dialog, /子 Agent 执行步骤/);
  assert.match(dialog, /已发生的执行副作用/);
  assert.match(dialog, /src\/main\/workflow\/Haolo-runtime\.mjs/);
  assert.doesNotMatch(canvas.replace(/<[^>]+>/g, " "), /codex/i);
  assert.doesNotMatch(dialog.replace(/<[^>]+>/g, " "), /codex/i);
  assert.doesNotMatch(styles, /(?:^|\n)\.workflow-node\.agent\s*\{/);
  assert.match(styles, /--i18n-executable-agent:\s*"Executable Agent"/);
  assert.match(styles, /\.workflow-node\.agent::after\s*\{[\s\S]*?background:\s*#f2f6ff;[\s\S]*?color:\s*#5574c9;[\s\S]*?content:\s*var\(--i18n-executable-agent\)/);
  assert.doesNotMatch(styles, /html\[data-theme="dark"\] \.workflow-node\.agent\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node\.agent::after\s*\{[^}]*background:\s*#29334a;[^}]*color:\s*#9bb3f4/);
  assert.match(styles, /\.workflow-node:hover:not\(:disabled\)\s*\{/);
  assert.match(styles, /\.workflow-node:focus-visible\s*\{/);
  assert.match(styles, /\.workflow-node\.selected\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-agent-steps li\s*\{/);
});

test("workflow canvas wheel zoom is cursor anchored and clamped to readable bounds", async () => {
  const {
    WORKFLOW_CANVAS_MAX_ZOOM,
    WORKFLOW_CANVAS_MIN_ZOOM,
    normalizeWorkflowCanvasZoom,
    workflowCanvasZoomFromWheel,
  } = await workflowCanvasModule;
  assert.equal(WORKFLOW_CANVAS_MIN_ZOOM, 0.5);
  assert.equal(WORKFLOW_CANVAS_MAX_ZOOM, 2);
  assert.equal(normalizeWorkflowCanvasZoom(0.01), 0.5);
  assert.equal(normalizeWorkflowCanvasZoom(8), 2);
  assert.equal(normalizeWorkflowCanvasZoom(Number.NaN), 1);
  assert.ok(workflowCanvasZoomFromWheel(1, -100) > 1, "wheel up must zoom in");
  assert.ok(workflowCanvasZoomFromWheel(1, 100) < 1, "wheel down must zoom out");
  assert.equal(workflowCanvasZoomFromWheel(1, -10_000), 2);
  assert.equal(workflowCanvasZoomFromWheel(1, 10_000), 0.5);

  const workflowCanvasSource = await readFile(new URL("../src/renderer/workflow-canvas.ts", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(
    workflowCanvasSource,
    /aria-label="工作流画布；滚轮缩放，拖拽空白处任意移动"/,
  );
  assert.match(
    mainSource,
    /viewport\.addEventListener\("wheel",[\s\S]*workflowCanvasZoomFromWheel\([\s\S]*const anchorX = \(pointerX - currentTransform\.x\) \/ currentZoom;[\s\S]*const anchorY = \(pointerY - currentTransform\.y\) \/ currentZoom;[\s\S]*applyWorkflowCanvasViewportTransform\(viewport, \{[\s\S]*x: pointerX - anchorX \* nextZoom,[\s\S]*y: pointerY - anchorY \* nextZoom,[\s\S]*zoom: nextZoom,[\s\S]*\{ passive: false \}/,
    "wheel zoom must keep the graph point under the cursor while preventing native scrolling",
  );
  assert.match(
    mainSource,
    /function workflowCanvasPointInGraph\([\s\S]*\(clientX - graphRect\.left\) \/ zoom[\s\S]*\(clientY - graphRect\.top\) \/ zoom/,
    "pointer operations must convert screen coordinates back into zoom-independent graph coordinates",
  );
  assert.match(
    styles,
    /\.cluster-workflow-canvas\s*\{[^}]*--workflow-canvas-pan-x:\s*0px;[^}]*--workflow-canvas-pan-y:\s*0px;[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    styles,
    /\.workflow-graph\s*\{[^}]*transform:\s*translate3d\([\s\S]*var\(--workflow-canvas-pan-x\),[\s\S]*var\(--workflow-canvas-pan-y\),[\s\S]*\) scale\(var\(--workflow-canvas-zoom\)\);[^}]*transform-origin:\s*top left;/s,
  );
  assert.match(styles, /\.workflow-grid\s*\{[^}]*background-position:\s*var\(--workflow-canvas-pan-x\) var\(--workflow-canvas-pan-y\);/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-grid\s*\{/);
});

test("workflow canvas pans without bounds on blank-pointer drag and snaps dragged nodes while keeping edges live", async () => {
  const {
    captureWorkflowCanvasLayout,
    moveWorkflowCanvasNodeToTarget,
    renderWorkflowCanvas,
    snapWorkflowCanvasLayoutToGrid,
    workflowCanvasGridLayerY,
    workflowCanvasGridRowXPositions,
  } = await workflowCanvasModule;
  const run = {
    id: "workflow-pointer-drag",
    threadId: "thread-pointer-drag",
    status: "succeeded",
    nodes: [
      { ...workflowNode("root-plan", "root"), status: "succeeded" },
      { ...workflowNode("local-context", "context", ["root-plan"]), status: "succeeded" },
      { ...workflowNode("candidate-a", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("candidate-b", "model", ["local-context"]), status: "succeeded" },
      { ...workflowNode("review", "model", ["candidate-a", "candidate-b"]), status: "succeeded" },
      { ...workflowNode("delivery", "agent", ["review"]), status: "succeeded" },
    ],
  };
  const snapshot = captureWorkflowCanvasLayout(run);
  const deliberatelyMisaligned = {
    ...snapshot,
    width: 900,
    nodePositions: Object.fromEntries(
      Object.entries(snapshot.nodePositions).map(([nodeId, position], index) => [
        nodeId,
        {
          ...position,
          x: position.x + 13 + index * 7,
          y: position.y + 11,
        },
      ]),
    ),
  };
  const snapped = snapWorkflowCanvasLayoutToGrid(run, deliberatelyMisaligned, 900);
  assert.equal(snapped.width, 900);
  const snappedRows = new Map();
  for (const [nodeId, position] of Object.entries(snapped.nodePositions)) {
    const row = snappedRows.get(position.layer) || [];
    row.push({ nodeId, position });
    snappedRows.set(position.layer, row);
  }
  for (const [layer, row] of snappedRows) {
    row.sort((left, right) => left.position.x - right.position.x);
    assert.deepEqual(
      row.map(({ position }) => position.x),
      workflowCanvasGridRowXPositions(900, row.length),
      `row ${layer} must use only the canvas-sized fixed columns`,
    );
    assert.ok(row.every(({ position }) => position.y === workflowCanvasGridLayerY(layer)));
  }
  const moved = moveWorkflowCanvasNodeToTarget(
    run,
    snapshot,
    "review",
    {
      placement: "parallel",
      layer: 0,
      anchorNodeId: "candidate-b",
      anchorDisplayNodeId: "candidate-b",
      side: "right",
    },
    { x: 720, y: 100 },
  );
  assert.equal(moved.moved, true);
  assert.deepEqual(
    moved.run.nodes.find((node) => node.id === "review").dependsOn,
    ["local-context"],
  );
  assert.deepEqual(
    moved.run.nodes.find((node) => node.id === "delivery").dependsOn,
    ["candidate-a", "candidate-b", "review"],
    "moving a node must bypass and then reconnect its downstream edge at the drop row",
  );
  assert.equal(moved.layoutSnapshot.nodePositions.review.layer, 0);
  assert.equal(moved.layoutSnapshot.nodePositions.delivery.layer, 1);
  assert.ok(
    moved.layoutSnapshot.edges.some((edge) => (
      edge.sourceNodeId === "review" && edge.targetNodeId === "delivery"
    )),
    "the committed layout must contain the moved node's outgoing connection",
  );
  assert.ok(
    moved.layoutSnapshot.entryNodeIds.includes("review"),
    "moving a node into the first visible row must keep its composer entry connection",
  );

  const fallbackRun = {
    ...run,
    id: "workflow-pointer-drag-fallback",
    nodes: [
      run.nodes[0],
      run.nodes[1],
      {
        ...workflowNode("draft", "model", ["local-context"]),
        status: "failed",
        provider: "qwen",
        model: "qwen3.7-plus",
        executorChoice: 3,
        maxExecutorChoices: 3,
        executorHistory: [
          { executorChoice: 1, provider: "openai", model: "gpt-5.6-luna", status: "failed" },
          { executorChoice: 2, provider: "anthropic", model: "claude-fable-5", status: "failed" },
        ],
      },
    ],
  };
  const fallbackSnapshot = captureWorkflowCanvasLayout(fallbackRun);
  const movedFallbackCard = moveWorkflowCanvasNodeToTarget(
    fallbackRun,
    fallbackSnapshot,
    "draft",
    {
      placement: "parallel",
      layer: 0,
      anchorNodeId: "draft",
      anchorDisplayNodeId: "draft::executor:2",
      side: "right",
    },
    { x: 900, y: 100 },
    "draft",
  );
  assert.equal(movedFallbackCard.run, fallbackRun);
  assert.deepEqual(movedFallbackCard.run.nodes, fallbackRun.nodes);
  assert.notDeepEqual(
    movedFallbackCard.layoutSnapshot.nodePositions.draft,
    fallbackSnapshot.nodePositions.draft,
    "one executor-history card moves by display id without moving the shared semantic node",
  );
  assert.ok(movedFallbackCard.layoutSnapshot.nodePositions["draft::executor:2"]);
  assert.ok(movedFallbackCard.layoutSnapshot.nodePositions["draft::executor:3"]);
  assert.ok(
    movedFallbackCard.layoutSnapshot.nodePositions.draft.x
      > movedFallbackCard.layoutSnapshot.nodePositions["draft::executor:3"].x,
    "a pointer beyond the current row edge must create an edge drop slot instead of pinning the preview",
  );

  const canvas = renderWorkflowCanvas(run, null, workflowNodeLogoUrls, snapshot);
  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  const blankPanTargetSource = mainSource.slice(
    mainSource.indexOf("function workflowCanvasBlankPanTarget"),
    mainSource.indexOf("function workflowCanvasDropPreviewRect"),
  );
  assert.match(canvas, /data-workflow-node-draggable="true"/);
  assert.doesNotMatch(
    blankPanTargetSource,
    /\.workflow-edge-group/,
    "transparent edge hit paths must behave like blank canvas once the pointer starts moving",
  );
  assert.match(
    blankPanTargetSource,
    /\.workflow-node[\s\S]*\.workflow-node-delete[\s\S]*\[data-workflow-node-port\]/,
    "node cards, delete controls, and connection ports must remain interactive instead of panning",
  );
  assert.match(
    mainSource,
    /const startPan = \(event: PointerEvent\)[\s\S]*workflowCanvasBlankPanTarget\(viewport, event\)[\s\S]*event\.preventDefault\(\);[\s\S]*viewport\.setPointerCapture\(event\.pointerId\);[\s\S]*composerConnector\?\.addEventListener\("pointerdown", startPan\);/,
    "canvas pan must suppress native dragging and also start from the overlaid composer-edge hit path",
  );
  assert.match(
    mainSource,
    /const preventNativeCanvasDrag = \(event: DragEvent\)[\s\S]*event\.preventDefault\(\);[\s\S]*viewport\.addEventListener\("dragstart", preventNativeCanvasDrag\);[\s\S]*composerConnector\?\.addEventListener\("dragstart", preventNativeCanvasDrag\);/,
    "Chromium native drag feedback must never replace the custom canvas pan gesture",
  );
  assert.match(
    mainSource,
    /applyWorkflowCanvasViewportTransform\(viewport, \{[\s\S]*x: panGesture\.panX \+ deltaX,[\s\S]*y: panGesture\.panY \+ deltaY/,
    "blank-space dragging must apply an unrestricted screen-space translation",
  );
  assert.match(
    mainSource,
    /x: graph \? \(viewport\.clientWidth - graph\.offsetWidth \* zoom\) \/ 2 : 0/,
    "the initial viewport should center a graph even when it is wider than the visible pane",
  );
  assert.match(
    mainSource,
    /workflowCanvasInsertionTargetAtPoint\([\s\S]*gesture\.displayNodeId[\s\S]*moveWorkflowCanvasNodeToTarget\([\s\S]*gesture\.displayNodeId/,
  );
  assert.match(mainSource, /const cards = \[node\];[\s\S]*const displayNodeIds = new Set\(\[displayNodeId\]\);/);
  assert.doesNotMatch(
    mainSource,
    /const cards = \[\.\.\.viewport\.querySelectorAll<HTMLElement>\("\.workflow-node\[data-workflow-source-node-id\]"\)\]/,
  );
  assert.match(
    mainSource,
    /updateWorkflowCanvasDraggedNodeEdges\([\s\S]*workflowCanvasConnectionPreviewPath\([\s\S]*\.workflow-edge-hit/,
    "dragging must redraw both visible and hit-area paths from the live port positions",
  );
  assert.match(styles, /\.cluster-workflow-viewport\.is-panning[\s\S]*cursor:\s*grabbing/);
  assert.match(styles, /\.workflow-node\.is-dragging\s*\{[^}]*cursor:\s*grabbing;[^}]*transition:\s*none;/s);
  assert.match(styles, /\.workflow-node-drop-preview\s*\{[^}]*border:\s*1\.5px dashed/s);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node\.is-dragging\s*\{/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-node-drop-preview\s*\{/);
  assert.match(
    mainSource,
    /function expandWorkflowCanvasDragSurface\([\s\S]*graph\.style\.width[\s\S]*applyWorkflowCanvasViewportTransform\([\s\S]*workflowCanvasViewportTransformForViewport\(viewport\)[\s\S]*svg\.setAttribute\("viewBox"/,
  );
  assert.match(
    mainSource,
    /function workflowCanvasDragEdgeVelocity\([\s\S]*WORKFLOW_CANVAS_DRAG_EDGE_ZONE[\s\S]*WORKFLOW_CANVAS_DRAG_EDGE_MAX_SPEED/,
  );
  assert.match(
    mainSource,
    /const runNodeDragAutoPan = \(\)[\s\S]*workflowCanvasDragEdgeVelocity\([\s\S]*applyWorkflowCanvasViewportTransform\(viewport, \{[\s\S]*x: viewportTransform\.x - horizontalVelocity,[\s\S]*y: viewportTransform\.y - verticalVelocity,[\s\S]*applyNodeDragPosition\(\)/,
  );
  assert.doesNotMatch(mainSource, /translateExtent|panGesture\.panX\s*=\s*clampNumber|panGesture\.panY\s*=\s*clampNumber/);
  assert.match(styles, /\.cluster-workflow-viewport\s*\{[^}]*overflow:\s*hidden;[^}]*touch-action:\s*none;/s);
  assert.match(
    mainSource,
    /const insertionRowIndex = previousRowIndex >= 0[\s\S]*workflowCanvasGridRowXPositions\(graph\.offsetWidth, 1\)[\s\S]*workflowCanvasGridLayerY\(insertionRowIndex\)/,
    "between-row previews must use the same fixed grid slots as committed nodes",
  );
  assert.match(
    mainSource,
    /moveWorkflowCanvasNodeToTarget\([\s\S]*gesture\.displayNodeId,[\s\S]*graph\.offsetWidth/,
    "node drops must commit against the same measured canvas width used by the preview grid",
  );
});

test("nested canvas connections require the frozen input and output slot types", async () => {
  const { workflowCanvasNestedConnectionIssue } = await workflowCanvasModule;
  const slot = (slotId, type, semanticName, accept = [], origin = "generated") => ({
    slotId,
    type,
    semanticName,
    minCount: 1,
    maxCount: 1,
    required: true,
    accept,
    origin: { kind: origin },
  });
  const contract = (inputs, outputs) => ({
    version: 1,
    compiled: true,
    inputContract: { mode: "declared", slots: inputs },
    taskDefinition: { text: "test" },
    outputContract: { slots: outputs },
  });
  const source = {
    ...workflowNode("source", "model"),
    nodeContract: contract(
      [slot("request", "text", "请求", [], "workflow_input")],
      [slot("prompt", "text", "提示词")],
    ),
  };
  const nested = {
    ...workflowNode("nested", "workflow", ["source"]),
    workflowRef: { specId: "spec-child", version: 1, graphHash: "hash" },
    nodeContract: contract(
      [slot("child-prompt", "text", "提示词", [], "workflow_input")],
      [slot("word", "file", "Word文档", [".docx"])],
    ),
  };
  const target = {
    ...workflowNode("target", "agent", ["nested"]),
    nodeContract: contract(
      [slot(
        "word-input",
        "file",
        "Word文档",
        ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        "upstream",
      )],
      [slot("text", "text", "正文")],
    ),
  };
  const run = {
    id: "nested-contract-run",
    threadId: "nested-contract-thread",
    status: "succeeded",
    nodes: [source, nested, target],
  };
  assert.equal(workflowCanvasNestedConnectionIssue(run, ["nested"]), null);

  const invalidUpstream = {
    ...run,
    nodes: run.nodes.map((node) => node.id === "source"
      ? {
          ...node,
          nodeContract: contract([], [slot("pdf", "file", "PDF", [".pdf"])]),
        }
      : node),
  };
  assert.match(
    workflowCanvasNestedConnectionIssue(invalidUpstream, ["nested"]),
    /上游输出不符合历史画布.*固定输入要求/,
  );

  const invalidDownstream = {
    ...run,
    nodes: run.nodes.map((node) => node.id === "target"
      ? {
          ...node,
          nodeContract: contract(
            [slot("text-input", "text", "文字", [], "upstream")],
            [slot("text", "text", "正文")],
          ),
        }
      : node),
  };
  assert.match(
    workflowCanvasNestedConnectionIssue(invalidDownstream, ["nested"]),
    /固定输出.*不符合下游节点/,
  );

  const styles = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const mainSource = await readFile(new URL("../src/renderer/main.ts", import.meta.url), "utf8");
  assert.match(mainSource, /boundaryContract\?:[\s\S]*nodeContract\?: WorkflowNodeContract/);
  assert.match(mainSource, /insertWorkflowCanvasNestedSpec[\s\S]*workflowCanvasNestedConnectionIssue\(nextDraft, \[node\.id\]\)/);
  assert.match(mainSource, /completeWorkflowCanvasConnection[\s\S]*workflowCanvasNestedConnectionIssue\(connectionResult\.run, nestedNodeIds\)/);
  assert.match(mainSource, /workflow-canvas-history-option[\s\S]*disabled aria-disabled/);
  assert.match(styles, /\.workflow-canvas-history-option:disabled[\s\S]*cursor: not-allowed/);
  assert.match(styles, /html\[data-theme="dark"\] \.workflow-canvas-history-option:disabled/);
});
