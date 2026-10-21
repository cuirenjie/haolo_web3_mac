import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const python=process.env.PYTHON || (process.platform==="win32"?"python":"python3");
const root=path.resolve("resources/default-haolo-ai/skills/.system");
const image=path.join(root,"imagegen/scripts/generate_openai_image.py");
const video=path.join(root,"videogen/scripts/generate_seedance_video.py");
const resolver=path.join(root,"imagegen/scripts/resolve_prompt_preset.py");
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=";
const response={data:[{b64_json:png}],usage:{input_tokens:20,output_tokens:515}};
function env(extra={}) {return {...process.env,PYTHONUTF8:"1",PYTHONIOENCODING:"utf-8",
  LLMHUB_API_KEY:"test-gateway-only",LLMHUB_BASE_URL:"https://haolo.pro/v1",
  HAOLO_GEN_HTTP_TRANSPORT:"urllib",HAOLO_MODEL_RELAY_URL:"",...extra};}
function temp(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),"haolo-official-media-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function run(script,args,extra={}) {return new Promise((resolve,reject)=>{
  const child=spawn(python,["-X","utf8",script,...args],{env:env(extra)});let out="",err="";
  child.stdout.on("data",x=>out+=x);child.stderr.on("data",x=>err+=x);child.on("error",reject);
  child.on("close",status=>{let payload;try{payload=JSON.parse(out);}catch{payload=null;}resolve({status,payload,out,err});});
});}
async function server(t,handler) {const calls=[];const app=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
  const call={url:req.url,method:req.method,headers:req.headers,body:raw?JSON.parse(raw):null};calls.push(call);await handler(call,res);
});await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  t.after(()=>{app.closeAllConnections();app.close();});return {calls,base:"http://127.0.0.1:"+app.address().port+"/v1"};}
function preset(dir) {const result=spawnSync(python,["-X","utf8",resolver,"--request","Draw a red circle","--output-dir",path.join(dir,"checks")],{env:env(),encoding:"utf8"});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
function args(dir,check,extra=[]) {return ["--prompt","Draw a red circle","--user-request","Draw a red circle","--preset-check-file",check.check_file,"--output-dir",path.join(dir,"out"),...extra];}
function json(res,value,status=200) {res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(value));}

test("official generation saves actual PNG dimensions and resumes without another POST",async t=>{
  const dir=temp(t),check=preset(dir),mock=await server(t,(_,res)=>json(res,response));
  const first=await run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base});
  assert.equal(first.status,0,first.out+first.err);assert.equal(first.payload.model,"codex/gpt-image-2");
  assert.equal(first.payload.saved[0].width,1);assert.equal(first.payload.saved[0].height,1);
  assert.ok(fs.existsSync(first.payload.saved[0].path));
  assert.equal(mock.calls[0].url,"/v1/images/generations");assert.equal(mock.calls[0].headers.authorization,"Bearer test-gateway-only");
  assert.equal(mock.calls[0].headers["x-haolo-model-capability"],"image_generation");
  assert.equal(mock.calls[0].body.model,"codex/gpt-image-2");assert.equal(mock.calls[0].body.size,"auto");
  const second=await run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base});
  assert.equal(second.status,0,second.out);assert.equal(second.payload.resumed,true);assert.equal(mock.calls.length,1);
  const changed=await run(image,args(dir,check,["--basename","changed"]),{LLMHUB_BASE_URL:mock.base});
  assert.notEqual(changed.status,0);assert.equal(mock.calls.length,1);
});
test("edits preserve reference bytes and use JSON edits",async t=>{
  const dir=temp(t),check=preset(dir),ref=path.join(dir,"source.png");fs.writeFileSync(ref,Buffer.from(png,"base64"));
  const mock=await server(t,(_,res)=>json(res,response));
  const result=await run(image,args(dir,check,["--image",ref,"--strict-edit"]),{LLMHUB_BASE_URL:mock.base});
  assert.equal(result.status,0,result.out+result.err);assert.equal(mock.calls[0].url,"/v1/images/edits");
  assert.equal(mock.calls[0].body.images[0].image_url,"data:image/png;base64,"+png);
  assert.match(mock.calls[0].body.prompt,/preserve all unspecified content/);
});
test("missing and tampered preset checks fail before HTTP",async t=>{
  const dir=temp(t),check=preset(dir),mock=await server(t,(_,res)=>json(res,response));
  assert.notEqual((await run(image,["--prompt","cat"],{LLMHUB_BASE_URL:mock.base})).status,0);
  const record=JSON.parse(fs.readFileSync(check.check_file));record.request_sha256="wrong";fs.writeFileSync(check.check_file,JSON.stringify(record));
  assert.notEqual((await run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base})).status,0);assert.equal(mock.calls.length,0);
});
for(const failure of ["disconnect","invalid-json","http-502"])test("no automatic resubmission after "+failure,async t=>{
  const dir=temp(t),check=preset(dir),mock=await server(t,(_,res)=>{
    if(failure==="disconnect")res.destroy();else if(failure==="invalid-json")res.end("invalid");else json(res,{error:{message:"upstream failure"}},502);
  });
  const first=await run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base});
  assert.notEqual(first.status,0);assert.equal(first.payload.safe_to_resubmit,false);
  assert.notEqual((await run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base})).status,0);assert.equal(mock.calls.length,1);
});
test("concurrent invocations of one preset create only one upstream request",async t=>{
  const dir=temp(t),check=preset(dir),mock=await server(t,async(_,res)=>{await new Promise(r=>setTimeout(r,200));json(res,response);});
  const results=await Promise.all([1,2].map(()=>run(image,args(dir,check),{LLMHUB_BASE_URL:mock.base})));
  assert.ok(results.some(r=>r.status===0));assert.equal(mock.calls.length,1);
});
test("credential-bearing POST never follows redirects",async t=>{
  const dir=temp(t),check=preset(dir),target=await server(t,(_,res)=>json(res,response));
  const source=await server(t,(_,res)=>{res.writeHead(307,{Location:target.base+"/images/generations"});res.end();});
  assert.notEqual((await run(image,args(dir,check),{LLMHUB_BASE_URL:source.base})).status,0);
  assert.equal(source.calls.length,1);assert.equal(target.calls.length,0);
});
test("unsupported models and external endpoints cannot receive credentials",async t=>{
  const dir=temp(t),check=preset(dir);
  assert.notEqual((await run(image,["--prompt","cat","--model","retired/image","--dry-run"])).status,0);
  const foreign=await run(image,args(dir,check,["--api-url","https://example.com/v1/images/generations"]));
  assert.notEqual(foreign.status,0);assert.doesNotMatch(foreign.out+foreign.err,/test-gateway-only/);
});
test("route-specific credentials take precedence over default auth",async t=>{
  const dir=temp(t),mock=await server(t,(_,res)=>json(res,response));
  fs.writeFileSync(path.join(dir,"auth.json"),JSON.stringify({LLMHUB_API_KEY:"wrong-default",LLMHUB_BASE_URL:"https://haolo.pro/v1",
    HAOLO_MEDIA_MODEL_CREDENTIALS:{image_generation:{"codex/gpt-image-2":{api_key:"selected-route",base_url:mock.base}}}}));
  const result=await run(image,args(dir,preset(dir)),{LLMHUB_API_KEY:"",LLMHUB_BASE_URL:"",HAOLO_AI_CONFIG_DIR:dir});
  assert.equal(result.status,0,result.out+result.err);assert.equal(mock.calls[0].headers.authorization,"Bearer selected-route");
});
test("curl transport preserves Unicode prompt and credential headers",async t=>{
  const dir=temp(t),check=preset(dir),mock=await server(t,(_,res)=>json(res,response)),command=args(dir,check);command[1]="红色圆形";
  const result=await run(image,command,{LLMHUB_BASE_URL:mock.base,HAOLO_GEN_HTTP_TRANSPORT:"curl"});
  assert.equal(result.status,0,result.out+result.err);assert.match(mock.calls[0].body.prompt,/红色圆形/);
  assert.equal(mock.calls[0].headers.authorization,"Bearer test-gateway-only");
});
test("remaining video model submits once and resumes with a Windows-safe journal",async t=>{
  const dir=temp(t),mock=await server(t,(call,res)=>{
    if(call.method==="POST")json(res,{id:"task-123"},202);
    else if(call.url.endsWith("/content")){res.writeHead(200,{"Content-Type":"video/mp4"});res.end(Buffer.from("....ftypmp42video"));}
    else json(res,{status:"completed"});
  });
  const command=["--prompt","Animate circle","--model","omni_flash-10s","--image-url","https://example.com/a.png","--duration","10",
    "--request-id","video-expert:test-uuid","--conversation-id","conversation-a","--output-dir",path.join(dir,"out"),"--job-dir",path.join(dir,"jobs")];
  const first=await run(video,command,{LLMHUB_BASE_URL:mock.base});assert.equal(first.status,0,first.out+first.err);assert.ok(fs.existsSync(first.payload.saved));
  const resumed=await run(video,["--resume-latest","--conversation-id","conversation-a","--job-dir",path.join(dir,"jobs")],{LLMHUB_BASE_URL:mock.base});
  assert.equal(resumed.status,0,resumed.out+resumed.err);assert.equal(mock.calls.filter(x=>x.method==="POST").length,1);
  assert.equal(mock.calls[0].headers["x-haolo-model-capability"],"video_generation");
});
