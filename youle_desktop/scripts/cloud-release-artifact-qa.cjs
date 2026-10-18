// Read-only release QA: download the actual installer through the updater,
// extract its payload, compare every packaged file, then run the G3 audit.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http'),assert=require('node:assert/strict');
const {pipeline}=require('node:stream/promises');
const {execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const {auditCloudStrategyPackage}=require('./audit-cloud-strategy-package.cjs');
async function hash(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
(async()=>{
  const root=path.resolve(process.argv[2]);
  const version=require('../package.json').version;
  const installer=path.join(root,`haolo_desktop-${version}-Setup.exe`);
  const output=path.join(root,'update-roundtrip');fs.mkdirSync(output,{recursive:true});
  const destinationPath=path.join(output,path.basename(installer));
  const size=fs.statSync(installer).size,sha=await hash(installer),resumeAt=1048576;
  const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push({path:req.url,range:req.headers.range||null});
    if(req.url==='/unavailable'){res.writeHead(503);res.end();return;}
    const start=Number(/^bytes=(\d+)-$/.exec(req.headers.range||'')?.[1]||0);
    const headers={'content-length':String(size-start)};
    if(start)headers['content-range']=`bytes ${start}-${size-1}/${size}`;
    res.writeHead(start?206:200,headers);fs.createReadStream(installer,{start}).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    await pipeline(fs.createReadStream(installer,{start:0,end:resumeAt-1}),fs.createWriteStream(destinationPath+'.part'));
    const {downloadFileFromMirrors}=await import(pathToFileURL(path.join(__dirname,'../src/main/app-update-downloader.mjs')));
    const base=`http://127.0.0.1:${server.address().port}`;
    const result=await downloadFileFromMirrors({urls:[base+'/unavailable',base+'/installer'],
      destinationPath,expectedSize:size,expectedSha256:sha,maxAttempts:1,fetchImpl:fetch});
    assert.equal(result.sha256,sha);assert.equal(await hash(destinationPath),sha);
    assert.ok(requests.some(r=>r.path==='/installer'&&r.range===`bytes=${resumeAt}-`));
    const builderRequire=createRequire(require.resolve('electron-builder'));
    const extracted=path.join(output,'extracted');
    const log=execFileSync(builderRequire('7zip-bin').path7za,['x',destinationPath,`-o${extracted}`,'-y'],{encoding:'utf8',windowsHide:true});
    fs.writeFileSync(path.join(output,'extract.log'),log);
    const compared=[];
    async function walk(relative=''){
      for(const item of fs.readdirSync(path.join(root,'win-unpacked',relative),{withFileTypes:true})){
        const rel=path.join(relative,item.name);
        if(item.isDirectory())await walk(rel);
        else {const expected=await hash(path.join(root,'win-unpacked',rel));
          assert.equal(await hash(path.join(extracted,rel)),expected,rel);compared.push({path:rel,sha256:expected});}
      }
    }
    await walk();
    const audit=auditCloudStrategyPackage(extracted);
    const report={passed:true,version,installerSha256:sha,size,requests,resumedFrom:resumeAt,
      identicalFiles:compared.length,files:compared,audit,
      scope:'Actual signed bytes via production downloader; loopback HTTP fixture, no production upload or installation'};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:true,version,identicalFiles:compared.length,auditFiles:audit.fileCount,sha256:sha}));
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
