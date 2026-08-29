import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function loadParserModule() {
  const source = await readFile(new URL("../src/renderer/wechat-attachment-parser.ts", import.meta.url), "utf8");
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

const parserModule = loadParserModule();

test("extracts a Windows file path wrapped in inline code ticks", async () => {
  const { wechatChannelTextFileAttachments } = await parserModule;
  const text = [
    "The file is ready:",
    "",
    "`C:\\Users\\Joie\\AppData\\Roaming\\haolo_desktop\\thread-groups\\default\\outputs\\numbers_1_to_10.docx`",
    "",
    "Verified.",
  ].join("\n");

  const attachments = wechatChannelTextFileAttachments(text);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "numbers_1_to_10.docx");
  assert.equal(attachments[0].mime, DOCX_MIME);
  assert.equal(
    attachments[0].local_path,
    "C:/Users/Joie/AppData/Roaming/haolo_desktop/thread-groups/default/outputs/numbers_1_to_10.docx",
  );
});

test("extracts a Chinese Windows zip path from agent text", async () => {
  const { wechatChannelTextFileAttachments } = await parserModule;
  const text = [
    "\u5df2\u6253\u5305\u5b8c\u6210\uff0c\u538b\u7f29\u5305\u5728\u8fd9\u91cc\uff1a",
    "",
    "`C:\\Users\\Joie\\AppData\\Roaming\\haolo_desktop\\thread-groups\\default\\outputs\\04_\u8d22\u52a1\u5408\u540c_20260630_235243.zip`",
  ].join("\n");

  const attachments = wechatChannelTextFileAttachments(text);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "04_\u8d22\u52a1\u5408\u540c_20260630_235243.zip");
  assert.equal(attachments[0].mime, "application/zip");
  assert.equal(
    attachments[0].local_path,
    "C:/Users/Joie/AppData/Roaming/haolo_desktop/thread-groups/default/outputs/04_\u8d22\u52a1\u5408\u540c_20260630_235243.zip",
  );
});

test("dedupes the same file referenced by markdown and inline code", async () => {
  const { wechatChannelTextFileAttachments } = await parserModule;
  const path = "C:\\Users\\Joie\\AppData\\Roaming\\haolo_desktop\\thread-groups\\default\\outputs\\numbers_1_to_10.docx";
  const text = `See [numbers_1_to_10.docx](${path}) and \`${path}\``;

  const attachments = wechatChannelTextFileAttachments(text);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "numbers_1_to_10.docx");
});

test("extracts nested WeChat message file attachments", async () => {
  const { wechatChannelMessageFileAttachments, wechatChannelMessageText } = await parserModule;
  const message = {
    id: "wx-1",
    payload: {
      content: { text: "Please read this file" },
      attachments: [
        {
          file_name: "report.pdf",
          content_type: "application/pdf",
          size_bytes: 1234,
          object_key: "wechat/inbound/report.pdf",
          download_url: "https://cdn.example.com/wechat/inbound/report.pdf?token=signed",
        },
      ],
    },
  };

  const attachments = wechatChannelMessageFileAttachments(message);

  assert.equal(wechatChannelMessageText(message), "Please read this file");
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "report.pdf");
  assert.equal(attachments[0].mime, "application/pdf");
  assert.equal(attachments[0].size, 1234);
  assert.equal(attachments[0].object_key, "wechat/inbound/report.pdf");
  assert.equal(attachments[0].download_url, "https://cdn.example.com/wechat/inbound/report.pdf?token=signed");
});

test("dedupes a WeChat image described by text metadata and structured attachment", async () => {
  const { wechatChannelMessageFileAttachments } = await parserModule;
  const windowsPath =
    "D:\\youle_agent_ms\\youle_mas-dev\\backend\\.external_channels\\attachments\\wechat-1\\message-1\\01-image.jpg";
  const normalizedPath =
    "D:/youle_agent_ms/youle_mas-dev/backend/.external_channels/attachments/wechat-1/message-1/01-image.jpg";
  const message = {
    id: "message-1",
    text: `\u8bf7\u5904\u7406\u5fae\u4fe1\u53d1\u6765\u7684\u6587\u4ef6\u3002\n\n\u9644\u4ef6:\n- 01-image.jpg (url: ${windowsPath}, size: 60951)`,
    attachments: [
      {
        type: "image",
        name: "01-image.jpg",
        url: windowsPath,
        local_path: windowsPath,
        file_path: windowsPath,
        mime: "image/jpeg",
        size: 60951,
      },
    ],
  };

  const attachments = wechatChannelMessageFileAttachments(message);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "01-image.jpg");
  assert.equal(attachments[0].local_path, normalizedPath);
  assert.ok(!String(attachments[0].url).includes("size:"));
});

test("extracts legacy WeChat image media full_url as a previewable attachment", async () => {
  const { wechatChannelMessageFileAttachments } = await parserModule;
  const imageUrl = "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=param-1";
  const message = {
    id: "wx-image-media",
    attachments: [
      {
        name: "wechat-image",
        file_name: "wechat-image",
        mime: "",
        media: {
          encrypt_query_param: "param-1",
          aes_key: "aes-key-1",
          full_url: imageUrl,
        },
      },
    ],
  };

  const attachments = wechatChannelMessageFileAttachments(message);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "wechat-image.jpg");
  assert.equal(attachments[0].mime, "image/jpeg");
  assert.equal(attachments[0].object_key, "param-1");
  assert.equal(attachments[0].url, imageUrl);
});

test("does not expose nested WeChat media metadata as a duplicate download file", async () => {
  const { wechatChannelMessageFileAttachments } = await parserModule;
  const localPath =
    "C:\\Users\\Joie\\AppData\\Roaming\\haolo_desktop\\wechat-inbound-attachments\\7477958253646346000\\01-9500ccc123c3e26e-wechat-image.jpg";
  const message = {
    id: "wx-cached-image",
    attachments: [
      {
        name: "wechat-image.jpg",
        file_name: "wechat-image.jpg",
        mime: "image/jpeg",
        object_key: "param-1",
        url: localPath,
        preview_url: localPath,
        download_url: localPath,
        local_path: localPath,
        media: {
          encrypt_query_param: "param-1",
          aes_key: "aes-key-1",
          full_url: "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=param-1",
        },
      },
    ],
  };

  const attachments = wechatChannelMessageFileAttachments(message);

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, "wechat-image.jpg");
  assert.ok(!attachments.some((attachment) => attachment.name === "download"));
});

test("builds an agent prompt for attachment-only WeChat messages", async () => {
  const { wechatChannelAgentTextWithAttachments, wechatChannelMessageFileAttachments } = await parserModule;
  const message = {
    id: "wx-file-only",
    attachments: [
      {
        name: "numbers.xlsx",
        url: "https://cdn.example.com/numbers.xlsx",
      },
    ],
  };

  const text = wechatChannelAgentTextWithAttachments("", wechatChannelMessageFileAttachments(message));

  assert.doesNotMatch(text, /\u8bf7\u5904\u7406\u5fae\u4fe1\u53d1\u6765\u7684\u6587\u4ef6/);
  assert.match(text, /\u9644\u4ef6\u4fe1\u606f\uff08\u4ec5\u4f9b\u7406\u89e3\u4e0e\u540e\u7eed\u5904\u7406\uff0c\u4e0d\u8981\u76f4\u63a5\u590d\u8ff0\uff09\uff1a/);
  assert.match(text, /numbers\.xlsx/);
  assert.match(text, /url: https:\/\/cdn\.example\.com\/numbers\.xlsx/);
});
