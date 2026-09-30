(() => {
  let top = 2200;
  window.NORTHSTAR_MODULE_HOVER_DELAY = 750;
  window.NorthstarPositionPreview = (popup, element) => {
    const box = element.getBoundingClientRect(), gap = 8, width = popup.offsetWidth;
    popup.style.maxHeight = Math.max(100, innerHeight - 16) + 'px';
    const height = popup.offsetHeight;
    let left = Math.max(gap, Math.min(box.left, innerWidth - width - gap)), top;
    if (box.bottom + gap + height <= innerHeight - gap) top = box.bottom + gap;
    else if (box.top - gap - height >= gap) top = box.top - gap - height;
    else if (box.right + gap + width <= innerWidth - gap) { left = box.right + gap; top = Math.max(gap, Math.min(box.top, innerHeight - height - gap)); }
    else if (box.left - gap - width >= gap) { left = box.left - gap - width; top = Math.max(gap, Math.min(box.top, innerHeight - height - gap)); }
    else {
      const below = innerHeight - box.bottom - gap * 2, above = box.top - gap * 2;
      const useBelow = below >= above;
      popup.style.maxHeight = Math.max(80, useBelow ? below : above) + 'px';
      top = useBelow ? box.bottom + gap : Math.max(gap, box.top - popup.offsetHeight - gap);
    }
    popup.style.left = left + 'px'; popup.style.top = top + 'px';
  };
  window.NorthStarHoverWindow = (element, title, onClose) => {
    let pinned = false;
    const originalRole = element.getAttribute('role');
    const frame = document.createElement('div');
    frame.className = 'ns-hover-window-bar';
    frame.innerHTML = `<span></span><button type="button" aria-label="Close ${title}">×</button>`;
    frame.querySelector('span').textContent = title;
    frame.querySelector('button').addEventListener('click', event => {
      event.stopPropagation();
      onClose();
    });
    element.prepend(frame);
    element.addEventListener('pointerdown', event => {
      if (event.target.closest('.ns-hover-window-bar button')) return;
      if (!pinned) {
        pinned = true;
        element.setAttribute('role', 'dialog');
        element.classList.add('ns-hover-window-pinned');
        element.style.width = element.getBoundingClientRect().width + 'px';
        element.style.height = element.getBoundingClientRect().height + 'px';
      }
      element.style.zIndex = ++top;
    });
    frame.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const startX = event.clientX, startY = event.clientY;
      const rect = element.getBoundingClientRect();
      frame.setPointerCapture(event.pointerId);
      const move = point => {
        element.style.left = Math.max(0, Math.min(innerWidth - 48, rect.left + point.clientX - startX)) + 'px';
        element.style.top = Math.max(0, Math.min(innerHeight - 36, rect.top + point.clientY - startY)) + 'px';
      };
      const stop = () => { frame.removeEventListener('pointermove', move); frame.removeEventListener('pointerup', stop); frame.removeEventListener('pointercancel', stop); };
      frame.addEventListener('pointermove', move);
      frame.addEventListener('pointerup', stop);
      frame.addEventListener('pointercancel', stop);
    });
    return {
      get pinned() { return pinned; },
      reset() {
        pinned = false;
        if (originalRole) element.setAttribute('role', originalRole);
        else element.removeAttribute('role');
        element.classList.remove('ns-hover-window-pinned');
        element.style.width = '';
        element.style.height = '';
        element.style.zIndex = '';
      },
      restoreBar() { if (element.firstElementChild !== frame) element.prepend(frame); }
    };
  };

  // One read-only snapshot window for modules without a specialized preview.
  let preview, previewWindow, anchor, hideTimer;
  const closePreview = () => {
    clearTimeout(hideTimer);
    if (preview) { preview.hidden = true; previewWindow.reset(); }
    anchor?.removeAttribute('aria-describedby'); anchor = null;
  };
  const deferHide = () => {
    clearTimeout(hideTimer);
    if (!previewWindow?.pinned) hideTimer = setTimeout(closePreview, 240);
  };
  function showPreview(element, options) {
    if (previewWindow?.pinned || document.body.classList.contains('layout-edit')) return;
    if (!preview) {
      preview = document.createElement('section');
      preview.id = 'nsModulePreview'; preview.className = 'ns-module-preview';
      preview.setAttribute('role', 'dialog'); preview.setAttribute('aria-label', 'Module preview');
      document.body.append(preview);
      previewWindow = window.NorthStarHoverWindow(preview, 'Module preview', closePreview);
      preview.addEventListener('pointerenter', () => clearTimeout(hideTimer));
      preview.addEventListener('pointerleave', deferHide);
      preview.addEventListener('pointerdown', () => clearTimeout(hideTimer));
      document.addEventListener('keydown', event => { if (event.key === 'Escape') closePreview(); });
    }
    closePreview(); anchor = element;
    const heading = document.createElement('h3'); heading.textContent = options.title();
    const source = options.source() || element, content = source.cloneNode(true);
    content.querySelectorAll('script,style,iframe,button,input,select,textarea,form,.ns-module-theme,.ns-edit-module,.ns-open-module,.ns-window-controls,.ns-section-shell,.canvas-move-handle,.canvas-resize-handle,.canvas-remove-module,.ns-hover-window-bar').forEach(node => node.remove());
    for (const node of [content, ...content.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (attr.name === 'id' || attr.name === 'tabindex' || attr.name.startsWith('data-') || attr.name.startsWith('on') || attr.name.startsWith('aria-') || attr.name === 'href') node.removeAttribute(attr.name);
      }
    }
    content.removeAttribute('style'); content.removeAttribute('hidden'); content.className = 'ns-module-preview-body';
    const footer = document.createElement('p'); footer.className = 'ns-preview-hint'; footer.textContent = 'Click the module to open full details.';
    preview.replaceChildren(heading, content, footer); previewWindow.restoreBar(); preview.hidden = false;
    element.setAttribute('aria-describedby', preview.id);
    window.NorthstarPositionPreview(preview, element);
  }
  window.NorthstarModulePreview = {
    close: closePreview,
    bind(element, options) {
      if (element.dataset.nsPreviewBound) return;
      element.dataset.nsPreviewBound = 'true'; element.tabIndex = 0;
      let timer;
      const cancel = () => clearTimeout(timer);
      element.addEventListener('pointerenter', event => {
        cancel(); clearTimeout(hideTimer);
        if (event.pointerType !== 'touch') timer = setTimeout(() => {
          if (element.isConnected && element.getClientRects().length && !element.querySelector('.gs-card:hover,[data-crew-site]:hover')) showPreview(element, options);
        }, window.NORTHSTAR_MODULE_HOVER_DELAY);
      });
      element.addEventListener('pointerleave', () => { cancel(); deferHide(); });
      element.addEventListener('pointerdown', cancel);
      element.addEventListener('focusin', event => { if (event.target === element) showPreview(element, options); });
      element.addEventListener('focusout', event => { if (!element.contains(event.relatedTarget)) { cancel(); deferHide(); } });
      const open = event => {
        if (document.body.classList.contains('layout-edit') || (event.target !== element && event.target.closest('button,a,input,select,textarea,[contenteditable],.ns-module-theme,.gs-card'))) return;
        cancel(); closePreview(); options.open();
      };
      element.addEventListener('click', open);
      element.addEventListener('keydown', event => {
        if (event.target === element && ['Enter', ' '].includes(event.key) && !document.body.classList.contains('layout-edit')) { event.preventDefault(); open(event); }
        if (event.key === 'Escape') cancel();
      });
    }
  };
})();
