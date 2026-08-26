(() => {
  'use strict';

  const START = '[[NORTHSTAR_RICH_TEXT_V1]]';
  const END = '[[/NORTHSTAR_RICH_TEXT_V1]]';
  const MAX_DETAILS = 4000;
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'STRONG', 'EM', 'U', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  ]);

  const escapeHtml = value => String(value ?? '').replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character],
  );

  function sanitiseNode(node, ownerDocument) {
    if (node.nodeType === Node.TEXT_NODE) {
      return ownerDocument.createTextNode(node.textContent || '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ownerDocument.createDocumentFragment();
    }
    if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
      return ownerDocument.createDocumentFragment();
    }

    const normalisedTag = node.tagName === 'B'
      ? 'STRONG'
      : node.tagName === 'I'
        ? 'EM'
        : node.tagName === 'DIV'
          ? 'P'
          : node.tagName;
    const output = ALLOWED_TAGS.has(normalisedTag)
      ? ownerDocument.createElement(normalisedTag.toLowerCase())
      : ownerDocument.createDocumentFragment();
    [...node.childNodes].forEach(child => output.append(sanitiseNode(child, ownerDocument)));
    return output;
  }

  function sanitiseHtml(html) {
    const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const clean = document.createElement('div');
    [...parsed.body.firstElementChild.childNodes].forEach(node => clean.append(sanitiseNode(node, document)));
    return clean.innerHTML;
  }

  function selectionRange(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    return common && editor.contains(common) ? range : null;
  }

  function placeCaret(node) {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertWrapped(editor, tagName, placeholder = 'text') {
    editor.focus();
    let range = selectionRange(editor);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const wrapper = document.createElement(tagName);
    if (range.collapsed) {
      wrapper.textContent = placeholder;
    } else {
      wrapper.append(range.extractContents());
    }
    range.insertNode(wrapper);
    placeCaret(wrapper);
  }

  function insertList(editor, ordered) {
    editor.focus();
    let range = selectionRange(editor);
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const selectedText = range.collapsed ? 'list item' : range.toString();
    const list = document.createElement(ordered ? 'ol' : 'ul');
    selectedText.split(/\r?\n/).filter(Boolean).forEach(line => {
      const item = document.createElement('li');
      item.textContent = line;
      list.append(item);
    });
    if (!list.childNodes.length) list.append(document.createElement('li'));
    if (!range.collapsed) range.deleteContents();
    range.insertNode(list);
    placeCaret(list.lastElementChild || list);
  }

  function clearFormatting(editor) {
    const lines = editor.innerText.split(/\r?\n/);
    editor.replaceChildren();
    lines.forEach((line, index) => {
      if (index) editor.append(document.createElement('br'));
      editor.append(document.createTextNode(line));
    });
    editor.focus();
  }

  function parseRichDetails(value) {
    const text = String(value || '');
    const start = text.indexOf(START);
    const end = text.indexOf(END);
    if (start < 0 || end < start) return null;
    return {
      metadata: text.slice(0, start).trim(),
      html: sanitiseHtml(text.slice(start + START.length, end).trim()),
      attachments: text.slice(end + END.length).trim(),
    };
  }

  function detailsMarkup(value) {
    const rich = parseRichDetails(value);
    if (!rich) return `<p>${escapeHtml(value)}</p>`;
    const metadata = rich.metadata
      ? `<div class="event-rich-meta">${escapeHtml(rich.metadata).replace(/\n/g, '<br>')}</div>`
      : '';
    const attachments = rich.attachments
      ? `<div class="event-rich-attachments">${escapeHtml(rich.attachments)}</div>`
      : '';
    return `<div class="event-rich-details">${metadata}${rich.html}${attachments}</div>`;
  }

  function installRichRendering() {
    if (typeof window.eventMarkup !== 'function') return;
    window.eventMarkup = event => {
      const close = event.status === 'Open' && event.id
        ? `<button class="node-expand outage-close" data-close-outage="${escapeHtml(event.id)}">CLOSE</button>`
        : '';
      const title = event.subject || event.title || '';
      const details = event.details ?? event.site ?? '';
      return `<article class="event-item"><header><span>${opsTime(event.timestamp || event.openedAt)} · ${escapeHtml(event.type || event.severity || 'EVENT')}</span><span class="event-tag">${escapeHtml(event.source || event.status || 'OPEN')} ${close}</span></header><strong>${escapeHtml(title)}</strong>${detailsMarkup(details)}</article>`;
    };
  }

  function installEditor() {
    const form = document.querySelector('#logForm');
    const source = document.querySelector('#logDetails');
    const attachmentInput = document.querySelector('#logAttachments');
    const attachmentList = document.querySelector('#logAttachmentList');
    const status = document.querySelector('#logbookStatus');
    if (!form || !source || !status) return;

    source.hidden = true;
    source.removeAttribute('required');
    const editor = document.createElement('div');
    editor.id = 'logDetailsEditor';
    editor.className = 'logbook-body logbook-rich-editor';
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    editor.setAttribute('aria-label', 'Operational message');
    editor.dataset.placeholder = source.placeholder;
    source.after(editor);

    const note = document.createElement('div');
    note.className = 'logbook-format-note';
    note.textContent = 'Rich text is stored as sanitised, append-only logbook content. File names are referenced; file bytes remain local.';
    editor.after(note);

    const actions = {
      bold: () => insertWrapped(editor, 'strong'),
      italic: () => insertWrapped(editor, 'em'),
      underline: () => insertWrapped(editor, 'u'),
      bullet: () => insertList(editor, false),
      ordered: () => insertList(editor, true),
      quote: () => insertWrapped(editor, 'blockquote'),
      clear: () => clearFormatting(editor),
    };

    const toolbar = form.querySelector('.logbook-toolbar');
    const bulletButton = toolbar?.querySelector('[data-format="bullet"]');
    if (bulletButton && !toolbar.querySelector('[data-format="ordered"]')) {
      const ordered = document.createElement('button');
      ordered.type = 'button';
      ordered.dataset.format = 'ordered';
      ordered.title = 'Numbered list';
      ordered.textContent = '1. LIST';
      bulletButton.after(ordered);
    }
    toolbar?.querySelector('.muted-note')?.replaceChildren('SANITISED RICH TEXT');
    toolbar?.querySelectorAll('[data-format]').forEach(button => {
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => {
        actions[button.dataset.format]?.();
        source.value = sanitiseHtml(editor.innerHTML);
      };
    });

    editor.addEventListener('paste', event => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') || '';
      const range = selectionRange(editor);
      if (!range) return;
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      placeCaret(node);
    });
    editor.addEventListener('input', () => {
      source.value = sanitiseHtml(editor.innerHTML);
    });

    attachmentInput?.addEventListener('change', () => {
      attachmentList.replaceChildren(...[...(attachmentInput.files || [])].map(file => {
        const chip = document.createElement('span');
        chip.className = 'logbook-attachment';
        chip.textContent = `📎 ${file.name}`;
        return chip;
      }));
    });

    form.onsubmit = async event => {
      event.preventDefault();
      const cleanHtml = sanitiseHtml(editor.innerHTML).trim();
      const files = [...(attachmentInput?.files || [])].map(file => file.name);
      const headers = [
        ['FROM', document.querySelector('#logFrom')?.value],
        ['TO', document.querySelector('#logTo')?.value],
        ['CC', document.querySelector('#logCc')?.value],
      ].filter(([, value]) => value);
      const metadata = headers.map(([key, value]) => `${key}: ${value}`).join('\n');
      const richBody = cleanHtml ? `${START}\n${cleanHtml}\n${END}` : '';
      const fileLine = files.length ? `ATTACHMENTS: ${files.join(', ')}` : '';
      const details = [metadata, richBody, fileLine].filter(Boolean).join('\n\n');
      if (details.length > MAX_DETAILS) {
        status.textContent = `MESSAGE TOO LONG · ${details.length}/${MAX_DETAILS} CHARACTERS`;
        status.classList.add('error');
        return;
      }

      status.classList.remove('error');
      status.textContent = 'SAVING…';
      const response = await fetch('/api/logbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: document.querySelector('#logType').value,
          subject: document.querySelector('#logSubject').value,
          details,
        }),
      });
      status.textContent = response.ok ? 'MESSAGE ADDED TO LOGBOOK' : 'LOGBOOK CONNECTION FAILED';
      if (response.ok) {
        form.reset();
        editor.replaceChildren();
        source.value = '';
        attachmentList?.replaceChildren();
        loadOps();
      }
    };
  }

  installRichRendering();
  installEditor();
})();
