import {app,BrowserWindow,nativeTheme} from 'electron/main';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('youle_desktop/output/flash-news-20261025');
app.setPath('userData',path.join(out,'share-qa-profile'));app.disableHardwareAcceleration();
let win;async function main(){try{
  const live=JSON.parse(await readFile(path.join(out,'production-report.json'),'utf8'));
  await app.whenReady();win=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true}});
  await win.loadURL(live.publicShareUrl);
  const text=await win.webContents.executeJavaScript('document.body.innerText');assert.match(text,/Haolo/);assert.doesNotMatch(text,/aicoin/i);
  for(const [width,height,label] of [[1000,1000,'desktop'],[390,844,'mobile']])for(const theme of ['light','dark']){
    win.setSize(width,height);nativeTheme.themeSource=theme;await new Promise(r=>setTimeout(r,300));
    assert.ok(await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'));
    await writeFile(path.join(out,`public-share-${label}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
  }
  console.log(JSON.stringify({status:'passed',url:live.publicShareUrl,haoloOnly:true,desktopMobile:true,lightDark:true}));
}catch(error){console.error(String(error));process.exitCode=1;}finally{win?.destroy();app.exit(process.exitCode||0);}}
void main();
