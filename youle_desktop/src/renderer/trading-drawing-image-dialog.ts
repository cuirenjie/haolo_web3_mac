import { drawingImageUrl, storeDrawingImage } from './trading-drawing-extra-tools.ts';
import { translateAppText } from './app-language.mjs';

export interface DrawingImageSelection { reference: string; opacity: number; width: number; height: number }

export class DrawingImageDialog {
  private dialog: HTMLDialogElement | null = null;
  private generation = 0;
  get open() { return Boolean(this.dialog?.open); }
  close() { this.generation++; this.dialog?.close(); this.dialog?.remove(); this.dialog = null; }

  show(host: HTMLElement, confirm: (selection: DrawingImageSelection) => void, initial?: DrawingImageSelection, pastedFile?: File) {
    this.close();
    const generation = this.generation;
    const dialog = document.createElement('dialog');
    dialog.className = 'trading-drawing-image-dialog';
    dialog.setAttribute('aria-label', translateAppText('图片'));
    dialog.innerHTML = `<form><header><h2>图片</h2><button type="button" data-image-cancel aria-label="关闭">×</button></header>
      <button type="button" class="trading-image-select" data-image-select><img hidden alt="图片预览"><span data-image-prompt><strong>选择图片</strong><small>JPG, PNG或WEBP<br>最大图像大小2MB</small></span></button>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-image-file hidden>
      <p data-image-error role="alert" hidden></p>
      <label class="trading-image-opacity">透明度<input type="range" min="0" max="100" step="1" value="100" aria-label="透明度" data-image-opacity></label>
      <footer><button type="button" data-image-cancel>取消</button><button type="submit" disabled>确认</button></footer></form>`;
    this.dialog = dialog;
    host.append(dialog);
    const fileInput = dialog.querySelector<HTMLInputElement>('[data-image-file]')!;
    const preview = dialog.querySelector<HTMLImageElement>('img')!;
    const prompt = dialog.querySelector<HTMLElement>('[data-image-prompt]')!;
    const opacity = dialog.querySelector<HTMLInputElement>('[data-image-opacity]')!;
    const submit = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const error = dialog.querySelector<HTMLElement>('[data-image-error]')!;
    let selection = initial, dataUrl = '', loadId = 0;
    const update = () => { preview.style.opacity = String(Number(opacity.value) / 100); };
    if (initial) { preview.src = drawingImageUrl(initial.reference); preview.hidden = false; prompt.hidden = true; opacity.value = String(initial.opacity * 100); submit.disabled = false; update(); }
    const choose = async (file: File) => {
      const id = ++loadId;
      error.hidden = true;
      submit.disabled = true;
      try {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WEBP 图片');
        if (file.size > 2 * 1024 * 1024) throw new Error('最大图像大小2MB');
        const bitmap = await createImageBitmap(file);
        try {
          if (generation !== this.generation || id !== loadId) return;
          const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/webp', .85);
          const displayScale = Math.min(1, 280 / bitmap.width, 280 / bitmap.height);
          selection = { reference: '', opacity: Number(opacity.value) / 100, width: bitmap.width * displayScale, height: bitmap.height * displayScale };
          preview.src = dataUrl; preview.hidden = false; prompt.hidden = true; submit.disabled = false; update();
        } finally { bitmap.close(); }
      } catch (failure) {
        if (generation !== this.generation || id !== loadId) return;
        error.textContent = translateAppText(failure instanceof Error ? failure.message : '无法载入图片'); error.hidden = false;
        submit.disabled = !selection;
      }
    };
    dialog.querySelector('[data-image-select]')!.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void choose(file); fileInput.value = ''; });
    opacity.addEventListener('input', update);
    dialog.querySelectorAll('[data-image-cancel]').forEach(button => button.addEventListener('click', () => this.close()));
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      if (!selection || submit.disabled) return;
      try {
        const result = { ...selection, reference: dataUrl ? storeDrawingImage(dataUrl) : selection.reference, opacity: Number(opacity.value) / 100 };
        this.close(); confirm(result);
      } catch (failure) { error.textContent = translateAppText(failure instanceof Error ? failure.message : '无法保存图片'); error.hidden = false; }
    });
    for (const type of ['pointerdown','click','dblclick','keydown']) dialog.addEventListener(type, event => event.stopPropagation());
    dialog.showModal();
    if (pastedFile) void choose(pastedFile);
  }
}
