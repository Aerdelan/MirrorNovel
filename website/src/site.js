const dialog = document.querySelector('#image-dialog');
const image = document.querySelector('#dialog-image');
let opener;
if (dialog && typeof dialog.showModal === 'function') {
  document.querySelectorAll('[data-full]').forEach(link => {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = link;
      image.src = link.dataset.full;
      image.alt = `${link.dataset.label}原图`;
      document.querySelector('#dialog-title').textContent = link.dataset.label;
      document.querySelector('#original-link').href = link.href;
      dialog.showModal();
      document.body.classList.add('dialog-open');
    });
  });
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
    opener?.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

const tabs = Array.from(document.querySelectorAll('[role=tab]'));
const panel = document.querySelector('#hero-preview');
if (tabs.length && panel) {
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'tab-create');
  document.querySelector('.tabs').hidden = false;
  function selectTab(button) {
    tabs.forEach(tab => {
      tab.setAttribute('aria-selected', String(tab === button));
      tab.tabIndex = tab === button ? 0 : -1;
    });
    const shot = panel.querySelector('[data-full]');
    const currentImage = panel.querySelector('img');
    const key = button.dataset.shot;
    currentImage.srcset = [768, 1280, 1920].map(width => `/assets/${key}-${width}.webp ${width}w`).join(', ');
    currentImage.src = `/assets/${key}-1280.webp`;
    currentImage.alt = `MirrorNovel 桌面端真实截图：${button.dataset.name}`;
    panel.setAttribute('aria-labelledby', button.id);
    shot.href = `/assets/${key}.png`;
    shot.dataset.full = shot.href;
    shot.dataset.label = button.dataset.name;
    shot.setAttribute('aria-label', `放大${button.dataset.name}截图`);
  }
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => selectTab(button));
    button.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectTab(tabs[next]);
        tabs[next].focus();
      }
    });
  });
}
