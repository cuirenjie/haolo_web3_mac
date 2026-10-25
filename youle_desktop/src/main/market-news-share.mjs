import fs from 'node:fs/promises';

export async function saveNewsImage({dataUrl, window, dialog, language, valid}) {
  if (typeof dataUrl !== 'string' || dataUrl.length > 24_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) throw Error('INVALID_NEWS_IMAGE');
  const bytes=Buffer.from(dataUrl.split(',')[1],'base64');
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('INVALID_NEWS_IMAGE');
  const titles={'zh-CN':'保存快讯图片','zh-TW':'儲存快訊圖片',en:'Save news image',ko:'속보 이미지 저장'};
  const result=await dialog.showSaveDialog(window,{title:titles[language]||titles['zh-CN'],defaultPath:`Haolo-news-${Date.now()}.png`,filters:[{name:'PNG',extensions:['png']}]});
  if(result.canceled || !result.filePath || !valid())return {saved:false};
  await fs.writeFile(result.filePath,bytes);return {saved:true};
}
